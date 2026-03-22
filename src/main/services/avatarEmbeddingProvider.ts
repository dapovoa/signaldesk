import { EmbeddingProvider } from './avatarTypes'

interface OllamaEmbedResponse {
  embeddings?: number[][]
}

const normalizeBaseUrl = (value: string): string => value.replace(/\/+$/, '')

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly provider = 'ollama'
  readonly model: string
  private readonly baseUrl: string
  private readonly queryPrefix: string
  private readonly documentPrefix: string

  constructor(options?: {
    baseUrl?: string
    model?: string
    queryPrefix?: string
    documentPrefix?: string
  }) {
    this.baseUrl = normalizeBaseUrl(options?.baseUrl || process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434')
    this.model = options?.model || process.env.SIGNALDESK_EMBED_MODEL || 'mxbai-embed-large'
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
    const response = await fetch(`${this.baseUrl}/api/embed`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: this.model,
        input
      })
    })

    if (!response.ok) {
      const message = await response.text()
      throw new Error(`Ollama embedding request failed: ${response.status} ${message}`)
    }

    const payload = (await response.json()) as OllamaEmbedResponse
    if (!Array.isArray(payload.embeddings) || payload.embeddings.length === 0) {
      throw new Error('Ollama embedding request returned no embeddings')
    }

    return payload.embeddings
  }
}
