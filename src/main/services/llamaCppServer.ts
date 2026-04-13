import { spawn } from 'child_process'
import * as fs from 'fs'
import {
  buildLlamaRuntimeEnv,
  buildLlamaBinaryNotFoundError,
  resolveEmbeddingModelPath,
  resolveLlamaServerBinary
} from './localEmbeddingPaths'

const SIGNALDESK_VERBOSE = process.env.SIGNALDESK_VERBOSE === '1'
const EMBED_SERVER_VERBOSE =
  SIGNALDESK_VERBOSE || process.env.SIGNALDESK_EMBED_SERVER_VERBOSE === '1'
const normalizeBaseUrl = (value: string): string => value.replace(/\/+$/, '')
const EMBED_BASE_URL = normalizeBaseUrl(
  process.env.SIGNALDESK_EMBED_BASE_URL || 'http://127.0.0.1:8080'
)
const EMBED_URL = new URL(EMBED_BASE_URL)
const EMBED_HOST = EMBED_URL.hostname || '127.0.0.1'
const EMBED_PORT = EMBED_URL.port || (EMBED_URL.protocol === 'https:' ? '443' : '80')
const EMBED_GPU_LAYERS = (process.env.SIGNALDESK_EMBED_GPU_LAYERS || 'all').trim()
const EMBED_POOLING = (process.env.SIGNALDESK_EMBED_POOLING || 'mean').trim() || 'mean'
const START_TIMEOUT_MS = Number(process.env.SIGNALDESK_EMBED_START_TIMEOUT_MS || 30_000)
const SHUTDOWN_TIMEOUT_MS = Number(process.env.SIGNALDESK_EMBED_SHUTDOWN_TIMEOUT_MS || 3_000)
const POLL_INTERVAL_MS = 250
const MAX_OUTPUT_LINES = 80

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
type SpawnedLlamaServer = ReturnType<typeof spawn>

class LlamaCppServerManager {
  private process: SpawnedLlamaServer | null = null
  private starting: Promise<void> | null = null
  private activeModel: string | null = null
  private outputTail: string[] = []

  async ensureRunning(model: string, userDir?: string, binaryDir?: string): Promise<void> {
    if (!model?.trim()) {
      throw new Error('No embedding model specified')
    }

    if (this.starting) {
      await this.starting
    }

    if (this.process && this.activeModel === model && (await this.isHealthy())) {
      return
    }

    this.starting = this.restart(model, userDir, binaryDir)
    try {
      await this.starting
    } finally {
      this.starting = null
    }
  }

  async validateModel(
    model: string,
    userDir?: string,
    binaryDir?: string
  ): Promise<{ valid: boolean; error?: string }> {
    if (!model?.trim()) {
      return { valid: false, error: 'No embedding model specified' }
    }

    const modelPath = resolveEmbeddingModelPath(model, userDir)
    if (!fs.existsSync(modelPath)) {
      return { valid: false, error: `Embedding model file not found: ${modelPath}` }
    }

    const serverBinary = resolveLlamaServerBinary(binaryDir)
    if (!serverBinary || !fs.existsSync(serverBinary)) {
      return { valid: false, error: buildLlamaBinaryNotFoundError('llama-server', binaryDir) }
    }

    try {
      await this.ensureRunning(model, userDir, binaryDir)
      const inferenceTest = await this.testInference()
      if (!inferenceTest) {
        return { valid: false, error: 'Embedding inference test failed' }
      }
      return { valid: true }
    } catch (err) {
      return { valid: false, error: err instanceof Error ? err.message : 'Unknown error' }
    }
  }

