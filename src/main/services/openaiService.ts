import { EventEmitter } from 'events'
import OpenAI from 'openai'
import { streamChatGPTCodexResponse } from './chatgptCodexClient'
import { getDefaultOutputTokens, isDeepSeekModelConfig } from './llmDefaults'
import { createOpenAIClient } from './openaiClient'

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

const isDeepSeekConfig = (config: OpenAIConfig): boolean => isDeepSeekModelConfig(config)

const getConfiguredMaxTokens = (config: OpenAIConfig): number =>
  config.maxTokens ?? getDefaultOutputTokens(config)

const MAX_INTERVIEW_ANSWER_TOKENS = 160

const simplifyInterviewAnswer = (raw: string): string => {
  let text = raw
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/[`*_]/g, '')
    .replace(/[;:]/g, ',')
    .replace(/[—–]/g, ',')
    .replace(/\s+/g, ' ')
    .trim()

  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 2)

  text = sentences.join(' ')

  if (!text) return ''
  if (!/[.!?]$/.test(text)) text += '.'
  return text
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

interface AvatarPromptVariables {
  identityBase: string
  interviewContext: string
  retrievedCandidateMemory: string
}

const buildAvatarPromptVariables = (
  identityBase = '',
  interviewContext = '',
  avatarContext = ''
): AvatarPromptVariables => ({
  identityBase: identityBase.trim(),
  interviewContext: interviewContext.trim(),
  retrievedCandidateMemory: avatarContext.trim()
})

const renderAvatarPromptVariables = (variables: AvatarPromptVariables): string => {
  const sections = [
    { label: 'Identity Base', value: variables.identityBase },
    { label: 'Interview Context', value: variables.interviewContext },
    { label: 'Retrieved Candidate Memory', value: variables.retrievedCandidateMemory }
  ].filter((section) => section.value)

  if (sections.length === 0) return ''

  return sections.map((section) => `${section.label}:\n${section.value}`).join('\n\n')
}

const getSharedInterviewPrompt = (
  question = '',
  identityBase = '',
  interviewContext = '',
  avatarContext = ''
): string => {
  const promptVariables = buildAvatarPromptVariables(identityBase, interviewContext, avatarContext)
  const structuredContext = renderAvatarPromptVariables(promptVariables)
  const languageOverlay = getLanguageOverlay(question)

  return `
You are me in a real technical interview.

${
  structuredContext
    ? `Use this context when it is relevant:
${structuredContext}
`
    : ''
}

Grounding rules:
- Identity Base is the source of truth for how I speak, reason, and position myself.
- Interview Context is the source of truth for the role, company, and current interview setup.
- Retrieved Candidate Memory is supporting evidence from my past work. Use it only when it is relevant.
- Do not present role requirements or company context as if they were already my own past experience.
- Do not invent company facts, product details, team details, or business context if they are not provided.
- Do not claim I have used a specific tool, service, framework, or platform unless it is grounded in the provided context as my own past experience.
- If the interviewer mentions a tool, framework, or platform, treat that as a hypothetical or target environment unless my own prior use is grounded in the provided context.
- Never invent named tools, products, services, or frameworks just to make the answer sound more complete.
- If something is not grounded, keep it generic or say what I would check first.

${languageOverlay}
`
}

type PromptLanguage = 'pt' | 'en' | 'mixed'

const detectPromptLanguage = (question: string): PromptLanguage => {
  const lower = question.toLowerCase()
  const ptSignals = [
    ' como ',
    ' porque ',
    ' porquê ',
    ' qual ',
    ' quais ',
    ' onde ',
    ' quando ',
    ' experiência ',
    ' equipa ',
    ' empresa ',
    ' função ',
    ' sistema ',
    ' infraestrutura ',
    ' desempenho '
  ]
  const enSignals = [
    ' how ',
    ' why ',
    ' what ',
    ' which ',
    ' where ',
    ' when ',
    ' experience ',
    ' team ',
    ' company ',
    ' role ',
    ' system ',
    ' infrastructure ',
    ' performance '
  ]

  const normalized = ` ${lower} `
  const ptCount = ptSignals.filter((signal) => normalized.includes(signal)).length
  const enCount = enSignals.filter((signal) => normalized.includes(signal)).length

  if (ptCount > 0 && enCount > 0) return 'mixed'
  if (ptCount > 0) return 'pt'
  return 'en'
}

const getLanguageOverlay = (question: string): string => {
  const language = detectPromptLanguage(question)

  if (language === 'pt') {
    return `
Language overlay for this answer:
- Respond in European Portuguese (pt-PT).`
  }

  if (language === 'mixed') {
    return `
Language overlay for this answer:
- Mirror the interviewer's mixed PT/EN style naturally.`
  }

  return `
Language overlay for this answer:
- Respond in English.`
}

