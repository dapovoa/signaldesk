import { EventEmitter } from 'events'
import * as fs from 'fs'
import OpenAI from 'openai'
import * as os from 'os'
import * as path from 'path'
import type { AssemblyAiSpeechModel } from '../../shared/contracts'
import { AssemblyAIRealtimeClient } from './assemblyAIRealtime'
import { createOpenAIClient } from './openaiClient'

const WHISPER_VERBOSE =
  process.env.SIGNALDESK_VERBOSE === '1' || process.env.SIGNALDESK_ASSEMBLYAI_VERBOSE === '1'

export interface TranscriptEvent {
  text: string
  isFinal: boolean
  confidence: number
}

export interface WhisperConfig {
  provider?: 'openai' | 'assemblyai' | 'groq'
  apiKey: string
  baseURL?: string
  customHeaders?: string
  model?: string
  language?: string
  assemblyAiSpeechModel?: AssemblyAiSpeechModel
  assemblyAiLanguageDetection?: boolean
  assemblyAiMinTurnSilence?: number
  assemblyAiMaxTurnSilence?: number
  assemblyAiKeytermsPrompt?: string
  assemblyAiPrompt?: string
  silenceThresholdMs?: number
}

export class WhisperService extends EventEmitter {
  private client: OpenAI | null
  private realtimeClient: AssemblyAIRealtimeClient | null = null
  private config: WhisperConfig
  private audioBuffer: Buffer[] = []
  private isProcessing = false
  private isRunning = false
  private processInterval: NodeJS.Timeout | null = null
  private processingPromise: Promise<void> | null = null
  private lastAudioTime = 0
  private readonly SAMPLE_RATE = 16000
  private readonly BYTES_PER_SAMPLE = 2 // 16-bit audio
  private readonly MIN_AUDIO_DURATION_MS = 1000
  private readonly DEFAULT_SILENCE_THRESHOLD_MS = 1000
  private readonly MAX_BUFFER_DURATION_MS = 20000
  private readonly MAX_TRANSCRIPTION_RETRIES = 2

  private requireConfiguredModel(): string {
    const model = this.config.model?.trim()
    if (!model) {
      const provider = this.config.provider || 'openai'
      if (provider === 'groq') {
        return 'whisper-large-v3-turbo'
      }
      throw new Error('Select or enter a Whisper model before using transcription.')
    }

    return model
  }

  constructor(config: WhisperConfig) {
    super()
    this.config = config
    const provider = config.provider || 'openai'
    if (provider === 'openai' || provider === 'groq') {
      this.client = createOpenAIClient({
        apiKey: config.apiKey,
        baseURL: provider === 'groq' ? 'https://api.groq.com/openai/v1' : config.baseURL
      })
    } else {
      this.client = null
    }
  }

  async start(): Promise<void> {
    if (this.isRunning) return

    this.isRunning = true
    this.audioBuffer = []
    this.lastAudioTime = Date.now()

    if ((this.config.provider || 'openai') === 'assemblyai') {
      this.realtimeClient = new AssemblyAIRealtimeClient({
        apiKey: this.config.apiKey,
        language: this.config.language,
        speechModel: this.config.assemblyAiSpeechModel,
        languageDetection: this.config.assemblyAiLanguageDetection,
        minTurnSilence: this.config.assemblyAiMinTurnSilence,
        maxTurnSilence: this.config.assemblyAiMaxTurnSilence,
        keytermsPrompt: this.config.assemblyAiKeytermsPrompt,
        prompt: this.config.assemblyAiPrompt
      })

      this.realtimeClient.on('transcript', (event) => this.emit('transcript', event))
      this.realtimeClient.on('utteranceEnd', () => this.emit('utteranceEnd'))
      this.realtimeClient.on('speechStarted', () => this.emit('speechStarted'))
      this.realtimeClient.on('error', (error) => this.emit('error', error))

      await this.realtimeClient.start()
      if (WHISPER_VERBOSE) {
        console.log('WhisperService started in AssemblyAI realtime mode')
      }
      this.emit('started')
      return
    }

    // Check for silence every 500ms
    this.processInterval = setInterval(() => {
      this.checkAndProcess()
    }, 300)

    if (WHISPER_VERBOSE) {
      console.log('WhisperService started')
    }
    this.emit('started')
  }

