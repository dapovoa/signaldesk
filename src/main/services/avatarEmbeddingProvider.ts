import { EmbeddingProvider } from './avatarTypes'
import { llamaCppServer } from './llamaCppServer'

interface EmbeddingResponse {
  data?: Array<{
    embedding?: number[]
    index?: number
  }>
}

const normalizeBaseUrl = (value: string): string => value.replace(/\/+$/, '')

export class LlamaCppEmbeddingProvider implements EmbeddingProvider {
  readonly provider = 'llama.cpp'
  readonly model: string
  private readonly baseUrl: string
  private readonly apiKey: string
  private readonly queryPrefix: string
  private readonly documentPrefix: string

  constructor(options?: {
    baseUrl?: string
    apiKey?: string
    model?: string
    queryPrefix?: string
    documentPrefix?: string
  }) {
    this.baseUrl = normalizeBaseUrl(
      options?.baseUrl || process.env.SIGNALDESK_EMBED_BASE_URL || 'http://127.0.0.1:8080'
    )
    this.apiKey = (options?.apiKey || process.env.SIGNALDESK_EMBED_API_KEY || '').trim()
    this.model = options?.model || process.env.SIGNALDESK_EMBED_MODEL || 'all-MiniLM-L6-v2.F16.gguf'
    this.queryPrefix = options?.queryPrefix || process.env.SIGNALDESK_EMBED_QUERY_PREFIX || ''
    this.documentPrefix = options?.documentPrefix || process.env.SIGNALDESK_EMBED_DOCUMENT_PREFIX || ''
  }

  async embedQuery(input: string): Promise<number[]> {
    const results = await this.embed([this.applyPrefix(this.queryPrefix, input)])
    return results[0] || []
  }

  async embedDocuments(input: string[]): Promise<number[][]> {
    return this.embed(input.map((value) => this.applyPrefix(this.documentPrefix, value)))
  }

  private applyPrefix(prefix: string, value: string): string {
    const trimmedPrefix = prefix.trim()
    return trimmedPrefix ? `${trimmedPrefix} ${value}` : value
  }

  private async embed(input: string[]): Promise<number[][]> {
    if (input.length === 0) {
      return []
    }

    await llamaCppServer.ensureRunning(this.model)

    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    }

    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`
    }

    const response = await fetch(`${this.baseUrl}/v1/embeddings`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        input,
        model: this.model,
        encoding_format: 'float'
      })
    })

    if (!response.ok) {
      const message = await response.text()
      throw new Error(`Embedding request failed: ${response.status} ${message}`)
    }

    const payload = (await response.json()) as EmbeddingResponse
    const embeddings = (payload.data || [])
      .slice()
      .sort((left, right) => (left.index ?? 0) - (right.index ?? 0))
      .map((item) => item.embedding)

    if (!embeddings.length || embeddings.some((embedding) => !Array.isArray(embedding))) {
      throw new Error('Embedding request returned no embeddings')
    }

    return embeddings as number[][]
  }
}