const getSystemPrompt = (
  config: OpenAIConfig,
  question = '',
  identityBase = '',
  interviewContext = '',
  avatarContext = ''
): string => {
  return `${getSharedInterviewPrompt(
    question,
    identityBase,
    interviewContext,
    avatarContext
  )}

Execution rules:
- Identity Base is mandatory and has higher priority than interviewer style or wording.
- Answer the current interview question directly.
- Default to first-person singular ("I"), not "we", unless the interviewer is clearly asking about team coordination.
- Keep the answer grounded in Identity Base, Interview Context, and Retrieved Candidate Memory.
- If the provided context does not support a factual claim, do not invent it.
- Keep the answer short every time, even when the question is broad or asks for a walkthrough.
- Output contract (mandatory):
  1) Plain text only. No markdown, no bullets, no numbered lists, no headings.
  2) Maximum 4 sentences.
  3) Maximum 90 words.
  4) Focus on one concrete path and stop. Do not expand with optional sections.
  5) No filler, no motivational language, no coaching tone.
${isDeepSeekConfig(config) ? '- DeepSeek specific: stay brief and strict with the output contract.' : ''}
`
}

const getSolutionSystemPrompt = (
  question = '',
  identityBase = '',
  interviewContext = '',
  avatarContext = '',
  questionType?: 'leetcode' | 'system-design' | 'other'
): string => {
  const sharedPrompt = getSharedInterviewPrompt(
    question,
    identityBase,
    interviewContext,
    avatarContext
  )

  if (questionType === 'leetcode') {
    return `${sharedPrompt}

This is a coding problem from a live interview.
- Explain the approach briefly and naturally.
- Provide code in the language shown in the screenshot.
- Include only the reasoning needed to make the solution understandable.
- Mention complexity only if it is relevant.`
  } else if (questionType === 'system-design') {
    return `${sharedPrompt}

This is a system design discussion from a live interview.
- Clarify assumptions when needed.
- Walk through the design in a practical order.
- Mention trade-offs only when they matter to the design choice.
- Keep the explanation grounded and conversational.`
  } else {
    return `${sharedPrompt}

This is a live technical interview question.
- Answer it directly.
- Keep the explanation practical.
- Add extra detail only when the question clearly needs it.`
  }
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
    this.systemPrompt = getSystemPrompt(config)
  }

  async generateAnswer(question: string, options?: GenerateAnswerOptions): Promise<string> {
    if (!this.client) {
      throw new Error('OpenAI client not initialized')
    }

    console.log('[OpenAIService] generateAnswer called:', {
      model: this.config.model || 'gpt-4o-mini',
      question
    })

    const systemPrompt = getSystemPrompt(
      this.config,
      question,
      options?.identityBase || '',
      options?.interviewContext || '',
      options?.avatarContext || ''
    )
    this.systemPrompt = systemPrompt
    console.log('[OpenAIService] system prompt variables:', buildAvatarPromptVariables(
      options?.identityBase || '',
      options?.interviewContext || '',
      options?.avatarContext || ''
    ))
    console.log('[OpenAIService] system prompt preview:', systemPrompt.slice(0, 1200))
    const messages: Message[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: question }
    ]

    try {
      console.log('[OpenAIService] sending chat completion request')
      const fullResponse = await this.streamAnswerWithRetry(messages, {
        maxTokensCap: MAX_INTERVIEW_ANSWER_TOKENS
      })
      const normalizedResponse = simplifyInterviewAnswer(fullResponse)
      console.log('[OpenAIService] answer completed:', {
        length: normalizedResponse.length,
        preview: normalizedResponse.slice(0, 160)
      })

      this.emit('complete', normalizedResponse)
      return normalizedResponse
    } catch (error) {
      console.error('[OpenAIService] answer generation failed:', error)
      this.emit('error', error)
      throw error
    }
  }

  clearHistory(): void {
    // No-op: answers are generated from the current question only.
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
    options?: GenerateAnswerOptions
  ): Promise<string> {
    if (!this.client) {
      throw new Error('OpenAI client not initialized')
    }

    // Remove data URL prefix if present
    const base64Data = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64

    const solutionPrompt = getSolutionSystemPrompt(
      questionText || '',
      options?.identityBase || '',
      options?.interviewContext || '',
      options?.avatarContext || '',
      questionType
    )
    console.log('[OpenAIService] screenshot prompt variables:', buildAvatarPromptVariables(
      options?.identityBase || '',
      options?.interviewContext || '',
      options?.avatarContext || ''
    ))
    console.log('[OpenAIService] screenshot prompt preview:', solutionPrompt.slice(0, 1200))

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: solutionPrompt },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: questionText
              ? `Here is the interview question: "${questionText}"\n\nProvide a detailed step-by-step solution with code examples:`
              : `Analyze this screenshot carefully. Extract the interview question/problem statement from the image, then provide a detailed step-by-step solution with code examples.

First, identify what the question is asking, then provide:
- Problem understanding
- Approach explanation
- Step-by-step solution
- Code implementation with comments
- Complexity analysis`
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
      let truncated = false

      // Use vision-capable model
      const model = this.config.model || 'gpt-4o-mini'
      const visionModel = model.includes('gpt-4o') ? model : 'gpt-4o-mini'

      const request: StreamingChatCompletionRequest = {
        model: visionModel,
        messages: messages,
        temperature: this.config.temperature ?? 0.7,
        stream: true
      }

      const maxTokens = getConfiguredMaxTokens(this.config)
      if (isDeepSeekConfig(this.config)) {
        request.max_tokens = maxTokens
      } else {
        request.max_completion_tokens = maxTokens
      }

      if (this.config.extraBody) {
        request.extra_body = this.config.extraBody
      }

      console.log('[OpenAIService] screenshot request params:', {
        model: request.model,
        temperature: request.temperature,
        max_tokens: request.max_tokens,
        max_completion_tokens: request.max_completion_tokens
      })

      const stream = await this.client.chat.completions.create(
        request as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming
      )

      for await (const chunk of stream) {
        if (chunk.choices[0]?.finish_reason === 'length') {
          truncated = true
        }
        const content = chunk.choices[0]?.delta?.content || ''
        if (content) {
          fullResponse += content
          this.emit('stream', content)
        }
      }

      if (truncated) {
        this.emit('truncated', {
          reason: 'length',
          maxTokens
        })
      }

      this.emit('complete', fullResponse)
      return fullResponse
    } catch (error) {
      this.emit('error', error)
      throw error
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
    this.systemPrompt = getSystemPrompt(this.config)
  }

  private async streamAnswerWithRetry(
    messages: Message[],
    options?: { maxTokensCap?: number }
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

            console.warn(
              '[OpenAIService] Responses API unavailable for current credentials; falling back to chat.completions'
            )
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
    options?: { maxTokensCap?: number }
  ): Promise<string> {
    let fullResponse = ''
    let truncated = false
    const request: StreamingChatCompletionRequest = {
      model: this.config.model || 'gpt-4o-mini',
      messages: messages,
      temperature: this.config.temperature ?? 0.3,
      top_p: this.config.topP,
      stream: true
    }

    const configuredMaxTokens = getConfiguredMaxTokens(this.config)
    const maxTokens =
      typeof options?.maxTokensCap === 'number'
        ? Math.min(configuredMaxTokens, options.maxTokensCap)
        : configuredMaxTokens
    if (isDeepSeekConfig(this.config)) {
      request.max_tokens = maxTokens
    } else {
      request.max_completion_tokens = maxTokens
    }

    if (this.config.extraBody) {
      request.extra_body = this.config.extraBody
    }

    console.log('[OpenAIService] chat request params:', {
      model: request.model,
      temperature: request.temperature,
      top_p: request.top_p,
      max_tokens: request.max_tokens,
      max_completion_tokens: request.max_completion_tokens
    })

    const stream = await this.client!.chat.completions.create(
      request as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming
    )

    for await (const chunk of stream) {
      if (chunk.choices[0]?.finish_reason === 'length') {
        truncated = true
      }
      const content = chunk.choices[0]?.delta?.content || ''
      if (content) {
        fullResponse += content
        if (fullResponse.length === content.length) {
          console.log('[OpenAIService] first stream chunk received')
        }
        this.emit('stream', content)
      }
    }

    if (truncated) {
      console.warn('[OpenAIService] response truncated by max token limit')
      this.emit('truncated', {
        reason: 'length',
        maxTokens
      })
    }

    return fullResponse
  }

  private async streamAnswerWithResponsesApi(
    messages: Message[],
    options?: { maxTokensCap?: number }
  ): Promise<string> {
    let fullResponse = ''
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

    const configuredMaxTokens = getConfiguredMaxTokens(this.config)
    const maxTokens =
      typeof options?.maxTokensCap === 'number'
        ? Math.min(configuredMaxTokens, options.maxTokensCap)
        : configuredMaxTokens

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
            max_output_tokens: maxTokens,
            temperature: this.config.temperature ?? 0.3,
            top_p: this.config.topP,
            stream: true
          })
    }

    const responseStream = isChatGPTCodexBackend(this.config)
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
        fullResponse += event.delta
        if (fullResponse.length === event.delta.length) {
          console.log('[OpenAIService] first stream chunk received')
        }
        this.emit('stream', event.delta)
      }
    }

    return fullResponse
  }
}