  async stop(): Promise<void> {
    this.isRunning = false

    if (this.realtimeClient) {
      const realtimeClient = this.realtimeClient
      this.realtimeClient = null
      await realtimeClient.stop()
    }

    if (this.processInterval) {
      clearInterval(this.processInterval)
      this.processInterval = null
    }

    this.audioBuffer = []
    if (this.processingPromise) {
      await this.processingPromise.catch(() => undefined)
    }
    if (WHISPER_VERBOSE) {
      console.log('WhisperService stopped')
    }
    this.emit('stopped')
  }

  addAudioData(audioData: Buffer | ArrayBuffer): void {
    if (!this.isRunning) return

    const buffer = audioData instanceof ArrayBuffer ? Buffer.from(audioData) : audioData

    if ((this.config.provider || 'openai') === 'assemblyai') {
      this.realtimeClient?.sendAudio(buffer)
      return
    }

    // Check if this chunk has actual audio (not silence)
    if (this.hasAudio(buffer)) {
      this.audioBuffer.push(buffer)
      this.lastAudioTime = Date.now()
    }
  }

  // Check if audio buffer contains actual sound (not silence)
  private hasAudio(buffer: Buffer): boolean {
    // Calculate RMS (root mean square) to detect if there's actual audio
    let sum = 0
    const samples = buffer.length / this.BYTES_PER_SAMPLE

    for (let i = 0; i < buffer.length; i += 2) {
      const sample = buffer.readInt16LE(i)
      sum += sample * sample
    }

    const rms = Math.sqrt(sum / samples)
    // Threshold for considering it as actual audio vs silence
    return rms > 500
  }

  private getBufferDurationMs(): number {
    const totalBytes = this.audioBuffer.reduce((sum, buf) => sum + buf.length, 0)
    const samples = totalBytes / this.BYTES_PER_SAMPLE
    return (samples / this.SAMPLE_RATE) * 1000
  }

  private getSilenceThresholdMs(): number {
    const configured = Number(this.config.silenceThresholdMs)
    if (!Number.isFinite(configured) || configured <= 0) {
      return this.DEFAULT_SILENCE_THRESHOLD_MS
    }

    return Math.round(configured)
  }

  private checkAndProcess(): void {
    if (this.isProcessing || !this.isRunning) return

    const bufferDuration = this.getBufferDurationMs()
    const timeSinceLastAudio = Date.now() - this.lastAudioTime

    // Process if:
    // 1. We have enough audio AND enough silence has passed
    // 2. OR buffer is getting too large (force process)
    const hasEnoughAudio = bufferDuration >= this.MIN_AUDIO_DURATION_MS
    const hasSilence = timeSinceLastAudio >= this.getSilenceThresholdMs()
    const bufferTooLarge = bufferDuration >= this.MAX_BUFFER_DURATION_MS

    if ((hasEnoughAudio && hasSilence) || bufferTooLarge) {
      if (WHISPER_VERBOSE) {
        console.log(
          `===> Processing: ${(bufferDuration / 1000).toFixed(2)}s audio, ${(timeSinceLastAudio / 1000).toFixed(2)}s since last audio`
        )
      }
      void this.processAudioBuffer()
    }
  }

