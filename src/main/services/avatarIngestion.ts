import { createHash } from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import { AvatarStore } from './avatarStore'
import { EmbeddingProvider, IngestedChunk } from './avatarTypes'

const SUPPORTED_EXTENSIONS = new Set(['.md', '.txt', '.json'])
const DEFAULT_PROFILE_ID = 'default'
const SIGNALDESK_VERBOSE = process.env.SIGNALDESK_VERBOSE === '1'
const AVATAR_VERBOSE_LOGS = SIGNALDESK_VERBOSE || process.env.SIGNALDESK_AVATAR_VERBOSE === '1'

const normalizeWhitespace = (value: string): string =>
  value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/[ \t]+\n/g, '\n').trim()

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')

const summarize = (value: string): string => value.replace(/\s+/g, ' ').trim().slice(0, 180)

interface ParsedSection {
  title: string
  body: string
  type: string
  tags: string[]
  headings: string[]
  structureScore: number
}

interface ParsedDocument {
  sourceType: string
  sections: ParsedSection[]
}

const EXPECTED_HEADINGS: Record<string, string[]> = {
  project: ['situacao', 'o-que-fiz', 'resultado'],
  behavior_story: ['situacao', 'acao', 'resultado'],
  technology: ['onde-usei', 'uso-real', 'limites'],
  decision: ['contexto', 'opcoes', 'decisao'],
  tradeoff: ['contexto', 'tradeoffs', 'decisao'],
  answer_example: ['pergunta', 'resposta'],
  debugging: ['problema', 'primeiro-passo', 'validacao']
}

const inferKind = (value: string): string => {
  const lower = value.toLowerCase()

  if (/(incident|production|outage|latency|debug|log|erro|problema|falha)/.test(lower)) {
    return 'debugging'
  }

  if (/(design|architecture|scale|throughput|availability|distributed|sistema)/.test(lower)) {
    return 'system_design'
  }

  if (/(trade-?off|priorit|deadline|compromise|choice|decisão)/.test(lower)) {
    return 'tradeoff'
  }

  if (/(project|implemented|built|created|migrat|integra|implementei|criei)/.test(lower)) {
    return 'project'
  }

  if (/(automati|pipeline|script|deploy|ci|cd)/.test(lower)) {
    return 'tooling'
  }

  return 'experience'
}

const inferImportance = (value: string): number => {
  const lower = value.toLowerCase()
  let score = 1

  if (/(implemented|built|created|solved|improved|reduced|optimized|implementei|resolvi)/.test(lower)) {
    score += 0.4
  }

  if (/(incident|production|debug|trade-?off|architecture|scale|latency|availability)/.test(lower)) {
    score += 0.3
  }

  if (/(automation|monitoring|logging|pipeline|deploy)/.test(lower)) {
    score += 0.2
  }

  return Math.min(2, score)
}

const normalizeTag = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\-_ ]+/gu, '')
    .replace(/\s+/g, '-')

const normalizeHeading = (value: string): string => normalizeTag(value)

const parseInlineList = (value: string): string[] =>
  value
    .split(',')
    .map((entry) => normalizeTag(entry))
    .filter(Boolean)

const normalizeType = (value: string | undefined): string => {
  const normalized = normalizeTag(value || '')
  if (!normalized) return 'experience'

  const aliases: Record<string, string> = {
    project: 'project',
    projects: 'project',
    historia: 'behavior_story',
    historias: 'behavior_story',
    behavioral: 'behavior_story',
    behavior: 'behavior_story',
    technology: 'technology',
    technologies: 'technology',
    tecnologia: 'technology',
    tecnologias: 'technology',
    decisao: 'decision',
    decisoes: 'decision',
    decision: 'decision',
    decisions: 'decision',
    tradeoff: 'tradeoff',
    tradeoffs: 'tradeoff',
    debugging: 'debugging',
    debug: 'debugging',
    incidente: 'debugging',
    incident: 'debugging',
    answer: 'answer_example',
    answers: 'answer_example',
    resposta: 'answer_example',
    respostas: 'answer_example',
    example: 'answer_example',
    examples: 'answer_example'
  }

  return aliases[normalized] || normalized
}

const inferTypeFromTitle = (value: string, fallbackType: string): string => {
  const lower = value.toLowerCase()

  if (/(projeto|project)/.test(lower)) return 'project'
  if (/(historia|história|story|behavior|comport)/.test(lower)) return 'behavior_story'
  if (/(tecnolog|stack|framework|tool)/.test(lower)) return 'technology'
  if (/(trade-?off|decis[aã]o|decision|prioridad)/.test(lower)) return 'decision'
  if (/(debug|incident|incidente|latency|erro|problema)/.test(lower)) return 'debugging'
  if (/(resposta|answer|interview)/.test(lower)) return 'answer_example'

  return fallbackType
}

const extractSubheadings = (body: string): string[] =>
  body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('### '))
    .map((line) => normalizeHeading(line.slice(4)))
    .filter(Boolean)

