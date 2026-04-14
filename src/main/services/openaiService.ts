import { EventEmitter } from 'events'
import OpenAI from 'openai'
import {
  AvatarPromptVariables,
  buildAvatarAnswerPrompt,
  buildAvatarSolutionPrompt
} from './avatarAnswerFlow'
import { streamChatGPTCodexResponse } from './chatgptCodexClient'
import { getDefaultOutputTokens } from './llmDefaults'
import { createOpenAIClient } from './openaiClient'
import { appendWithinApproxTokenCap } from './streamTruncation'

export interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface OpenAIConfig {
  apiKey: string
  baseURL?: string
  customHeaders?: string
  chatgptAccountId?: string
  useResponsesApi?: boolean
  model?: string
  maxTokens?: number
  temperature?: number
  topP?: number
  extraBody?: Record<string, unknown>
}

export interface GenerateAnswerOptions {
  identityBase?: string
  answerStyle?: string
  interviewContext?: string
  avatarContext?: string
}

type StreamingChatCompletionRequest =
  OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming & {
    extra_body?: Record<string, unknown>
    max_tokens?: number
  }

const isChatGPTCodexBackend = (config: OpenAIConfig): boolean =>
  config.baseURL?.includes('chatgpt.com/backend-api/codex') ?? false

const getConfiguredMaxTokens = (config: OpenAIConfig): number =>
  config.maxTokens ?? getDefaultOutputTokens(config)

const MAX_INTERVIEW_ANSWER_TOKENS = 220
const SIGNALDESK_VERBOSE = process.env.SIGNALDESK_VERBOSE === '1'
const OPENAI_VERBOSE_LOGS = SIGNALDESK_VERBOSE || process.env.SIGNALDESK_OPENAI_VERBOSE === '1'

const getEffectiveMaxTokens = (
  config: OpenAIConfig,
  options?: { maxTokensCap?: number }
): number => {
  const configuredMaxTokens = getConfiguredMaxTokens(config)
  const cappedMaxTokens =
    typeof options?.maxTokensCap === 'number'
      ? Math.min(configuredMaxTokens, options.maxTokensCap)
      : configuredMaxTokens

  return Math.max(1, cappedMaxTokens)
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

  const sentences = splitSentences(text).slice(0, 3)

  text = sentences.join(' ')
  text = trimToWordLimit(text || raw, 95).trim()

  if (!text) return ''
  if (!/[.!?]$/.test(text)) text += '.'
  return text
}

type TruncationReason = 'provider_length' | 'upper_cap'
type TruncationProvider =
  | 'chat_completions'
  | 'chat_completions_vision'
  | 'responses'
  | 'responses_codex'

interface TruncationEvent {
  reason: TruncationReason
  maxTokens: number
  provider: TruncationProvider
}

export interface OpenAIStreamEvent {
  requestId: number
  chunk: string
}

export interface OpenAICompleteEvent {
  requestId: number
  answer: string
}

export interface OpenAIErrorEvent {
  requestId: number
  error: unknown
}

export interface OpenAITruncatedEvent extends TruncationEvent {
  requestId: number
}

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return ''
}

const getErrorStatus = (error: unknown): number | undefined => {
  if (!error || typeof error !== 'object') return undefined

  const status = Reflect.get(error, 'status')
  return typeof status === 'number' ? status : undefined
}

const shouldFallbackFromResponsesApi = (error: unknown): boolean => {
  const message = getErrorMessage(error).toLowerCase()
  const status = getErrorStatus(error)

  if (message.includes('api.responses.write')) {
    return true
  }

  if (status === 403 && message.includes('responses')) {
    return true
  }

  if ((status === 404 || status === 405) && message.includes('response')) {
    return true
  }

  return false
}

const buildAvatarPromptVariables = (
  identityBase = '',
  answerStyle = '',
  interviewContext = '',
  avatarContext = ''
): AvatarPromptVariables => ({
  identityBase: identityBase.trim(),
  answerStyle: answerStyle.trim(),
  interviewContext: interviewContext.trim(),
  retrievedCandidateMemory: avatarContext.trim()
})