  private async testInference(): Promise<boolean> {
    try {
      const response = await fetch(`${EMBED_BASE_URL}/v1/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: ['test'],
          model: this.activeModel
        })
      })
      return response.ok
    } catch {
      return false
    }
  }

  async dispose(): Promise<void> {
    const child = this.process
    this.process = null
    this.activeModel = null

    if (!child) {
      return
    }

    child.kill('SIGTERM')
    const deadline = Date.now() + SHUTDOWN_TIMEOUT_MS

    while (Date.now() < deadline) {
      if (child.exitCode !== null || child.killed) {
        return
      }
      await sleep(100)
    }

    child.kill('SIGKILL')
  }

  private async restart(model: string, userDir?: string, binaryDir?: string): Promise<void> {
    await this.dispose()
    await this.start(model, userDir, binaryDir)
  }

  private async start(model: string, userDir?: string, binaryDir?: string): Promise<void> {
    const serverBinary = resolveLlamaServerBinary(binaryDir)
    const modelPath = resolveEmbeddingModelPath(model, userDir)

    if (!serverBinary || !fs.existsSync(serverBinary)) {
      throw new Error(buildLlamaBinaryNotFoundError('llama-server', binaryDir))
    }

    if (!fs.existsSync(modelPath)) {
      throw new Error(`Embedding model not found: ${modelPath}`)
    }

    const args = [
      '-m',
      modelPath,
      '--host',
      EMBED_HOST,
      '--port',
      EMBED_PORT,
      '--embedding',
      '--pooling',
      EMBED_POOLING
    ]

    if (EMBED_GPU_LAYERS) {
      args.push('-ngl', EMBED_GPU_LAYERS)
    }

    const child = spawn(serverBinary, args, {
      env: buildLlamaRuntimeEnv(serverBinary, binaryDir),
      stdio: ['ignore', 'pipe', 'pipe']
    })

    this.process = child
    this.activeModel = model
    this.outputTail = []

    child.stdout?.on('data', (chunk) => this.captureOutput('stdout', chunk.toString()))
    child.stderr?.on('data', (chunk) => this.captureOutput('stderr', chunk.toString()))
    child.on('error', (error) => this.captureOutput('error', error.message))
    child.on('exit', (code, signal) => {
      this.captureOutput('exit', `code=${String(code)} signal=${String(signal)}`)
      if (this.process === child) {
        this.process = null
      }
    })

    await this.waitUntilHealthy(child, modelPath)
  }

  private async waitUntilHealthy(
    child: SpawnedLlamaServer,
    modelPath: string
  ): Promise<void> {
    const deadline = Date.now() + START_TIMEOUT_MS

    while (Date.now() < deadline) {
      if (child.exitCode !== null) {
        throw new Error(
          `Local llama-server exited before becoming ready for ${modelPath}.\n${this.formatOutputTail()}`
        )
      }

      if (await this.isHealthy()) {
        return
      }

      await sleep(POLL_INTERVAL_MS)
    }

    throw new Error(
      `Timed out waiting for local llama-server to become ready for ${modelPath}.\n${this.formatOutputTail()}`
    )
  }

  private async isHealthy(): Promise<boolean> {
    try {
      const response = await fetch(`${EMBED_BASE_URL}/health`, {
        method: 'GET',
        headers: {
          Accept: 'application/json'
        }
      })
      return response.ok
    } catch {
      return false
    }
  }

  private captureOutput(stream: string, chunk: string): void {
    const lines = chunk
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => `[${stream}] ${line}`)

    if (lines.length === 0) {
      return
    }

    this.outputTail.push(...lines)
    if (this.outputTail.length > MAX_OUTPUT_LINES) {
      this.outputTail.splice(0, this.outputTail.length - MAX_OUTPUT_LINES)
    }

    if (EMBED_SERVER_VERBOSE) {
      for (const line of lines) {
        console.log(`[AvatarEmbeddingServer] ${line}`)
      }
    }
  }

  private formatOutputTail(): string {
    return this.outputTail.length > 0
      ? this.outputTail.join('\n')
      : 'No local llama-server output captured.'
  }
}

export const llamaCppServer = new LlamaCppServerManager()
