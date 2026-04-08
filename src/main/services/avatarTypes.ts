export interface AvatarRetrievedSnippet {
  chunkId: number
  documentId: number
  title: string
  sourceType: string
  kind: string
  sectionTitle: string
  tags: string[]
  headings: string[]
  structureScore: number
  content: string
  summary: string
  importance: number
  distance: number
}

export interface AvatarContextPack {
  profileId: string
  embeddingModel: string
  promptContext: string
  snippets: AvatarRetrievedSnippet[]
}

export interface IngestedChunk {
  content: string
  summary: string
  kind: string
  importance: number
  sectionTitle: string
  tags: string[]
  headings: string[]
  structureScore: number
  metadata?: Record<string, unknown>
}

export interface EmbeddingProvider {
  readonly provider: string
  readonly model: string
  embedQuery(input: string): Promise<number[]>
  embedDocuments(input: string[]): Promise<number[][]>
  warmup?(): Promise<void>
}