const getSystemPrompt = (
  question = '',
  identityBase = '',
  answerStyle = '',
  interviewContext = '',
  avatarContext = ''
): string => {
  return buildAvatarAnswerPrompt(
    question,
    buildAvatarPromptVariables(identityBase, answerStyle, interviewContext, avatarContext)
  )
}

const getSolutionSystemPrompt = (
  question = '',
  identityBase = '',
  answerStyle = '',
  interviewContext = '',
  avatarContext = '',
  questionType?: 'leetcode' | 'system-design' | 'other'
): string => {
  return buildAvatarSolutionPrompt(
    question,
    buildAvatarPromptVariables(identityBase, answerStyle, interviewContext, avatarContext),
    questionType
  )
}

export class OpenAIService extends EventEmitter {
  private client: OpenAI | null = null
  private config: OpenAIConfig
  private systemPrompt: string = ''
  private readonly MAX_GENERATION_RETRIES = 2

  constructor(config: OpenAIConfig) {
    super()
    this.config = config
    this.client = createOpenAIClient(config)
    this.systemPrompt = getSystemPrompt()
  }

  async generateAnswer(
    question: string,
    options?: GenerateAnswerOptions,
    requestId = Date.now()
  ): Promise<string> {
    if (!this.client) {
      throw new Error('OpenAI client not initialized')
    }

    const systemPrompt = getSystemPrompt(
      question,
      options?.identityBase || '',
      options?.answerStyle || '',
      options?.interviewContext || '',
      options?.avatarContext || ''
    )
    this.systemPrompt = systemPrompt
    if (OPENAI_VERBOSE_LOGS) {
      console.log('[OpenAIService] generateAnswer called:', {
        model: this.config.model || 'gpt-4o-mini',
        question
      })
      console.log('[OpenAIService] system prompt variables:', buildAvatarPromptVariables(
        options?.identityBase || '',
        options?.answerStyle || '',
        options?.interviewContext || '',
        options?.avatarContext || ''
      ))
      console.log('[OpenAIService] system prompt preview:', systemPrompt.slice(0, 1200))
    }
    const messages: Message[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: question }
    ]

