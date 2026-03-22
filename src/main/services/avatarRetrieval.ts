import { AvatarStore } from './avatarStore'
import { AvatarContextPack, AvatarRetrievedSnippet, EmbeddingProvider } from './avatarTypes'

const DEFAULT_PROFILE_ID = 'default'

const inferQuestionKinds = (question: string): string[] => {
  const lower = question.toLowerCase()
  const kinds = new Set<string>()

  if (/(project|built|implemented|experience|worked|trabalhaste|experi[êe]ncia)/.test(lower)) {
    kinds.add('project')
    kinds.add('experience')
  }

  if (/(behavior|conflict|challenge|situation|team|stakeholder|hist[óo]ria|conflito)/.test(lower)) {
    kinds.add('behavior_story')
  }

  if (/(technology|stack|framework|tool|redis|postgres|docker|kubernetes|tecnolog)/.test(lower)) {
    kinds.add('technology')
  }

  if (/(trade-?off|decision|choose|priorit|compromise|decis[aã]o)/.test(lower)) {
    kinds.add('decision')
    kinds.add('tradeoff')
  }

  if (/(how would you answer|what would you say|resposta|answer)/.test(lower)) {
    kinds.add('answer_example')
  }

  if (/(debug|incident|latency|slow|error|problem|issue|falha|erro|problema)/.test(lower)) {
    kinds.add('debugging')
  }

  return [...kinds]
}

const rerankSnippets = (
  question: string,
  snippets: AvatarRetrievedSnippet[],
  limit: number
): AvatarRetrievedSnippet[] => {
  const preferredKinds = inferQuestionKinds(question)
  const lowerQuestion = question.toLowerCase()
  const prioritized = preferredKinds.length
    ? [...snippets].sort((left, right) => {
        const leftMatch = preferredKinds.includes(left.kind) ? 1 : 0
        const rightMatch = preferredKinds.includes(right.kind) ? 1 : 0
        return rightMatch - leftMatch
      })
    : [...snippets]

  const ranked = prioritized.sort((left, right) => {
    const leftKindBoost = preferredKinds.includes(left.kind) ? 0.2 : 0
    const rightKindBoost = preferredKinds.includes(right.kind) ? 0.2 : 0

    const leftTagBoost = left.tags.some((tag) => lowerQuestion.includes(tag.replace(/-/g, ' '))) ? 0.1 : 0
    const rightTagBoost = right.tags.some((tag) => lowerQuestion.includes(tag.replace(/-/g, ' '))) ? 0.1 : 0

    const leftHeadingBoost = left.headings.some((heading) =>
      lowerQuestion.includes(heading.replace(/-/g, ' '))
    )
      ? 0.05
      : 0
    const rightHeadingBoost = right.headings.some((heading) =>
      lowerQuestion.includes(heading.replace(/-/g, ' '))
    )
      ? 0.05
      : 0

    const leftScore =
      left.distance -
      leftKindBoost -
      leftTagBoost -
      leftHeadingBoost -
      left.structureScore * 0.08 -
      left.importance * 0.05
    const rightScore =
      right.distance -
      rightKindBoost -
      rightTagBoost -
      rightHeadingBoost -
      right.structureScore * 0.08 -
      right.importance * 0.05

    return leftScore - rightScore
  })

  return dedupeSnippets(ranked, limit)
}

const dedupeSnippets = (snippets: AvatarRetrievedSnippet[], limit: number): AvatarRetrievedSnippet[] => {
  const byDocument = new Map<number, number>()
  const results: AvatarRetrievedSnippet[] = []

  for (const snippet of snippets) {
    const count = byDocument.get(snippet.documentId) || 0
    if (count >= 2) continue

    byDocument.set(snippet.documentId, count + 1)
    results.push(snippet)

    if (results.length >= limit) {
      break
    }
  }

  return results
}

const sanitizeSnippetForPrompt = (content: string): string => {
  return content
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => {
      const withoutHeading = line.replace(/^\s{0,3}#{1,6}\s*/g, '')
      const withoutBullet = withoutHeading.replace(/^\s*[-*+]\s+/g, '')
      const withoutOrdered = withoutBullet.replace(/^\s*\d+\.\s+/g, '')
      return withoutOrdered.trimEnd()
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const limitSnippetLength = (content: string, maxChars = 420): string => {
  if (content.length <= maxChars) {
    return content
  }

  const cut = content.slice(0, maxChars)
  const lastSentence = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '))
  if (lastSentence > 80) {
    return cut.slice(0, lastSentence + 1).trim()
  }

  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > 80 ? cut.slice(0, lastSpace) : cut).trim()
}

const buildPromptContext = (snippets: AvatarRetrievedSnippet[]): string => {
  if (snippets.length === 0) {
    return ''
  }

  return snippets
    .map((snippet) => {
      const normalizedContent = sanitizeSnippetForPrompt(snippet.content)
      return limitSnippetLength(normalizedContent)
    })
    .join('\n\n')
}

export class AvatarRetrievalService {
  constructor(
    private readonly store: AvatarStore,
    private readonly embeddingProvider: EmbeddingProvider
  ) {}

  async buildContextPack(question: string, limit = 5): Promise<AvatarContextPack | null> {
    const normalizedQuestion = question.trim()
    if (!normalizedQuestion) return null

    const queryEmbedding = await this.embeddingProvider.embedQuery(normalizedQuestion)
    if (!queryEmbedding.length) return null

    const raw = this.store.searchSimilar(queryEmbedding, Math.max(limit * 3, 12))
    const snippets = rerankSnippets(normalizedQuestion, raw, limit)

    if (snippets.length === 0) {
      return null
    }

    return {
      profileId: DEFAULT_PROFILE_ID,
      embeddingModel: this.embeddingProvider.model,
      promptContext: buildPromptContext(snippets),
      snippets
    }
  }
}
