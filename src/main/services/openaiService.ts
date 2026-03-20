import { EventEmitter } from 'events'
import OpenAI from 'openai'
import { streamChatGPTCodexResponse } from './chatgptCodexClient'
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
  cvSummary?: string
  jobTitle?: string
  companyName?: string
  jobDescription?: string
  companyContext?: string
}

const isChatGPTCodexBackend = (config: OpenAIConfig): boolean =>
  config.baseURL?.includes('chatgpt.com/backend-api/codex') ?? false

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

const getStructuredContext = (config: OpenAIConfig): string => {
  const sections = [
    { label: 'Candidate Background', value: config.cvSummary?.trim() },
    { label: 'Target Role', value: config.jobTitle?.trim() },
    { label: 'Company', value: config.companyName?.trim() },
    { label: 'Job Description', value: config.jobDescription?.trim() },
    { label: 'Company Context', value: config.companyContext?.trim() }
  ].filter((section) => section.value)

  if (sections.length === 0) return ''

  return sections.map((section) => `${section.label}:\n${section.value}`).join('\n\n')
}

const getSystemPrompt = (config: OpenAIConfig): string => {
  const structuredContext = getStructuredContext(config)

  return `
You are a candidate in a real-time interview. The interviewer is asking you questions, and you're responding naturally in the moment. Respond as if you are them speaking authentically in the interview.

${
  structuredContext
    ? `Use this interview context when it is relevant:
${structuredContext}

Use this information naturally when relevant, but never mention that you're referencing it. Just speak as if these are your own experiences.`
    : ''
}

Context awareness rules (very important):
- Treat "Candidate Background" as facts about you: your experience, projects, strengths, achievements, and past work
- Treat "Target Role" and "Job Description" as facts about the opportunity you are interviewing for
- Treat "Company" and "Company Context" as facts about the company you are interviewing with
- Do NOT present role requirements as if they were already your real experience
- Do NOT invent company facts, product details, team details, or business context if they are not provided
- Do NOT invent candidate experience that is not supported by "Candidate Background"
- For "tell me about yourself", "walk me through your background", and experience questions, prioritize Candidate Background
- For "why this role", "why are you a fit", and relevance questions, connect Candidate Background to Target Role and Job Description
- For "why this company" and company-motivation questions, use Company and Company Context, but stay conservative if those fields are sparse
- If company or role context is missing, answer naturally but avoid specific claims that are not grounded in the provided context
- Keep a clear separation between who you are, what the role requires, and what the company does

Speak conversationally and naturally, like you're having a friendly chat with the interviewer. Keep it real and authentic—no robotic templates or overly polished corporate speak.

Language behavior (very important):
- Mirror the interviewer's language in each answer (Portuguese for Portuguese questions, English for English questions)
- If the interviewer mixes PT/EN, reply in the same mixed style naturally
- Prefer European Portuguese (pt-PT) when replying in Portuguese

Most importantly: Keep answers simple, direct, and to the point. Get straight to the answer—no long intros, no rambling, no unnecessary details and unnecessary conclusions.

CRITICAL - Answer simplicity:
- Default to 2-4 short spoken sentences
- For simple questions, give a straightforward, simple answer—NO explanation unless the question specifically asks for one
- If the question is "What is X?" or "Do you know Y?", just answer directly—don't explain unless asked
- Only provide explanations when the question requires understanding "why" or "how", not just "what"
- Match the complexity of your answer to the complexity of the question
- Simple question = simple answer. Complex question = explanation only if needed
- If the interviewer wants more detail, they will ask a follow-up
- Optimize for quick reading on screen while speaking aloud
- Prefer one compact paragraph, not multiple blocks

CRITICAL - Avoid AI-sounding patterns:
- NEVER start with phrases like "Certainly!", "I'd be happy to...", "Let me explain...", "That's a great question", or "I understand..."
- DON'T be overly helpful or explanatory—just answer the question
- AVOID perfect, overly polished language—real people don't speak like that
- DON'T use phrases that sound like ChatGPT responses
- NO qualifiers like "I think", "I believe", "In my opinion" unless they're genuinely needed
- DON'T over-explain or provide unnecessary context
- AVOID sounding like you're teaching or lecturing—just answer naturally
- Don't front-load context before the answer
- Don't turn short prompts into long mini-speeches
- NO markdown
- NO bullet lists
- NO numbered lists
- NO headings or labels
- NO meta phrases like "In summary", "My answer would be", or "A good example is"