    try {
      if (OPENAI_VERBOSE_LOGS) {
        console.log('[OpenAIService] sending chat completion request')
      }
      const fullResponse = await this.streamAnswerWithRetry(messages, {
        maxTokensCap: MAX_INTERVIEW_ANSWER_TOKENS,
        requestId
      })
      const normalizedResponse = normalizeInterviewAnswer(fullResponse)
      if (OPENAI_VERBOSE_LOGS) {
        console.log('[OpenAIService] answer completed:', {
          length: normalizedResponse.length,
          text: normalizedResponse
        })
      }

      this.emit('complete', { requestId, answer: normalizedResponse } satisfies OpenAICompleteEvent)
      return normalizedResponse
    } catch (error) {
      console.error('[OpenAIService] answer generation failed:', error)
      this.emit('error', { requestId, error } satisfies OpenAIErrorEvent)
      throw error
    }
  }

  /**
   * Generates a detailed solution for an interview question from a screenshot
   * @param imageBase64 Base64 encoded image data URL
   * @param questionText Optional extracted question text
   * @param questionType Type of question (leetcode, system-design, other)
   * @returns Generated solution
   */
  async generateSolutionFromImage(
    imageBase64: string,
    questionText?: string,
    questionType?: 'leetcode' | 'system-design' | 'other',
    options?: GenerateAnswerOptions,
    requestId = Date.now()
  ): Promise<string> {
    if (!this.client) {
      throw new Error('OpenAI client not initialized')
    }

    // Remove data URL prefix if present
    const base64Data = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64

    const solutionPrompt = getSolutionSystemPrompt(
      questionText || '',
      options?.identityBase || '',
      options?.answerStyle || '',
      options?.interviewContext || '',
      options?.avatarContext || '',
      questionType
    )
    if (OPENAI_VERBOSE_LOGS) {
      console.log('[OpenAIService] screenshot prompt variables:', buildAvatarPromptVariables(
        options?.identityBase || '',
        options?.answerStyle || '',
        options?.interviewContext || '',
        options?.avatarContext || ''
      ))
      console.log('[OpenAIService] screenshot prompt preview:', solutionPrompt.slice(0, 1200))
    }

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: solutionPrompt },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: questionText
              ? `Here is the interview question: "${questionText}"\n\nAnswer it the way I should say it in the interview. Keep it short, direct, and practical.`
              : `Analyze this screenshot carefully. Extract the interview question or technical prompt from the image, then answer it the way I should say it in the interview. Keep it short, direct, and practical.`
          },
          {
            type: 'image_url',
            image_url: {
              url: `data:image/png;base64,${base64Data}`
            }
          }
        ]
      }
    ]

    try {
      let fullResponse = ''
      let truncationReason: TruncationReason | null = null
      const model = this.config.model || 'gpt-4o-mini'
      const maxTokens = getEffectiveMaxTokens(this.config)

      if (isChatGPTCodexBackend(this.config)) {
        const stream = streamChatGPTCodexResponse({
          accessToken: this.config.apiKey,
          accountId: this.config.chatgptAccountId || '',
          baseURL: this.config.baseURL,
          body: {
            model,
            instructions: solutionPrompt,
            input: [
              {
                role: 'user',
                content: [
                  {
                    type: 'input_text',
                    text: questionText
                      ? `Here is the interview question: "${questionText}"\n\nAnswer it the way I should say it in the interview. Keep it short, direct, and practical.`
                      : `Analyze this screenshot carefully. Extract the interview question or technical prompt from the image, then answer it the way I should say it in the interview. Keep it short, direct, and practical.`
                  },
                  {
                    type: 'input_image',
                    image_url: `data:image/png;base64,${base64Data}`
                  }
                ]
              }
            ],
            tools: [],
            tool_choice: 'auto',
            parallel_tool_calls: false,
            store: false,
            include: []
          }
        })

        for await (const event of stream) {
          if (event.type === 'response.output_text.delta' && event.delta) {
            const appendResult = appendWithinApproxTokenCap(fullResponse, event.delta, maxTokens)
            fullResponse = appendResult.nextResponse

            if (appendResult.emittedChunk) {
              this.emit('stream', {
                requestId,
                chunk: appendResult.emittedChunk
              } satisfies OpenAIStreamEvent)
            }

            if (appendResult.reachedCap) {
              truncationReason = 'upper_cap'
              break
            }
          }
        }

        if (truncationReason) {
          this.emitTruncated({
            requestId,
            reason: truncationReason,
            maxTokens,
            provider: 'responses_codex'
          })
        }

        const normalizedResponse = normalizeInterviewAnswer(fullResponse)
        this.emit('complete', {
          requestId,
          answer: normalizedResponse
        } satisfies OpenAICompleteEvent)
        return normalizedResponse
      }

      const request: StreamingChatCompletionRequest = {
        model,
        messages: messages,
        stream: true
      }
      if (typeof this.config.temperature === 'number') {
        request.temperature = this.config.temperature
      }
      if (typeof this.config.topP === 'number') {
        request.top_p = this.config.topP
      }

      if (this.config.extraBody) {
        request.extra_body = this.config.extraBody
      }

      if (OPENAI_VERBOSE_LOGS) {
        console.log('[OpenAIService] screenshot request params:', {
          model: request.model,
          temperature: request.temperature,
          top_p: request.top_p
        })
      }

      const stream = await this.client.chat.completions.create(
        request as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming
      )

      for await (const chunk of stream) {
        if (chunk.choices[0]?.finish_reason === 'length') {
          truncationReason = truncationReason ?? 'provider_length'
        }
        const content = chunk.choices[0]?.delta?.content || ''
        if (!content) {
          continue
        }

        const appendResult = appendWithinApproxTokenCap(fullResponse, content, maxTokens)
        fullResponse = appendResult.nextResponse

        if (appendResult.emittedChunk) {
          this.emit('stream', {
            requestId,
            chunk: appendResult.emittedChunk
          } satisfies OpenAIStreamEvent)
        }

        if (appendResult.reachedCap) {
          truncationReason = 'upper_cap'
          break
        }
      }

      if (truncationReason) {
        this.emitTruncated({
          requestId,
          reason: truncationReason,
          maxTokens,
          provider: 'chat_completions_vision'
        })
      }

      const normalizedResponse = normalizeInterviewAnswer(fullResponse)
      this.emit('complete', {
        requestId,
        answer: normalizedResponse
      } satisfies OpenAICompleteEvent)
      return normalizedResponse
    } catch (error) {
      this.emit('error', { requestId, error } satisfies OpenAIErrorEvent)
      throw new Error(this.mapImageGenerationError(error))
    }
  }

  updateConfig(config: Partial<OpenAIConfig>): void {
    this.config = { ...this.config, ...config }
    if (
      config.apiKey !== undefined ||
      config.baseURL !== undefined ||
      config.customHeaders !== undefined
    ) {
      this.client = createOpenAIClient(this.config)
    }
    this.systemPrompt = getSystemPrompt()
  }

  private async streamAnswerWithRetry(
    messages: Message[],
    options?: { maxTokensCap?: number; requestId?: number }
  ): Promise<string> {
    let lastError: unknown = null

    for (let attempt = 1; attempt <= this.MAX_GENERATION_RETRIES; attempt++) {
      try {
        const shouldUseResponsesApi = this.config.useResponsesApi ?? !this.config.baseURL

        if (shouldUseResponsesApi) {
          try {
            return await this.streamAnswerWithResponsesApi(messages, options)
          } catch (error) {
            if (!shouldFallbackFromResponsesApi(error)) {
              throw error
            }

            if (OPENAI_VERBOSE_LOGS) {
              console.warn(
                '[OpenAIService] Responses API unavailable for current credentials; falling back to chat.completions'
              )
            }
            return await this.streamAnswerWithChatCompletions(messages, options)
          }
        }

        return await this.streamAnswerWithChatCompletions(messages, options)
      } catch (error) {
        lastError = error
        const isLastAttempt = attempt >= this.MAX_GENERATION_RETRIES
        if (isLastAttempt) break

        const backoffMs = 300 * attempt
        await new Promise((resolve) => setTimeout(resolve, backoffMs))
      }
    }

    throw lastError instanceof Error ? lastError : new Error('Answer generation failed')
  }

  private async streamAnswerWithChatCompletions(
    messages: Message[],
    options?: { maxTokensCap?: number; requestId?: number }
  ): Promise<string> {
    let fullResponse = ''
    let truncationReason: TruncationReason | null = null
    const request: StreamingChatCompletionRequest = {
      model: this.config.model || 'gpt-4o-mini',
      messages: messages,
      stream: true
    }
    if (typeof this.config.temperature === 'number') {
      request.temperature = this.config.temperature
    }
    if (typeof this.config.topP === 'number') {
      request.top_p = this.config.topP
    }

    const maxTokens = getEffectiveMaxTokens(this.config, options)

    if (this.config.extraBody) {
      request.extra_body = this.config.extraBody
    }

    if (OPENAI_VERBOSE_LOGS) {
      console.log('[OpenAIService] chat request params:', {
        model: request.model,
        temperature: request.temperature,
        top_p: request.top_p,
        max_tokens: undefined,
        max_completion_tokens: undefined
      })
    }

    const stream = await this.client!.chat.completions.create(
      request as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming
    )

    for await (const chunk of stream) {
      if (chunk.choices[0]?.finish_reason === 'length') {
        truncationReason = truncationReason ?? 'provider_length'
      }
      const content = chunk.choices[0]?.delta?.content || ''
      if (!content) {
        continue
      }

      const appendResult = appendWithinApproxTokenCap(fullResponse, content, maxTokens)
      fullResponse = appendResult.nextResponse

      if (appendResult.emittedChunk) {
        if (OPENAI_VERBOSE_LOGS && fullResponse.length === appendResult.emittedChunk.length) {
          console.log('[OpenAIService] first stream chunk received')
        }
        this.emit('stream', {
          requestId: options?.requestId ?? 0,
          chunk: appendResult.emittedChunk
        } satisfies OpenAIStreamEvent)
      }

      if (appendResult.reachedCap) {
        truncationReason = 'upper_cap'
        break
      }
    }

    if (truncationReason) {
      this.emitTruncated({
        requestId: options?.requestId ?? 0,
        reason: truncationReason,
        maxTokens,
        provider: 'chat_completions'
      })
    }

    return fullResponse
  }

  private async streamAnswerWithResponsesApi(
    messages: Message[],
    options?: { maxTokensCap?: number; requestId?: number }
  ): Promise<string> {
    let fullResponse = ''
    let truncationReason: TruncationReason | null = null
    const provider: TruncationProvider = isChatGPTCodexBackend(this.config)
      ? 'responses_codex'
      : 'responses'
    const input = messages
      .filter((message) => message.role !== 'system')
      .map((message) => ({
        role: message.role,
        content: [
          {
            type: message.role === 'assistant' ? 'output_text' : 'input_text',
            text: message.content
          }
        ]
      }))

    const maxTokens = getEffectiveMaxTokens(this.config, options)

    const request = {
      model: this.config.model || 'gpt-4o-mini',
      instructions: this.systemPrompt,
      input,
      ...(isChatGPTCodexBackend(this.config)
        ? {
            tools: [],
            tool_choice: 'auto',
            parallel_tool_calls: false,
            store: false,
            stream: true
          }
        : {
            ...(typeof this.config.temperature === 'number'
              ? { temperature: this.config.temperature }
              : {}),
            ...(typeof this.config.topP === 'number' ? { top_p: this.config.topP } : {}),
            stream: true
          })
    }

    const responseStream = provider === 'responses_codex'
      ? streamChatGPTCodexResponse({
          accessToken: this.config.apiKey,
          accountId: this.config.chatgptAccountId || '',
          baseURL: this.config.baseURL,
          body: request
        })
      : ((await this.client!.responses.create(request as never)) as unknown as AsyncIterable<{
          type?: string
          delta?: string
        }>)

    for await (const event of responseStream) {
      if (event.type === 'response.output_text.delta' && event.delta) {
        const appendResult = appendWithinApproxTokenCap(fullResponse, event.delta, maxTokens)
        fullResponse = appendResult.nextResponse

        if (
          OPENAI_VERBOSE_LOGS &&
          appendResult.emittedChunk &&
          fullResponse.length === appendResult.emittedChunk.length
        ) {
          console.log('[OpenAIService] first stream chunk received')
        }
        if (appendResult.emittedChunk) {
          this.emit('stream', {
            requestId: options?.requestId ?? 0,
            chunk: appendResult.emittedChunk
          } satisfies OpenAIStreamEvent)
        }
        if (appendResult.reachedCap) {
          truncationReason = 'upper_cap'
          break
        }
      }
    }

    if (truncationReason) {
      this.emitTruncated({
        requestId: options?.requestId ?? 0,
        reason: truncationReason,
        maxTokens,
        provider
      })
    }

    return fullResponse
  }

  private emitTruncated(event: OpenAITruncatedEvent): void {
    if (OPENAI_VERBOSE_LOGS) {
      console.warn('[OpenAIService] response truncated:', event)
    }
    this.emit('truncated', event)
  }

  private mapImageGenerationError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error)
    const lower = message.toLowerCase()

    if (
      lower.includes('cloudflare') ||
      lower.includes('enable javascript and cookies') ||
      lower.includes('/chat/completions')
    ) {
      return 'OAuth image generation failed due to an incompatible endpoint/challenge response. Please retry after reconnecting OAuth.'
    }

    return message
  }
}
