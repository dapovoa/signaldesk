import { EventEmitter } from 'events'
import WebSocket from 'ws'

interface AssemblyAIRealtimeConfig {
  apiKey: string
  language?: string
  sampleRate?: number
  speechModel?: 'universal-streaming-multilingual' | 'universal-streaming-english'
  languageDetection?: boolean
  minTurnSilence?: number
  maxTurnSilence?: number
  keytermsPrompt?: string
  prompt?: string
}

interface AssemblyAITurnMessage {
  type?: string
  transcript?: string
  end_of_turn?: boolean
  turn_is_formatted?: boolean
}

const DEFAULT_SAMPLE_RATE = 16000
const SIGNALDESK_VERBOSE = process.env.SIGNALDESK_VERBOSE === '1'
const ASSEMBLYAI_VERBOSE_LOGS =
  SIGNALDESK_VERBOSE || process.env.SIGNALDESK_ASSEMBLYAI_VERBOSE === '1'

const buildUrl = (config: AssemblyAIRealtimeConfig): string => {
  const params = new URLSearchParams({
    sample_rate: String(config.sampleRate || DEFAULT_SAMPLE_RATE),
    encoding: 'pcm_s16le',
    format_turns: 'true',
    speech_model:
      config.speechModel ||
      (config.language === 'en'
        ? 'universal-streaming-english'
        : 'universal-streaming-multilingual'),
    language_detection: String(config.languageDetection ?? true),
    min_turn_silence: String(config.minTurnSilence ?? 160),
    max_turn_silence: String(config.maxTurnSilence ?? 1280)
  })

  if (config.prompt?.trim()) {
    params.set('prompt', config.prompt.trim())
  }

  if (config.keytermsPrompt?.trim()) {
    params.set('keyterms_prompt', config.keytermsPrompt.trim())
  }

  return `wss://streaming.assemblyai.com/v3/ws?${params.toString()}`
}

export class AssemblyAIRealtimeClient extends EventEmitter {
  private readonly apiKey: string
  private readonly language?: string
  private readonly sampleRate: number
  private readonly speechModel?: 'universal-streaming-multilingual' | 'universal-streaming-english'
  private readonly languageDetection?: boolean
  private readonly minTurnSilence?: number
  private readonly maxTurnSilence?: number
  private readonly keytermsPrompt?: string
  private readonly prompt?: string
  private socket: WebSocket | null = null
  private pendingAudio: Buffer[] = []
  private isReady = false
  private isClosed = false
  private speechActive = false

  constructor(config: AssemblyAIRealtimeConfig) {
    super()
    this.apiKey = config.apiKey
    this.language = config.language
    this.sampleRate = config.sampleRate || DEFAULT_SAMPLE_RATE
    this.speechModel = config.speechModel
    this.languageDetection = config.languageDetection
    this.minTurnSilence = config.minTurnSilence
    this.maxTurnSilence = config.maxTurnSilence
    this.keytermsPrompt = config.keytermsPrompt
    this.prompt = config.prompt
  }

  async start(): Promise<void> {
    if (this.socket && !this.isClosed) return

    this.isClosed = false
    const url = buildUrl({
      apiKey: this.apiKey,
      language: this.language,
      sampleRate: this.sampleRate,
      speechModel: this.speechModel,
      languageDetection: this.languageDetection,
      minTurnSilence: this.minTurnSilence,
      maxTurnSilence: this.maxTurnSilence,
      keytermsPrompt: this.keytermsPrompt,
      prompt: this.prompt
    })

    await new Promise<void>((resolve, reject) => {
      let settled = false
      const socket = new WebSocket(url, {
        headers: {
          Authorization: this.apiKey
        }
      })

      const timeout = setTimeout(() => {
        if (settled) return
        settled = true
        socket.terminate()
        reject(new Error('AssemblyAI realtime connection timed out'))
      }, 5000)

      socket.on('message', (data) => {
        const raw = typeof data === 'string' ? data : data.toString('utf8')
        let message: AssemblyAITurnMessage | null = null

        try {
          message = JSON.parse(raw) as AssemblyAITurnMessage
        } catch {
          return
        }

        if (message.type === 'Begin' && !settled) {
          settled = true
          clearTimeout(timeout)
          this.socket = socket
          this.isReady = true
          this.flushPendingAudio()
          resolve()
          return
        }

        this.handleMessage(message)
      })

      socket.on('error', (error) => {
        this.emit('error', error)
        if (settled) return
        settled = true
        clearTimeout(timeout)
        reject(error)
      })

      socket.on('close', () => {
        this.isReady = false
        this.isClosed = true
      })
    })
  }

  sendAudio(audio: Buffer): void {
    if (this.isClosed) return

    if (!this.isReady || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
      this.pendingAudio.push(audio)
      return
    }

    this.socket.send(audio, { binary: true })
  }

  async stop(): Promise<void> {
    if (!this.socket) return

    const socket = this.socket
    this.socket = null
    this.isClosed = true
    this.isReady = false
    this.pendingAudio = []

    await new Promise<void>((resolve) => {
      const finalize = () => resolve()
      socket.once('close', finalize)

      try {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'Terminate' }))
          setTimeout(() => {
            try {
              socket.close()
            } catch {
              finalize()
            }
          }, 150)
        } else {
          socket.close()
        }
      } catch {
        finalize()
      }
    })
  }

  private flushPendingAudio(): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return

    for (const chunk of this.pendingAudio) {
      this.socket.send(chunk, { binary: true })
    }
    this.pendingAudio = []
  }

  private handleMessage(message: AssemblyAITurnMessage): void {
    if (message.type !== 'Turn') return

    const transcript = message.transcript?.trim()
    if (!transcript) return

    if (ASSEMBLYAI_VERBOSE_LOGS) {
      console.log('[AssemblyAIRealtime] Turn:', {
        text: transcript,
        endOfTurn: Boolean(message.end_of_turn),
        formatted: Boolean(message.turn_is_formatted)
      })
    }

    if (!this.speechActive) {
      this.speechActive = true
      this.emit('speechStarted')
    }

    if (message.end_of_turn && message.turn_is_formatted) {
      this.emit('transcript', {
        text: transcript,
        isFinal: true,
        confidence: 1
      })
      this.emit('utteranceEnd')
      this.speechActive = false
      return
    }

    this.emit('transcript', {
      text: transcript,
      isFinal: false,
      confidence: 1
    })
  }
}

export const testAssemblyAIConnection = async (
  apiKey: string,
  config?: Omit<AssemblyAIRealtimeConfig, 'apiKey'>
): Promise<{ success: boolean; message: string }> => {
  const client = new AssemblyAIRealtimeClient({ apiKey, ...config })

  try {
    await client.start()
    return { success: true, message: 'AssemblyAI realtime connection established.' }
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'AssemblyAI connection failed'
    }
  } finally {
    await client.stop().catch(() => undefined)
  }
}