  private async processAudioBuffer(): Promise<void> {
    if (this.audioBuffer.length === 0 || this.isProcessing) return

    this.isProcessing = true

    // Combine all buffers
    const combinedBuffer = Buffer.concat(this.audioBuffer)
    this.audioBuffer = []

    // Skip if audio is too short
    const durationMs = (combinedBuffer.length / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000
    if (durationMs < this.MIN_AUDIO_DURATION_MS) {
      if (WHISPER_VERBOSE) {
        console.log(`===> Skipping: audio too short (${(durationMs / 1000).toFixed(2)}s)`)
      }
      this.isProcessing = false
      return
    }

    let tempFile: string | null = null
    const processing = (async () => {
      // Create WAV file from raw PCM data
      const wavBuffer = this.createWavBuffer(combinedBuffer)

      // Write to temp file (OpenAI API requires a file)
      tempFile = path.join(os.tmpdir(), `whisper_${Date.now()}.wav`)
      fs.writeFileSync(tempFile, wavBuffer)

      if (WHISPER_VERBOSE) {
        console.log(`===> Sending ${(durationMs / 1000).toFixed(2)}s of audio to transcription API...`)
      }

      // Send to Whisper API
      const transcription = await this.transcribeWithRetry(tempFile)

      if (!this.isRunning) {
        return
      }

      const text = transcription.text?.trim()

      if (text && text.length > 0) {
        // Filter out common noise transcriptions
        if (this.isNoise(text)) {
          if (WHISPER_VERBOSE) {
            console.log(`Filtered noise: "${text}"`)
          }
        } else {
          if (WHISPER_VERBOSE) {
            console.log(`Transcription: "${text}"`)
          }

          const event: TranscriptEvent = {
            text: text,
            isFinal: true,
            confidence: 1.0
          }

          this.emit('transcript', event)
          this.emit('utteranceEnd')
        }
      }
    })()

    this.processingPromise = processing

    try {
      await processing
    } catch (error) {
      console.error('Transcription error:', error)
      if (this.isRunning) {
        this.emit('error', error instanceof Error ? error : new Error('Transcription failed'))
      }
    } finally {
      if (tempFile && fs.existsSync(tempFile)) {
        try {
          fs.unlinkSync(tempFile)
        } catch {
          // Ignore temp file cleanup errors
        }
      }
      this.processingPromise = null
      this.isProcessing = false
    }
  }

  private async transcribeWithRetry(tempFile: string) {
    let lastError: unknown = null

    for (let attempt = 1; attempt <= this.MAX_TRANSCRIPTION_RETRIES; attempt++) {
      try {
        if ((this.config.provider || 'openai') === 'assemblyai') {
          return await this.transcribeWithAssemblyAI(tempFile)
        }

        if (!this.client) {
          throw new Error('OpenAI transcription client is not initialized')
        }

        return await this.client.audio.transcriptions.create({
          file: fs.createReadStream(tempFile),
          model: this.requireConfiguredModel(),
          language: this.config.language,
          response_format: 'json'
        })
      } catch (error) {
        lastError = error
        const isLastAttempt = attempt >= this.MAX_TRANSCRIPTION_RETRIES
        if (isLastAttempt) break

        const backoffMs = 250 * attempt
        await new Promise((resolve) => setTimeout(resolve, backoffMs))
      }
    }

    throw lastError instanceof Error ? lastError : new Error('Transcription failed')
  }

  private async transcribeWithAssemblyAI(tempFile: string): Promise<{ text?: string }> {
    const apiKey = this.config.apiKey?.trim()
    if (!apiKey) {
      throw new Error('AssemblyAI API key is missing')
    }

    const uploadResponse = await fetch('https://api.assemblyai.com/v2/upload', {
      method: 'POST',
      headers: {
        Authorization: apiKey,
        'Content-Type': 'application/octet-stream'
      },
      body: fs.readFileSync(tempFile)
    })

    if (!uploadResponse.ok) {
      throw new Error(`AssemblyAI upload failed: ${uploadResponse.status} ${uploadResponse.statusText}`)
    }

    const uploadData = (await uploadResponse.json()) as { upload_url?: string }
    if (!uploadData.upload_url) {
      throw new Error('AssemblyAI upload did not return upload_url')
    }

    const transcriptPayload: Record<string, unknown> = {
      audio_url: uploadData.upload_url,
      speech_model: 'universal',
      punctuate: true,
      format_text: true
    }

    if (this.config.language) {
      transcriptPayload.language_code = this.config.language === 'pt' ? 'pt' : 'en_us'
    } else {
      transcriptPayload.language_detection = true
    }

    const transcriptResponse = await fetch('https://api.assemblyai.com/v2/transcript', {
      method: 'POST',
      headers: {
        Authorization: apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(transcriptPayload)
    })

    if (!transcriptResponse.ok) {
      throw new Error(
        `AssemblyAI transcript request failed: ${transcriptResponse.status} ${transcriptResponse.statusText}`
      )
    }

    const transcriptData = (await transcriptResponse.json()) as { id?: string }
    if (!transcriptData.id) {
      throw new Error('AssemblyAI transcript request did not return an id')
    }

    try {
      for (let attempt = 0; attempt < 40; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 350))

        const pollResponse = await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptData.id}`, {
          headers: {
            Authorization: apiKey
          }
        })

        if (!pollResponse.ok) {
          throw new Error(`AssemblyAI polling failed: ${pollResponse.status} ${pollResponse.statusText}`)
        }

        const pollData = (await pollResponse.json()) as {
          status?: string
          text?: string
          error?: string
        }

        if (pollData.status === 'completed') {
          return { text: pollData.text || '' }
        }

        if (pollData.status === 'error') {
          throw new Error(pollData.error || 'AssemblyAI transcription failed')
        }
      }

      throw new Error('AssemblyAI transcription timed out')
    } finally {
      await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptData.id}`, {
        method: 'DELETE',
        headers: {
          Authorization: apiKey
        }
      }).catch(() => undefined)
    }
  }

  // Filter out common noise/hallucination from Whisper
  private isNoise(text: string): boolean {
    const noisePatterns = [
      /^you+\.?$/i,
      /^\.+$/,
      /^[,.\s]+$/,
      /^(um+|uh+|ah+|oh+|hmm+)\.?$/i,
      /^(bye|hi|hello|hey)\.?$/i,
      /^thank(s| you)\.?$/i,
      /^okay\.?$/i,
      /^(yes|no|yeah|yep|nope)\.?$/i,
      /^good\.?$/i,
      /^right\.?$/i,
      /^(subs|subtitles) by/i,
      /^www\./i,
      /^\[.*\]$/, // [Music], [Applause], etc.
      /^♪.*♪$/
    ]

    for (const pattern of noisePatterns) {
      if (pattern.test(text.trim())) {
        return true
      }
    }

    // Filter out very short text (less than 3 words)
    const wordCount = text.split(/\s+/).length
    if (wordCount < 3) {
      return true
    }

    return false
  }

  private createWavBuffer(pcmData: Buffer): Buffer {
    // WAV header for 16-bit mono PCM at 16kHz
    const numChannels = 1
    const sampleRate = this.SAMPLE_RATE
    const bitsPerSample = 16
    const byteRate = sampleRate * numChannels * (bitsPerSample / 8)
    const blockAlign = numChannels * (bitsPerSample / 8)
    const dataSize = pcmData.length
    const headerSize = 44

    const header = Buffer.alloc(headerSize)

    // RIFF header
    header.write('RIFF', 0)
    header.writeUInt32LE(dataSize + headerSize - 8, 4)
    header.write('WAVE', 8)

    // fmt chunk
    header.write('fmt ', 12)
    header.writeUInt32LE(16, 16) // Subchunk1Size for PCM
    header.writeUInt16LE(1, 20) // AudioFormat (1 = PCM)
    header.writeUInt16LE(numChannels, 22)
    header.writeUInt32LE(sampleRate, 24)
    header.writeUInt32LE(byteRate, 28)
    header.writeUInt16LE(blockAlign, 32)
    header.writeUInt16LE(bitsPerSample, 34)

    // data chunk
    header.write('data', 36)
    header.writeUInt32LE(dataSize, 40)

    return Buffer.concat([header, pcmData])
  }
}
