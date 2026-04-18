import { EventEmitter } from 'events'
import { buildAvatarAnswerPrompt } from './avatarAnswerFlow'

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
  answerStyle?: string
  interviewContext?: string
  avatarContext?: string
}

const SIGNALDESK_VERBOSE = process.env.SIGNALDESK_VERBOSE === '1'
const ANTHROPIC_VERBOSE_LOGS = SIGNALDESK_VERBOSE || process.env.SIGNALDESK_ANTHROPIC_VERBOSE === '1'

const MAX_INTERVIEW_ANSWER_TOKENS = 600

const requireConfiguredModel = (model?: string): string => {
  const normalizedModel = model?.trim()
  if (!normalizedModel) {
    throw new Error('Select or enter an answer generation model before using the LLM.')
  }

  return normalizedModel
}

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

  const sentences = splitSentences(text).slice(0, 5)

  text = sentences.join(' ')
  text = trimToWordLimit(text || raw, 180).trim()

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
    this.baseURL = (config.baseURL || '').replace(/\/+$/, '')
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
      options?.answerStyle || '',
      options?.interviewContext || '',
      options?.avatarContext || ''
    )

    if (ANTHROPIC_VERBOSE_LOGS) {
      console.log('[AnthropicService] generateAnswer called:', {
        model: requireConfiguredModel(this.config.model),
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
    answerStyle: string,
    interviewContext: string,
    avatarContext: string
  ): string {
    return buildAvatarAnswerPrompt(question, {
      identityBase,
      answerStyle,
      interviewContext,
      retrievedCandidateMemory: avatarContext
    })
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
    const model = requireConfiguredModel(this.config.model)
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