const scoreStructure = (kind: string, headings: string[]): number => {
  const expected = EXPECTED_HEADINGS[kind] || []

  if (expected.length === 0) {
    return headings.length > 0 ? 0.7 : 0.4
  }

  const present = expected.filter((heading) => headings.includes(heading)).length
  if (present === 0) {
    return headings.length > 0 ? 0.45 : 0.25
  }

  return Math.min(1, 0.35 + (present / expected.length) * 0.65)
}

const splitLongSegment = (segment: string, maxChars: number): string[] => {
  if (segment.length <= maxChars) return [segment]

  const sentences = segment
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean)

  if (sentences.length <= 1) {
    const chunks: string[] = []
    for (let cursor = 0; cursor < segment.length; cursor += maxChars) {
      chunks.push(segment.slice(cursor, cursor + maxChars).trim())
    }
    return chunks.filter(Boolean)
  }

  const chunks: string[] = []
  let current = ''

  for (const sentence of sentences) {
    const next = current ? `${current} ${sentence}` : sentence
    if (next.length > maxChars && current) {
      chunks.push(current)
      current = sentence
    } else {
      current = next
    }
  }

  if (current) chunks.push(current)
  return chunks
}

const buildGenericChunks = (content: string): IngestedChunk[] => {
  const normalized = normalizeWhitespace(content)
  if (!normalized) return []

  const segments = normalized
    .split(/\n{2,}|(?=^#)/gm)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length >= 60)
    .flatMap((segment) => splitLongSegment(segment, 900))
    .filter((segment) => segment.length >= 80)

  return segments.map((segment) => ({
    content: segment,
    summary: summarize(segment),
    kind: inferKind(segment),
    importance: inferImportance(segment),
    sectionTitle: summarize(segment),
    tags: [],
    headings: [],
    structureScore: 0.2,
    metadata: {
      charLength: segment.length,
      sectionTitle: summarize(segment),
      tags: [],
      headings: [],
      structureScore: 0.2
    }
  }))
}

const parseMarkdownDocument = (content: string, fallbackSourceType: string): ParsedDocument => {
  const normalized = normalizeWhitespace(content)
  const lines = normalized.split('\n')
  const sections: ParsedSection[] = []
  let currentTitle = ''
  let currentType = normalizeType(fallbackSourceType)
  let currentTags: string[] = []
  let documentTags: string[] = []
  let currentBody: string[] = []

  const pushCurrent = (): void => {
    const body = normalizeWhitespace(currentBody.join('\n'))
    if (!body || !currentTitle) return

    const type = inferTypeFromTitle(currentTitle, currentType || documentType)
    const headings = extractSubheadings(body)

    sections.push({
      title: currentTitle,
      body,
      type,
      tags: currentTags.length > 0 ? currentTags : documentTags,
      headings,
      structureScore: scoreStructure(type, headings)
    })
  }

  let documentType = normalizeType(fallbackSourceType)

  for (const rawLine of lines) {
    const line = rawLine.trim()

    if (line.startsWith('type:') && !currentTitle) {
      documentType = normalizeType(line.slice(5).trim())
      continue
    }

    if (line.startsWith('tags:') && !currentTitle) {
      documentTags = parseInlineList(line.slice(5).trim())
      currentTags = [...documentTags]
      continue
    }

    if (line.startsWith('## ')) {
      pushCurrent()
      currentTitle = line.slice(3).trim()
      currentBody = []
      currentType = documentType
      currentTags = [...documentTags]
      continue
    }

    if (line.startsWith('type:') && currentTitle) {
      currentType = normalizeType(line.slice(5).trim())
      continue
    }

    if (line.startsWith('tags:') && currentTitle) {
      currentTags = parseInlineList(line.slice(5).trim())
      continue
    }

    currentBody.push(rawLine)
  }

  pushCurrent()

  return {
    sourceType: documentType,
    sections
  }
}

const buildStructuredChunks = (parsed: ParsedDocument): IngestedChunk[] => {
  return parsed.sections.flatMap((section) => {
    const segments = splitLongSegment(section.body, 900).filter((segment) => segment.length >= 80)

    return segments.map((segment) => ({
      content: segment,
      summary: summarize(segment),
      kind: section.type,
      importance: Math.min(2, inferImportance(`${section.title}\n${segment}`) + section.structureScore * 0.2),
      sectionTitle: section.title,
      tags: section.tags,
      headings: section.headings,
      structureScore: section.structureScore,
      metadata: {
        charLength: segment.length,
        sectionTitle: section.title,
        tags: section.tags,
        headings: section.headings,
        structureScore: section.structureScore
      }
    }))
  })
}

const buildChunks = (filePath: string, content: string, sourceType: string): IngestedChunk[] => {
  if (path.extname(filePath).toLowerCase() === '.md') {
    const parsed = parseMarkdownDocument(content, sourceType)
    const structured = buildStructuredChunks(parsed)
    if (structured.length > 0) return structured
  }

  return buildGenericChunks(content)
}

const collectFiles = (directory: string): string[] => {
  const results: string[] = []
  const stack = [directory]

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current || !fs.existsSync(current)) continue

    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(fullPath)
        continue
      }

      const ext = path.extname(entry.name).toLowerCase()
      if (SUPPORTED_EXTENSIONS.has(ext)) {
        results.push(fullPath)
      }
    }
  }

  return results.sort()
}