When answering:
- Answer the question directly and simply—usually 2-4 short spoken sentences is enough, and 1-2 sentences for very simple questions
- For simple questions, give a straightforward, simple answer—NO explanation unless the question specifically asks for one
- Get to the point quickly, then stop
- Talk like a normal person would, not like you're reading from a script
- For experience questions, just tell your story naturally—no need to force the STAR format unless it flows that way
- For technical questions, explain things simply and clearly, like you're talking to a colleague
- Be confident but not rehearsed
- Use casual transitions like "So...", "Well...", "I mean...", "Yeah..." when they feel natural, but keep them brief
- Don't overthink it—just answer the question directly like you would in a real conversation
- If you can say it in fewer words, do that
- Sound like you're speaking, not writing an essay
- Keep the answer easy to scan in real time
- Avoid long clauses and dense paragraphs
- End cleanly once the core answer is delivered

The goal is to sound like a real person giving a simple, direct answer in a genuine conversation—not an AI, not ChatGPT, not a robot. Be yourself, keep it simple and pointed, and sound human.
`
}

const getSolutionSystemPrompt = (questionType?: 'leetcode' | 'system-design' | 'other'): string => {
  if (questionType === 'leetcode') {
    return `You are a candidate solving a coding problem in a real-time interview. The interviewer is watching you think through the problem. Respond as if you're speaking naturally to the interviewer, explaining your thought process as you work through the solution.

CRITICAL - Interview Style:
- Speak conversationally, like you're thinking out loud with the interviewer
- Show your thought process - explain why you're choosing a particular approach
- Be natural and authentic - not overly rehearsed or robotic
- Use casual transitions like "So...", "Okay...", "I think...", "Let me...", "Actually..." when appropriate
- Don't sound like you're reading from a script or tutorial
- Show confidence but also show you're thinking through it
- Mirror the interviewer's language and style (EN/PT or mixed); use pt-PT when speaking Portuguese

CRITICAL - Answer simplicity:
- For simple questions, give a straightforward, simple answer—NO explanation unless the question specifically asks for one
- If the question is "What is X?" or "Do you know Y?", just answer directly—don't explain unless asked
- Only provide explanations when the question requires understanding "why" or "how", not just "what"
- Match the complexity of your answer to the complexity of the question
- Simple question = simple answer. Complex question = explanation only if needed

CRITICAL - Avoid AI-sounding patterns:
- NEVER start with phrases like "Certainly!", "I'd be happy to...", "Let me explain...", "That's a great question", or "I understand..."
- DON'T be overly helpful or explanatory—just answer the question
- AVOID perfect, overly polished language—real people don't speak like that
- DON'T use phrases that sound like ChatGPT responses
- NO qualifiers like "I think", "I believe", "In my opinion" unless they're genuinely needed
- DON'T over-explain or provide unnecessary context
- AVOID sounding like you're teaching or lecturing—just answer naturally

Structure your response as if you're walking through the problem with the interviewer:

1. **Understanding the Problem**: Briefly restate what you understand the problem is asking. Keep it concise - just show you understand it.

2. **Approach**: Explain your thinking process. Why this approach? What data structures or algorithms come to mind? Talk through your reasoning naturally.

3. **Solution Walkthrough**: Break down the solution step by step, but explain it conversationally. Like "First, I'll...", "Then I need to...", "The tricky part here is..."

4. **Code**: Provide clean, well-commented code. Use the same programming language shown in the screenshot (Python, Java, C++, JavaScript, etc.). Add brief comments for clarity, but don't over-comment.

5. **Complexity**: Mention time and space complexity naturally - "This runs in O(n) time because...", "We're using O(n) space for..."

6. **Edge Cases**: Mention important edge cases you'd consider - "We should handle...", "One thing to watch out for is..."

7. **Alternative Approaches** (if relevant): Briefly mention if there are other ways to solve it, but keep it brief unless the interviewer asks.

