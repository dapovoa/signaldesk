import { spawn } from 'child_process'
import * as fs from 'fs'
import {
  DEFAULT_LLM_BASE_URL,
  resolveEmbeddingModelPath,
  resolveLlamaDirectory,
  resolveLlamaServerBinary
} from './localEmbeddingPaths'

const SIGNALDESK_VERBOSE = process.env.SIGNALDESK_VERBOSE === '1'
const LLM_SERVER_VERBOSE = SIGNALDESK_VERBOSE || process.env.SIGNALDESK_LLM_SERVER_VERBOSE === '1'
const normalizeBaseUrl = (value: string): string => value.replace(/\/+$/, '')
const LLM_BASE_URL = normalizeBaseUrl(DEFAULT_LLM_BASE_URL).replace(/\/v1$/, '')
const LLM_URL = new URL(LLM_BASE_URL)
const LLM_HOST = LLM_URL.hostname || '127.0.0.1'
const LLM_PORT = LLM_URL.port || (LLM_URL.protocol === 'https:' ? '443' : '80')
const LLM_GPU_LAYERS = (process.env.SIGNALDESK_LLM_GPU_LAYERS || '60').trim()
const START_TIMEOUT_MS = Number(process.env.SIGNALDESK_LLM_START_TIMEOUT_MS || 30_000)
const SHUTDOWN_TIMEOUT_MS = Number(process.env.SIGNALDESK_LLM_SHUTDOWN_TIMEOUT_MS || 3_000)
const POLL_INTERVAL_MS = 250
const MAX_OUTPUT_LINES = 80

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
type SpawnedLlamaServer = ReturnType<typeof spawn>

class LlamaCppLlmServerManager {
  private process: SpawnedLlamaServer | null = null
  private starting: Promise<void> | null = null
  private activeModel: string | null = null
  private outputTail: string[] = []

  async ensureRunning(model: string): Promise<void> {
    if (this.starting) {
      await this.starting
    }

    if (this.process && this.activeModel === model && (await this.isHealthy())) {
      return
    }

    this.starting = this.restart(model)
    try {
      await this.starting
    } finally {
      this.starting = null
    }
  }

  async validateModel(model: string): Promise<{ valid: boolean; error?: string }> {
    const modelPath = resolveEmbeddingModelPath(model)
    if (!fs.existsSync(modelPath)) {
      return { valid: false, error: `Model file not found: ${modelPath}` }
    }

    const serverBinary = resolveLlamaServerBinary()
    if (!serverBinary || !fs.existsSync(serverBinary)) {
      return { valid: false, error: `llama-server binary not found in ${resolveLlamaDirectory() || 'vendor/llama'}` }
    }

    try {
      await this.ensureRunning(model)
      const inferenceTest = await this.testInference()
      if (!inferenceTest) {
        return { valid: false, error: 'Model inference test failed' }
      }
      return { valid: true }
    } catch (err) {
      return { valid: false, error: err instanceof Error ? err.message : 'Unknown error' }
    }
  }

  private async testInference(): Promise<boolean> {
    try {
      const response = await fetch(`${LLM_BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.activeModel,
          messages: [{ role: 'user', content: 'hi' }],
          max_tokens: 2,
          temperature: 0.1
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

  private async restart(model: string): Promise<void> {
    await this.dispose()
    await this.start(model)
  }

  private async start(model: string): Promise<void> {
    const llamaDirectory = resolveLlamaDirectory()
    const serverBinary = resolveLlamaServerBinary()
    const modelPath = resolveEmbeddingModelPath(model)

    if (!serverBinary || !fs.existsSync(serverBinary)) {
      throw new Error(`Local llama-server not found in ${llamaDirectory || 'vendor/llama'}`)
    }

    if (!fs.existsSync(modelPath)) {
      throw new Error(`LLM model not found: ${modelPath}`)
    }

    const args = ['-m', modelPath, '--host', LLM_HOST, '--port', LLM_PORT, '-np', '1', '--no-cache-prompt', '-cram', '0', '--reasoning', 'off', '--no-warmup', '-ub', '1024', '-b', '1024', '-c', '4096']

    if (LLM_GPU_LAYERS) {
      args.push('-ngl', LLM_GPU_LAYERS)
    }

    const child = spawn(serverBinary, args, {
      cwd: llamaDirectory || undefined,
      env: {
        ...process.env,
        LD_LIBRARY_PATH: [llamaDirectory, process.env.LD_LIBRARY_PATH || '']
          .filter(Boolean)
          .join(':')
      },
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

  private async waitUntilHealthy(child: SpawnedLlamaServer, modelPath: string): Promise<void> {
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
      const response = await fetch(`${LLM_BASE_URL}/health`, {
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

    if (LLM_SERVER_VERBOSE) {
      for (const line of lines) {
        console.log(`[LlamaCppLlmServer] ${line}`)
      }
    }
  }

  private formatOutputTail(): string {
    return this.outputTail.length > 0
      ? this.outputTail.join('\n')
      : 'No local llama-server output captured.'
  }
}

export const llamaCppLlmServer = new LlamaCppLlmServerManager()