const detectSourceType = (filePath: string): string => {
  const lower = filePath.toLowerCase()

  if (lower.includes('cv') || lower.includes('resume')) return 'cv'
  if (lower.includes('project')) return 'project'
  if (lower.includes('histor') || lower.includes('story')) return 'behavior_story'
  if (lower.includes('interview') || lower.includes('answer')) return 'answer_example'
  if (lower.includes('tech') || lower.includes('stack')) return 'technology'
  if (lower.includes('debug') || lower.includes('incident')) return 'debugging'
  if (lower.includes('tradeoff') || lower.includes('decision')) return 'decision'
  return 'experience'
}

export class AvatarIngestionService {
  constructor(
    private readonly store: AvatarStore,
    private readonly embeddingProvider: EmbeddingProvider,
    private sourceDirectory: string
  ) {}

  setSourceDirectory(sourceDirectory: string): void {
    this.sourceDirectory = sourceDirectory
  }

  getSourceDirectory(): string {
    return this.sourceDirectory
  }

  ensureSourceDirectory(): void {
    fs.mkdirSync(this.sourceDirectory, { recursive: true })
  }

  async syncSourceDirectory(
    onProgress?: (progress: {
      totalDocuments: number
      processedDocuments: number
      embeddedChunks: number
      embeddingModel: string
      currentFile: string | null
    }) => void
  ): Promise<void> {
    const startedAt = Date.now()
    this.ensureSourceDirectory()
    const files = collectFiles(this.sourceDirectory)
    const storedEmbeddingModel = this.store.getMetadata('embedding_model') || ''
    const forceFullReembed = storedEmbeddingModel !== this.embeddingProvider.model
    let processedDocuments = 0
    let embeddedChunks = 0

    if (AVATAR_VERBOSE_LOGS) {
      console.log('[AvatarIngestion] sync started:', {
        sourceDirectory: this.sourceDirectory,
        fileCount: files.length,
        embeddingModel: this.embeddingProvider.model,
        storedEmbeddingModel: storedEmbeddingModel || null,
        forceFullReembed
      })
    }

    onProgress?.({
      totalDocuments: files.length,
      processedDocuments: 0,
      embeddedChunks: 0,
      embeddingModel: this.embeddingProvider.model,
      currentFile: null
    })

    for (const filePath of files) {
      const content = normalizeWhitespace(fs.readFileSync(filePath, 'utf-8'))
      if (!content) continue

      const checksum = sha256(content)
      const title = path.basename(filePath)
      const sourceType = detectSourceType(filePath)
      const result = this.store.upsertDocument({
        profileId: DEFAULT_PROFILE_ID,
        sourcePath: filePath,
        title,
        sourceType,
        content,
        checksum
      })

      if (!result.changed && !forceFullReembed) {
        if (AVATAR_VERBOSE_LOGS) {
          console.log('[AvatarIngestion] skipping unchanged document:', {
            filePath,
            documentId: result.documentId
          })
        }
        continue
      }

      const chunks = buildChunks(filePath, content, sourceType)
      if (chunks.length === 0) continue

      if (AVATAR_VERBOSE_LOGS) {
        console.log('[AvatarIngestion] processing document:', {
          filePath: path.basename(filePath),
          documentId: result.documentId,
          progress: `${processedDocuments + 1}/${files.length}`,
          changed: result.changed,
          forced: forceFullReembed,
          chunkCount: chunks.length
        })
      }

      const chunkIds = this.store.replaceDocumentChunks(result.documentId, chunks)
      const embeddings = await this.embeddingProvider.embedDocuments(
        chunks.map((chunk) => ({
          title: chunk.sectionTitle || title,
          content: chunk.content
        }))
      )
      const dimensions = embeddings[0]?.length

      if (!dimensions) continue

      this.store.setEmbeddingConfig(this.embeddingProvider.model, dimensions)
      this.store.replaceEmbeddings(
        chunkIds.map((chunkId, index) => ({
          chunkId,
          embedding: embeddings[index] || []
        }))
      )

      processedDocuments += 1
      embeddedChunks += chunkIds.length

      onProgress?.({
        totalDocuments: files.length,
        processedDocuments,
        embeddedChunks,
        embeddingModel: this.embeddingProvider.model,
        currentFile: filePath
      })
    }

    if (AVATAR_VERBOSE_LOGS) {
      console.log('[AvatarIngestion] sync completed:', {
        processedDocuments,
        embeddedChunks,
        embeddingModel: this.embeddingProvider.model,
        forceFullReembed,
        durationMs: Date.now() - startedAt
      })
    }
  }
}
