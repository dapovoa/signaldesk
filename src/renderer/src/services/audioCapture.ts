export interface AudioCaptureOptions {
  sampleRate?: number
  channelCount?: number
  echoCancellation?: boolean
  noiseSuppression?: boolean
  autoGainControl?: boolean
}

const DEFAULT_OPTIONS: AudioCaptureOptions = {
  sampleRate: 16000,
  channelCount: 1,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true
}

export class AudioCaptureService {
  private audioContext: AudioContext | null = null
  private mediaStream: MediaStream | null = null
  private workletNode: AudioWorkletNode | null = null
  private sourceNode: MediaStreamAudioSourceNode | null = null
  private isCapturing = false
  private options: AudioCaptureOptions

  constructor(options: AudioCaptureOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  private async setupStreamCapture(stream: MediaStream): Promise<void> {
    this.mediaStream = stream

    // Create audio context
    this.audioContext = new AudioContext({
      sampleRate: this.options.sampleRate
    })

    // Create source from stream
    this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream)

    // Load and create audio worklet for processing
    await this.audioContext.audioWorklet.addModule(this.createWorkletBlobUrl())

    this.workletNode = new AudioWorkletNode(this.audioContext, 'audio-processor')

    // Handle audio data from worklet
    this.workletNode.port.onmessage = (event) => {
      if (event.data.audioData) {
        this.handleAudioData(event.data.audioData)
      }
    }

    // Connect nodes
    this.sourceNode.connect(this.workletNode)
    this.isCapturing = true
  }

  async startMicrophoneCapture(deviceId?: string): Promise<void> {
    if (this.isCapturing) return

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
          sampleRate: this.options.sampleRate,
          channelCount: this.options.channelCount,
          echoCancellation: this.options.echoCancellation,
          noiseSuppression: this.options.noiseSuppression,
          autoGainControl: this.options.autoGainControl
        }
      })

      await this.setupStreamCapture(stream)
    } catch (error) {
      console.error('Failed to start microphone capture:', error)
      throw error
    }
  }

  async startSpeakerMonitorCapture(deviceId?: string): Promise<void> {
    if (this.isCapturing) return

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
          sampleRate: this.options.sampleRate,
          channelCount: this.options.channelCount,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        },
        video: false
      })

      await this.setupStreamCapture(stream)
    } catch (error) {
      console.error('Failed to start speaker monitor capture:', error)
      throw error
    }
  }

  async startSystemAudioCapture(sourceId: string): Promise<void> {
    if (this.isCapturing) return

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          // @ts-ignore - Electron specific constraint
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: sourceId
          }
        },
        video: {
          // @ts-ignore - Electron specific constraint
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: sourceId
          }
        }
      })

      const hasAudioTrack = stream.getAudioTracks().length > 0
      if (!hasAudioTrack) {
        stream.getTracks().forEach((track) => track.stop())
        throw new Error('Desktop capture started without an audio track.')
      }

      // Keep the video track alive but disabled. Stopping it immediately can trigger
      // PipeWire remote-connection warnings on some Wayland sessions even when audio works.
      stream.getVideoTracks().forEach((track) => {
        track.enabled = false
      })

      await this.setupStreamCapture(stream)
    } catch (error) {
      console.error('Failed to start system audio capture:', error)
      throw error
    }
  }

  private createWorkletBlobUrl(): string {
    const workletCode = `
      class AudioProcessor extends AudioWorkletProcessor {
        constructor() {
          super();
          this.bufferSize = 800;
          this.buffer = new Float32Array(this.bufferSize);
          this.bufferIndex = 0;
        }

        process(inputs, outputs, parameters) {
          const input = inputs[0];
          if (input && input[0]) {
            const inputData = input[0];
            
            for (let i = 0; i < inputData.length; i++) {
              this.buffer[this.bufferIndex++] = inputData[i];
              
              if (this.bufferIndex >= this.bufferSize) {
                // Convert Float32 to Int16 PCM for the transcription backends
                const int16Buffer = new Int16Array(this.bufferSize);
                for (let j = 0; j < this.bufferSize; j++) {
                  const s = Math.max(-1, Math.min(1, this.buffer[j]));
                  int16Buffer[j] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                }
                
                this.port.postMessage({
                  audioData: int16Buffer.buffer
                }, [int16Buffer.buffer]);
                
                this.buffer = new Float32Array(this.bufferSize);
                this.bufferIndex = 0;
              }
            }
          }
          return true;
        }
      }

      registerProcessor('audio-processor', AudioProcessor);
    `

    const blob = new Blob([workletCode], { type: 'application/javascript' })
    return URL.createObjectURL(blob)
  }

  private handleAudioData(audioData: ArrayBuffer): void {
    // Send audio data to main process
    if (window.api) {
      window.api.sendAudioData(audioData)
    }
  }

  async stop(): Promise<void> {
    if (this.workletNode) {
      this.workletNode.disconnect()
      this.workletNode = null
    }

    if (this.sourceNode) {
      this.sourceNode.disconnect()
      this.sourceNode = null
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop())
      this.mediaStream = null
    }

    if (this.audioContext) {
      await this.audioContext.close()
      this.audioContext = null
    }

    this.isCapturing = false
  }
}