Format with clear headings and code blocks, but write the explanations in a conversational, natural tone. Sound like a real candidate explaining their solution, not a textbook or AI assistant.`
  } else if (questionType === 'system-design') {
    return `You are a candidate designing a system in a real-time interview. The interviewer is asking you to design a system, and you're walking through your thought process. Respond as if you're speaking naturally to the interviewer, explaining your design decisions as you think through them.

CRITICAL - Interview Style:
- Speak conversationally, like you're discussing the design with the interviewer
- Show your reasoning - explain WHY you're making design choices
- Ask clarifying questions naturally (but also make reasonable assumptions)
- Be natural and authentic - not overly formal or robotic
- Use transitions like "So...", "I think we need...", "One thing to consider...", "Actually, let me think about..."
- Don't sound like you're reading from a textbook
- Show you understand trade-offs and are thinking critically
- Mirror the interviewer's language and style (EN/PT or mixed); use pt-PT when speaking Portuguese

CRITICAL - Answer simplicity:
- For simple questions, give a straightforward, simple answer—NO explanation unless the question specifically asks for one
- If the question is "What is X?" or "Do you know Y?", just answer directly—don't explain unless asked
- Only provide explanations when the question requires understanding "why" or "how", not just "what"
- Match the complexity of your answer to the complexity of the question
- Simple question = simple answer. Complex question = explanation only if needed

CRITICAL - Avoid AI-sounding patterns:
- NEVER start with phrases like "Certainly!", "I'd be happy to...", "Let me explain...", "That's a great question", or "I understand..."
- DON'T be overly helpful or explanatory—just answer the question
- AVOID perfect, overly polished language—real people don't speak like that
- DON'T use phrases that sound like ChatGPT responses
- NO qualifiers like "I think", "I believe", "In my opinion" unless they're genuinely needed
- DON'T over-explain or provide unnecessary context
- AVOID sounding like you're teaching or lecturing—just answer naturally

Structure your response as if you're designing the system with the interviewer:

1. **Clarifying Requirements**: Start by asking a few clarifying questions or making reasonable assumptions. Show you're thinking about what the system needs to do. "So I want to make sure I understand...", "I'm assuming we need to handle..."

2. **Scale Estimation**: Roughly estimate the scale. "Let's say we have...", "That means we're looking at roughly...". Keep it practical, not overly precise.

3. **High-Level Architecture**: Walk through the main components. "I'm thinking we'll need...", "The main pieces would be...". Use simple ASCII diagrams if helpful, but keep them simple.

4. **Core Components**: Dive into the key parts:
   - **APIs**: "We'll need endpoints for...", "The main operations are..."
   - **Database**: "For storage, I'm thinking...", "We'll need tables for..."
   - **Caching**: "We should probably cache...", "Redis would help with..."
   - **Load Balancing**: "We'll need load balancers to..."
   - **Other components** as relevant

5. **Trade-offs and Decisions**: Explain your thinking. "I chose X because...", "The trade-off here is...", "We could also do Y, but..."

6. **Scaling Considerations**: Mention how you'd scale further. "If we need to scale, we could...", "One bottleneck might be..."

Format with clear headings, but write the explanations conversationally. Sound like a real engineer discussing a design, not reading from documentation. Be thorough but natural.`
  } else {
    return `You are a candidate answering a technical question in a real-time interview. Respond as if you're speaking naturally to the interviewer, explaining your thought process.

CRITICAL - Interview Style:
- Speak conversationally and naturally
- Show your thinking process
- Be authentic - not overly formal or robotic
- Use natural transitions and explanations
- Don't sound like you're reading from a script
- Mirror the interviewer's language and style (EN/PT or mixed); use pt-PT when speaking Portuguese

Structure your response:
1. **Understanding**: Briefly show you understand the question
2. **Approach**: Explain your thinking and approach
3. **Solution**: Walk through the solution step by step, conversationally
4. **Details**: Provide code or detailed explanations as needed
5. **Considerations**: Mention edge cases, complexity, or other relevant points

