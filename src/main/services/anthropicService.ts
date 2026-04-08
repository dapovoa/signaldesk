import { EventEmitter } from 'events'

export interface AnthropicMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface AnthropicConfig {
  apiKey: string
  baseURL?: string
  model?: string
  maxTokens?: number
  temperature?: number
}

export interface GenerateAnswerOptions {
  identityBase?: string
  interviewContext?: string
  avatarContext?: string
}

const SIGNALDESK_VERBOSE = process.env.SIGNALDESK_VERBOSE === '1'
const ANTHROPIC_VERBOSE_LOGS = SIGNALDESK_VERBOSE || process.env.SIGNALDESK_ANTHROPIC_VERBOSE === '1'

const MAX_INTERVIEW_ANSWER_TOKENS = 600

const splitSentences = (text: string): string[] =>
  text
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean)

const trimToWordLimit = (text: string, maxWords: number): string => {
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length <= maxWords) return text
  return words.slice(0, maxWords).join(' ')
}

const normalizeInterviewAnswer = (raw: string): string => {
  let text = raw
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/[`*_]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  const sentences = splitSentences(text).slice(0, 3)

  text = sentences.join(' ')
  text = trimToWordLimit(text || raw, 95).trim()

  if (!text) return ''
  if (!/[.!?]$/.test(text)) text += '.'
  return text
}

export class AnthropicService extends EventEmitter {
  private config: AnthropicConfig
  private baseURL: string

  constructor(config: AnthropicConfig) {
    super()
    this.config = config
    this.baseURL = (config.baseURL || 'https://api.minimax.io/anthropic').replace(/\/+$/, '')
  }

  updateConfig(config: Partial<AnthropicConfig>): void {
    this.config = { ...this.config, ...config }
    if (config.baseURL) {
      this.baseURL = config.baseURL.replace(/\/+$/, '')
    }
  }

  async generateAnswer(
    question: string,
    options?: GenerateAnswerOptions,
    requestId = Date.now()
  ): Promise<string> {
    const systemPrompt = this.buildSystemPrompt(
      question,
      options?.identityBase || '',
      options?.interviewContext || '',
      options?.avatarContext || ''
    )

    if (ANTHROPIC_VERBOSE_LOGS) {
      console.log('[AnthropicService] generateAnswer called:', {
        model: this.config.model || 'MiniMax-M2.7',
        question
      })
    }

    const messages: AnthropicMessage[] = [
      { role: 'user', content: question }
    ]

    try {
      const fullResponse = await this.streamAnswerWithRetry(messages, {
        systemPrompt,
        requestId
      })

      const normalizedResponse = normalizeInterviewAnswer(fullResponse)

      if (ANTHROPIC_VERBOSE_LOGS) {
        console.log('[AnthropicService] answer completed:', {
          length: normalizedResponse.length,
          text: normalizedResponse
        })
      }

      this.emit('complete', { requestId, answer: normalizedResponse })
      return normalizedResponse
    } catch (error) {
      console.error('[AnthropicService] answer generation failed:', error)
      this.emit('error', { requestId, error })
      throw error
    }
  }

  private buildSystemPrompt(
    question: string,
    identityBase: string,
    interviewContext: string,
    avatarContext: string
  ): string {
    const structuredContext = [identityBase, interviewContext, avatarContext]
      .filter(Boolean)
      .join('\n\n')

    return `You are conducting a professional job interview as a candidate.

Identity Base is the source of truth for how I speak, reason, and position myself.
Interview Context is the source of truth for the role, company, and current interview setup.
Retrieved Candidate Memory is supporting evidence from my past work. Use it only when it is relevant.

Do not present role requirements or company context as if they were already my own past experience.
Do not invent company facts, product details, team details, or business context if they are not provided.
Do not claim I have used a specific tool, service, framework, or platform unless it is grounded in the provided context as my own past experience.
If the interviewer mentions a tool, framework, or platform, treat that as a hypothetical or target environment unless my own prior use is grounded in the provided context.
Never invent named tools, products, services, or frameworks just to make the answer sound more complete.
If something is not grounded, keep it generic or say what I would check first.

Answer the current interview question directly.
Default to first-person singular ("I"), not "we", unless the interviewer is clearly asking about team coordination.
Keep the answer grounded in Identity Base, Interview Context, and Retrieved Candidate Memory.
If the provided context does not support a factual claim, do not invent it.
Prefer real work experience and production incidents over personal projects.
Mention personal projects only when the interviewer explicitly asks about projects, portfolio, or side work.
Keep the answer short, light, and human. This is a real interview answer, not a lecture or script.

Output contract (mandatory):
1) Plain text only. No markdown, no bullets, no numbered lists, no headings.
2) Default to 2 sentences. Hard maximum: 3 sentences.
3) Keep vocabulary simple and natural.
4) Focus on one concrete path and stop. Do not expand with optional sections.
5) No filler, no motivational language, no coaching tone.
6) Keep sentence flow natural and spoken.
7) Avoid heavy jargon and acronyms unless the interviewer explicitly used them.
8) Prefer plain wording over specialist labels when both are correct.

${structuredContext ? `Context:\n${structuredContext}` : ''}

Question: ${question}`
  }

  private async streamAnswerWithRetry(
    messages: AnthropicMessage[],
    options?: { systemPrompt?: string; requestId?: number }
  ): Promise<string> {
    let lastError: unknown = null
    const maxRetries = 2

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.streamAnswer(messages, options)
      } catch (error) {
        lastError = error
        if (attempt < maxRetries) {
          const backoffMs = 300 * attempt
          await new Promise((resolve) => setTimeout(resolve, backoffMs))
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error('Answer generation failed')
  }

  private async streamAnswer(
    messages: AnthropicMessage[],
    options?: { systemPrompt?: string; requestId?: number }
  ): Promise<string> {
    const model = this.config.model || 'MiniMax-M2.7'
    const maxTokens = this.config.maxTokens || MAX_INTERVIEW_ANSWER_TOKENS
    const temperature = this.config.temperature ?? 1

    const body: Record<string, unknown> = {
      model,
      max_tokens: maxTokens,
      temperature,
      messages: messages.map((msg) => ({
        role: msg.role,
        content: [{ type: 'text', text: msg.content }]
      }))
    }

    if (options?.systemPrompt) {
      body.system = [
        { type: 'text', text: options.systemPrompt }
      ]
    }

    if (ANTHROPIC_VERBOSE_LOGS) {
      console.log('[AnthropicService] Sending request:', {
        url: `${this.baseURL}/v1/messages`,
        model,
        maxTokens,
        temperature
      })
    }

    const apiKey = this.config.apiKey || ''

    const response = await fetch(`${this.baseURL}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Anthropic API error: ${response.status} ${errorText}`)
    }

    const data = await response.json()

    if (ANTHROPIC_VERBOSE_LOGS) {
      console.log('[AnthropicService] Raw response:', JSON.stringify(data, null, 2))
    }

    if (data.content && Array.isArray(data.content)) {
      const textContent = data.content
        .filter((block: { type: string; text?: string }) => block.type === 'text')
        .map((block: { text?: string }) => block.text || '')
        .join('')

      return textContent
    }

    if (data.error) {
      throw new Error(`Anthropic API error: ${JSON.stringify(data.error)}`)
    }

    console.warn('[AnthropicService] Unexpected response format:', data)
    return ''
  }
}