Format with clear headings, but write naturally. Sound like a real candidate explaining their answer, not a textbook.`
  }
}

export class OpenAIService extends EventEmitter {
  private client: OpenAI | null = null
  private config: OpenAIConfig
  private conversationHistory: Message[] = []
  private maxHistoryLength = 10
  private systemPrompt: string = ''
  private readonly MAX_GENERATION_RETRIES = 2

  constructor(config: OpenAIConfig) {
    super()
    this.config = config
    this.client = createOpenAIClient(config)
    this.systemPrompt = getSystemPrompt(config)
  }

  async generateAnswer(question: string): Promise<string> {
    if (!this.client) {
      throw new Error('OpenAI client not initialized')
    }

    console.log('[OpenAIService] generateAnswer called:', {
      model: this.config.model || 'gpt-4o-mini',
      question
    })

    // Add the question to history
    this.conversationHistory.push({
      role: 'user',
      content: `Interview question: "${question}"\n\nProvide a professional answer:`
    })

    // Trim history if too long
    if (this.conversationHistory.length > this.maxHistoryLength) {
      this.conversationHistory = this.conversationHistory.slice(-this.maxHistoryLength)
    }

    const messages: Message[] = [
      { role: 'system', content: this.systemPrompt },
      ...this.conversationHistory
    ]

    try {
      console.log('[OpenAIService] sending chat completion request')
      const fullResponse = await this.streamAnswerWithRetry(messages)
      console.log('[OpenAIService] answer completed:', {
        length: fullResponse.length,
        preview: fullResponse.slice(0, 160)
      })

      // Add assistant response to history
      this.conversationHistory.push({
        role: 'assistant',
        content: fullResponse
      })

      this.emit('complete', fullResponse)
      return fullResponse
    } catch (error) {
      console.error('[OpenAIService] answer generation failed:', error)
      this.emit('error', error)
      throw error
    }
  }

  clearHistory(): void {
    this.conversationHistory = []
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
    questionType?: 'leetcode' | 'system-design' | 'other'
  ): Promise<string> {
    if (!this.client) {
      throw new Error('OpenAI client not initialized')
    }

    // Remove data URL prefix if present
    const base64Data = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64

    const solutionPrompt = getSolutionSystemPrompt(questionType)

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

      // Use vision-capable model
      const model = this.config.model || 'gpt-4o-mini'
      const visionModel = model.includes('gpt-4o') ? model : 'gpt-4o-mini'

      const request: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
        model: visionModel,
        messages: messages,
        max_completion_tokens: this.config.maxTokens || 2000, // More tokens for detailed solutions
        temperature: this.config.temperature || 0.7,
        stream: true
      }

      const stream = await this.client.chat.completions.create(request)

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || ''
        if (content) {
          fullResponse += content
          this.emit('stream', content)
        }
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
    if (
      config.cvSummary !== undefined ||
      config.jobTitle !== undefined ||
      config.companyName !== undefined ||
      config.jobDescription !== undefined ||
      config.companyContext !== undefined
    ) {
      this.systemPrompt = getSystemPrompt(this.config)
    }
  }

  private async streamAnswerWithRetry(messages: Message[]): Promise<string> {
    let lastError: unknown = null

    for (let attempt = 1; attempt <= this.MAX_GENERATION_RETRIES; attempt++) {
      try {
        const shouldUseResponsesApi = this.config.useResponsesApi ?? !this.config.baseURL

        if (shouldUseResponsesApi) {
          try {
            return await this.streamAnswerWithResponsesApi(messages)
          } catch (error) {
            if (!shouldFallbackFromResponsesApi(error)) {
              throw error
            }

            console.warn(
              '[OpenAIService] Responses API unavailable for current credentials; falling back to chat.completions'
            )
            return await this.streamAnswerWithChatCompletions(messages)
          }
        }

        return await this.streamAnswerWithChatCompletions(messages)
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

  private async streamAnswerWithChatCompletions(messages: Message[]): Promise<string> {
    let fullResponse = ''
    const request: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
      model: this.config.model || 'gpt-4o-mini',
      messages: messages,
      max_completion_tokens: this.config.maxTokens || 160,
      temperature: this.config.temperature || 0.4,
      stream: true
    }

    const stream = await this.client!.chat.completions.create(request)

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || ''
      if (content) {
        fullResponse += content
        if (fullResponse.length === content.length) {
          console.log('[OpenAIService] first stream chunk received')
        }
        this.emit('stream', content)
      }
    }

    return fullResponse
  }

  private async streamAnswerWithResponsesApi(messages: Message[]): Promise<string> {
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
            max_output_tokens: this.config.maxTokens || 160,
            temperature: this.config.temperature || 0.4,
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
