import { BrowserWindow, clipboard, desktopCapturer, ipcMain } from 'electron'
import type { AnswerEntry } from '../../shared/contracts'
import {
  OPENAI_OAUTH_MODEL_OPTIONS,
  resolveLlmCredential,
  usesOAuthCredential
} from '../../shared/llmSettings'
import {
  CHATGPT_CODEX_BASE_URL,
  refreshOpenAIOAuthTokens,
  startOpenAIOAuthFlow
} from '../services/openaiOAuth'
import { HistoryManager } from '../services/historyManager'
import { createOpenAIClient } from '../services/openaiClient'
import {
  OpenAICompleteEvent,
  OpenAIErrorEvent,
  OpenAIService,
  OpenAIStreamEvent,
  OpenAITruncatedEvent
} from '../services/openaiService'
import { AnthropicService } from '../services/anthropicService'
import { QuestionDetector } from '../services/questionDetector'
import { ScreenshotService } from '../services/screenshotService'
import { AppSettings, SettingsManager } from '../services/settingsManager'
import { testAssemblyAIConnection } from '../services/assemblyAIRealtime'
import {
  AvatarProfile,
  AvatarProfileManager
} from '../services/avatarProfileManager'
import { streamChatGPTCodexResponse } from '../services/chatgptCodexClient'
import { llamaCppLlmServer } from '../services/llamaCppLlmServer'
import {
  DEFAULT_LLM_BASE_URL,
  ensureModelsDirectory,
  getDefaultModelsDirectory,
  listLlmModels
} from '../services/localEmbeddingPaths'
import { VisionService } from '../services/visionService'
import { WhisperService } from '../services/whisperService'

let whisperService: WhisperService | null = null
let openaiService: OpenAIService | null = null
let anthropicService: AnthropicService | null = null
let questionDetector: QuestionDetector | null = null
let settingsManager: SettingsManager | null = null
let historyManager: HistoryManager | null = null
let screenshotService: ScreenshotService | null = null
let visionService: VisionService | null = null
let avatarProfileManager: AvatarProfileManager | null = null
let mainWindow: BrowserWindow | null = null
let isCapturing = false
let isGeneratingAnswer = false
let isClassifyingQuestion = false
let lastModelQuestionClassificationAt = 0
let lastTranscriptActivityAt = 0
let utteranceDebounceTimer: NodeJS.Timeout | null = null
let pendingQuestionTimer: NodeJS.Timeout | null = null
let pendingQuestionBase: string | null = null
let pendingQuestionFragments: string[] = []
let isWaylandSession = false
let pipelineEpoch = 1
let nextAnswerRequestId = 1
let activeAnswerRequestId: number | null = null
let activeAnswerEpoch: number | null = null
const QUESTION_FOLLOW_UP_WINDOW_MS = 500
const QUESTION_FINALIZE_AFTER_UTTERANCE_MS = 350
const QUESTION_FINALIZE_AFTER_COMPOUND_UTTERANCE_MS = 700
const SUPPRESS_STALE_NO_QUESTION_MS = 4000
const DEFAULT_PAUSE_THRESHOLD_MS = 1500
const MIN_PAUSE_THRESHOLD_MS = 500
const MAX_PAUSE_THRESHOLD_MS = 3000
const MIN_POST_UTTERANCE_DEBOUNCE_MS = 150
const MAX_POST_UTTERANCE_DEBOUNCE_MS = 600
let lastAnswerCompletedAt = 0

interface AnswerTimingTrace {
  utteranceEndAt: number | null
  debounceElapsedAt: number | null
  classifierTriggeredAt: number | null
  answerRequestedAt: number | null
  ragReadyAt: number | null
  firstStreamAt: number | null
}

interface ProviderConfig {
  apiKey: string
  baseURL?: string
  customHeaders?: string
}

interface TranscriptionConfig {
  provider: 'openai' | 'assemblyai'
  apiKey: string
}

interface ProviderPayloadState {
  provider: 'openai' | 'openai-oauth' | 'openai-compatible' | 'llama.cpp' | 'anthropic-compatible'
  usesOAuthCredential: boolean
  credential?: string
}

let answerTimingTrace: AnswerTimingTrace = {
  utteranceEndAt: null,
  debounceElapsedAt: null,
  classifierTriggeredAt: null,
  answerRequestedAt: null,
  ragReadyAt: null,
  firstStreamAt: null
}
const PIPELINE_VERBOSE =
  process.env.SIGNALDESK_VERBOSE === '1' || process.env.SIGNALDESK_PIPELINE_VERBOSE === '1'
const IPC_HANDLE_CHANNELS = [
  'get-settings',
  'update-settings',
  'get-avatar-profile',
  'update-avatar-profile',
  'generate-answer-manually',
  'get-window-capabilities',
  'connect-openai-oauth',
  'disconnect-openai-oauth',
  'fetch-llm-models',
  'select-llm-model-dir',
  'test-provider-connection',
  'test-transcription-connection',
  'start-capture',
  'stop-capture',
  'get-audio-sources',
  'set-always-on-top',
  'set-window-opacity',
  'minimize-window',
  'close-window',
  'clear-history',
  'get-history',
  'save-history-entry',
  'save-history-entries',
  'clear-saved-history',
  'delete-history-entry',
  'write-to-clipboard',
  'capture-screenshot',
  'call-session-api',
  'analyze-screenshot'
] as const
const IPC_EVENT_CHANNELS = ['audio-data'] as const

const isNotFoundError = (error: unknown): boolean => {
  if (!error) return false
  const msg = error instanceof Error ? error.message : String(error)
  return msg.includes('404') || msg.toLowerCase().includes('not found')
}

const isAudioSourceSelectionCanceled = (error: unknown): boolean => {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error || '')
  const lower = message.toLowerCase()

  return (
    lower.includes('screencastportal') ||
    lower.includes('failed to start the screen cast session') ||
    lower.includes('failed to get sources') ||
    lower.includes('unknown error occurred') ||
    lower.includes('aborterror') ||
    lower.includes('permission dismissed') ||
    lower.includes('user canceled') ||
    lower.includes('user cancelled') ||
    lower.includes('selection canceled') ||
    lower.includes('selection cancelled')
  )
}

const resetAnswerTimingTrace = (): void => {
  answerTimingTrace = {
    utteranceEndAt: null,
    debounceElapsedAt: null,
    classifierTriggeredAt: null,
    answerRequestedAt: null,
    ragReadyAt: null,
    firstStreamAt: null
  }
}

const formatTimingDelta = (from: number | null, to: number | null): string | null => {
  if (!from || !to) return null
  return `${to - from}ms`
}

const logAnswerTimingSummary = (stage: 'complete' | 'error'): void => {
  if (!PIPELINE_VERBOSE) {
    return
  }

  console.log('[Timing] answer path:', {
    stage,
    utteranceToDebounce: formatTimingDelta(
      answerTimingTrace.utteranceEndAt,
      answerTimingTrace.debounceElapsedAt
    ),
    debounceToClassifier: formatTimingDelta(
      answerTimingTrace.debounceElapsedAt,
      answerTimingTrace.classifierTriggeredAt
    ),
    classifierToAnswerRequest: formatTimingDelta(
      answerTimingTrace.classifierTriggeredAt,
      answerTimingTrace.answerRequestedAt
    ),
    answerRequestToRagReady: formatTimingDelta(
      answerTimingTrace.answerRequestedAt,
      answerTimingTrace.ragReadyAt
    ),
    ragReadyToFirstStream: formatTimingDelta(
      answerTimingTrace.ragReadyAt,
      answerTimingTrace.firstStreamAt
    ),
    answerRequestToFirstStream: formatTimingDelta(
      answerTimingTrace.answerRequestedAt,
      answerTimingTrace.firstStreamAt
    ),
    totalFromUtteranceToFirstStream: formatTimingDelta(
      answerTimingTrace.utteranceEndAt,
      answerTimingTrace.firstStreamAt
    )
  })
}

const unregisterIpcHandlers = (): void => {
  for (const channel of IPC_HANDLE_CHANNELS) {
    ipcMain.removeHandler(channel)
  }

  for (const channel of IPC_EVENT_CHANNELS) {
    ipcMain.removeAllListeners(channel)
  }
}

const normalizePauseThresholdMs = (value: number | undefined): number => {
  const candidate = Number(value)
  if (!Number.isFinite(candidate)) {
    return DEFAULT_PAUSE_THRESHOLD_MS
  }

  return Math.max(MIN_PAUSE_THRESHOLD_MS, Math.min(MAX_PAUSE_THRESHOLD_MS, Math.round(candidate)))
}

const getConfiguredPauseThresholdMs = (): number =>
  normalizePauseThresholdMs(settingsManager?.getSettings().pauseThreshold)

const isLlamaCppProvider = (
  provider: AppSettings['llmProvider'] | ProviderPayloadState['provider']
): boolean => provider === 'llama.cpp'

const isAnthropicProvider = (
  provider: AppSettings['llmProvider'] | ProviderPayloadState['provider']
): boolean => provider === 'anthropic-compatible'

const ANTHROPIC_BASE_URL = 'https://api.minimax.io/anthropic'

const ensureLocalLlmModelReady = async (
  model?: string,
  modelDir?: string,
  binaryDir?: string
): Promise<void> => {
  const normalizedModel = model?.trim()
  if (!normalizedModel) {
    throw new Error('Select a local llama.cpp model before continuing.')
  }

  await llamaCppLlmServer.ensureRunning(normalizedModel, modelDir, binaryDir)
}

const warmupConfiguredLocalLlm = async (): Promise<void> => {
  if (!settingsManager) {
    return
  }

  const settings = settingsManager.getSettings()
  if (settings.llmProvider !== 'llama.cpp' || !settings.llmModel?.trim()) {
    return
  }

  try {
    await ensureLocalLlmModelReady(settings.llmModel, settings.llmModelDir)
  } catch (error) {
    console.warn('[LlamaCpp] startup warmup failed:', error)
  }
}

const getPostUtteranceDebounceMs = (): number =>
  Math.max(
    MIN_POST_UTTERANCE_DEBOUNCE_MS,
    Math.min(MAX_POST_UTTERANCE_DEBOUNCE_MS, Math.round(getConfiguredPauseThresholdMs() / 4))
  )

const getProviderConfig = (settings: AppSettings): ProviderConfig => {
  if (settings.llmProvider === 'llama.cpp') {
    return {
      apiKey: 'no-key',
      baseURL: DEFAULT_LLM_BASE_URL,
      customHeaders: undefined
    }
  }

  if (settings.llmProvider === 'anthropic-compatible') {
    return {
      apiKey: resolveLlmCredential(settings),
      baseURL: settings.llmBaseUrl?.trim() || ANTHROPIC_BASE_URL,
      customHeaders: undefined
    }
  }

  const isOpenAICompatible =
    settings.llmProvider === 'openai-compatible' || settings.llmProvider === 'openai-oauth'

  return {
    apiKey: resolveLlmCredential(settings),
    baseURL:
      settings.llmProvider === 'openai-oauth'
        ? CHATGPT_CODEX_BASE_URL
        : isOpenAICompatible
          ? settings.llmBaseUrl
          : undefined,
    customHeaders:
      settings.llmProvider === 'openai-oauth'
        ? settings.llmOauthAccountId
          ? `ChatGPT-Account-Id: ${settings.llmOauthAccountId}`
          : undefined
        : isOpenAICompatible
          ? settings.llmCustomHeaders
          : undefined
  }
}

const shouldUseResponsesApi = (settings: AppSettings): boolean => {
  if (settings.llmProvider === 'openai-oauth') {
    return true
  }

  const model = settings.llmModel?.toLowerCase() || ''
  if (model.includes('codex')) {
    return true
  }

  return settings.llmProvider === 'openai' && !usesOAuthCredential(settings)
}

const isOpenAIOAuthExpired = (settings: AppSettings): boolean =>
  (settings.llmProvider === 'openai-oauth' || settings.llmAuthMode === 'oauth-token') &&
  Boolean(settings.llmOauthExpiresAt) &&
  settings.llmOauthExpiresAt <= Date.now() + 60_000

const ensureOpenAIOAuthToken = async (): Promise<string | null> => {
  if (!settingsManager) return null

  const settings = settingsManager.getSettings()
  if (settings.llmProvider !== 'openai-oauth') {
    return settings.llmApiKey || null
  }

  if (!settings.llmOauthToken?.trim()) {
    return null
  }

  if (!isOpenAIOAuthExpired(settings)) {
    return settings.llmOauthToken
  }

  if (!settings.llmOauthRefreshToken?.trim()) {
    return settings.llmOauthToken
  }

  const refreshed = await refreshOpenAIOAuthTokens(
    settings.llmOauthRefreshToken,
    settings.llmOauthAccountId
  )
  settingsManager.updateSettings({
    llmOauthToken: refreshed.accessToken,
    llmOauthRefreshToken: refreshed.refreshToken,
    llmOauthExpiresAt: refreshed.expiresAt,
    llmOauthAccountId: refreshed.accountId
  })

  return refreshed.accessToken
}

const getTranscriptionConfig = (settings: AppSettings): TranscriptionConfig => {
  if (settings.transcriptionProvider === 'assemblyai') {
    return {
      provider: 'assemblyai' as const,
      apiKey: settings.transcriptionApiKey
    }
  }

  return {
    provider: 'openai' as const,
    apiKey: settings.llmApiKey
  }
}

const validateProviderSettings = (settings: AppSettings): string | null => {
  if (settings.llmProvider === 'llama.cpp') {
    return settings.llmModel?.trim()
      ? null
      : 'Select a local llama.cpp model in Settings before using the LLM provider.'
  }

  if (settings.llmProvider === 'anthropic-compatible') {
    return settings.llmModel?.trim()
      ? null
      : 'Select a MiniMax model (e.g. MiniMax-M2.7) in Settings before using Anthropic.'
  }

  const hasCredential = Boolean(resolveLlmCredential(settings))

  if (!hasCredential) {
    return settings.llmProvider === 'openai-oauth'
      ? 'OpenAI OAuth token not configured. Please sign in in Settings.'
      : usesOAuthCredential(settings)
        ? 'OpenAI OAuth token not configured. Please add it in Settings.'
        : 'LLM API key not configured. Please add it in Settings.'
  }

  if (settings.llmProvider === 'openai-oauth' && !settings.llmOauthAccountId?.trim()) {
    return 'OpenAI OAuth account metadata is missing. Please disconnect and sign in again.'
  }

  if (settings.llmProvider === 'openai-compatible' && !settings.llmBaseUrl?.trim()) {
    return 'OpenAI-compatible provider requires Base URL in Settings.'
  }

  return null
}

const validateTranscriptionSettings = (settings: AppSettings): string | null => {
  if (settings.transcriptionProvider === 'assemblyai' && !settings.transcriptionApiKey?.trim()) {
    return 'AssemblyAI API key not configured. Please add it in Settings.'
  }

  if (
    settings.transcriptionProvider === 'assemblyai' &&
    settings.assemblyAiSpeechModel === 'u3-rt-pro' &&
    settings.assemblyAiPrompt?.trim() &&
    settings.assemblyAiKeytermsPrompt?.trim()
  ) {
    return 'AssemblyAI Universal 3 Pro does not support using prompt and keyterms together.'
  }

  if (settings.transcriptionProvider === 'openai' && !settings.llmApiKey?.trim()) {
    return 'OpenAI API key not configured for transcription. Please add it in Settings.'
  }

  return null
}

const buildInterviewContext = (profile: AvatarProfile): string => {
  const sections = [
    { label: 'Target Role', value: profile.jobTitle.trim() },
    { label: 'Company', value: profile.companyName.trim() },
    { label: 'Job Description', value: profile.jobDescription.trim() },
    { label: 'Company Details', value: profile.companyContext.trim() }
  ].filter((section) => section.value)

  return sections.map((section) => `${section.label}:\n${section.value}`).join('\n\n')
}

const buildIdentityBase = (profile: AvatarProfile): string => profile.identityBase.trim()
const buildAnswerStyle = (profile: AvatarProfile): string => profile.answerStyle.trim()

type ClassifierQuestionType = 'direct' | 'indirect' | 'scenario' | 'none'

interface ModelQuestionClassification {
  shouldAnswer: boolean
  confidence: number
  questionType: ClassifierQuestionType
}

interface ModelClassifierResult {
  supported: boolean
  detection: {
    text: string
    confidence: number
    questionType: 'direct' | 'indirect' | 'scenario'
  } | null
}

const MODEL_CLASSIFIER_THRESHOLD = 0.62
const MODEL_CLASSIFIER_MIN_CHARS = 80
const MODEL_CLASSIFIER_MIN_INTERVAL_MS = 1000

const notifyQuestionNotDetected = (text: string): void => {
  const normalized = text.trim()
  if (!normalized) return
  if (isGeneratingAnswer || pendingQuestionTimer) return
  if (lastAnswerCompletedAt && Date.now() - lastAnswerCompletedAt < SUPPRESS_STALE_NO_QUESTION_MS) {
    return
  }
  mainWindow?.webContents.send('question-not-detected-by-model', { text: normalized })
}

const clearPendingQuestionState = (): void => {
  if (pendingQuestionTimer) {
    clearTimeout(pendingQuestionTimer)
    pendingQuestionTimer = null
  }
  pendingQuestionBase = null
  pendingQuestionFragments = []
}

const invalidatePipeline = (): void => {
  pipelineEpoch += 1
  activeAnswerRequestId = null
  activeAnswerEpoch = null
}

const reserveAnswerRequest = (epoch = pipelineEpoch): number => {
  const requestId = nextAnswerRequestId++
  activeAnswerRequestId = requestId
  activeAnswerEpoch = epoch
  return requestId
}

const isCurrentAnswerRequest = (requestId: number): boolean =>
  activeAnswerRequestId === requestId && activeAnswerEpoch === pipelineEpoch

const releaseAnswerRequest = (requestId: number): boolean => {
  const isCurrent = isCurrentAnswerRequest(requestId)

  if (activeAnswerRequestId === requestId) {
    activeAnswerRequestId = null
    activeAnswerEpoch = null
    isGeneratingAnswer = false
  }

  return isCurrent
}

const resetRuntimePipelineState = (): void => {
  invalidatePipeline()
  clearPendingQuestionState()

  if (utteranceDebounceTimer) {
    clearTimeout(utteranceDebounceTimer)
    utteranceDebounceTimer = null
  }

  questionDetector?.clearBuffer()
  resetAnswerTimingTrace()
  isGeneratingAnswer = false
  isClassifyingQuestion = false
  lastAnswerCompletedAt = 0
  lastTranscriptActivityAt = 0
}

const buildPendingQuestionText = (): string => {
  const parts = [pendingQuestionBase || '', ...pendingQuestionFragments]
  const normalized: string[] = []

  for (const part of parts) {
    const trimmed = part.trim()
    if (!trimmed) continue

    const lower = trimmed.toLowerCase()
    const alreadyIncluded = normalized.some((existing) => existing.toLowerCase() === lower)
    if (!alreadyIncluded) {
      normalized.push(trimmed)
    }
  }

  return normalized.join(' ')
}

const restartPendingQuestionTimer = (
  epoch: number,
  delayMs = QUESTION_FOLLOW_UP_WINDOW_MS
): void => {
  if (pendingQuestionTimer) {
    clearTimeout(pendingQuestionTimer)
  }

  pendingQuestionTimer = setTimeout(() => {
    if (epoch !== pipelineEpoch) {
      clearPendingQuestionState()
      return
    }

    pendingQuestionTimer = null
    const fullQuestion = buildPendingQuestionText()
    clearPendingQuestionState()

    if (!fullQuestion) {
      return
    }

    void generateAnswerForQuestion(fullQuestion, epoch).catch((error) => {
      console.error('[Pipeline] queued detector answer failed:', error)
      mainWindow?.webContents.send('answer-error', (error as Error).message)
    })
  }, delayMs)
}

const getPendingFinalizeDelay = (): number =>
  pendingQuestionFragments.length > 0
    ? QUESTION_FINALIZE_AFTER_COMPOUND_UTTERANCE_MS
    : QUESTION_FINALIZE_AFTER_UTTERANCE_MS

const getModelClassifierPrompt = (): string => `
Classify whether the interviewer turn requires the candidate to answer now.
Return strict JSON only, no markdown:
{"shouldAnswer":boolean,"confidence":number,"questionType":"direct|indirect|scenario|none"}

Rules:
- shouldAnswer=true only when this is a genuine interview prompt/question for the candidate.
- shouldAnswer=false for greetings, confirmations, transitions, filler, and commentary.
- confidence is 0..1.
- questionType:
  - direct: explicit concrete question
  - indirect: conversational prompt requesting candidate context
  - scenario: hypothetical/case-based prompt
  - none: not a real candidate question
`

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value))

const shouldRunModelClassifier = (turnText: string): boolean => {
  if (turnText.trim().length < MODEL_CLASSIFIER_MIN_CHARS) {
    return false
  }

  const now = Date.now()
  if (now - lastModelQuestionClassificationAt < MODEL_CLASSIFIER_MIN_INTERVAL_MS) {
    return false
  }

  return true
}

const extractClassifierJson = (raw: string): ModelQuestionClassification | null => {
  const candidate = raw.trim()
  if (!candidate) return null

  const match = candidate.match(/\{[\s\S]*\}/)
  const jsonText = match ? match[0] : candidate

  let parsed: unknown = null
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    return null
  }

  if (!parsed || typeof parsed !== 'object') return null

  const shouldAnswer = Reflect.get(parsed, 'shouldAnswer')
  const confidence = Reflect.get(parsed, 'confidence')
  const questionType = Reflect.get(parsed, 'questionType')

  if (typeof shouldAnswer !== 'boolean') return null
  if (typeof confidence !== 'number' || Number.isNaN(confidence)) return null
  if (
    questionType !== 'direct' &&
    questionType !== 'indirect' &&
    questionType !== 'scenario' &&
    questionType !== 'none'
  ) {
    return null
  }

  return {
    shouldAnswer,
    confidence: clamp01(confidence),
    questionType
  }
}

const classifyTurnWithModel = async (turnText: string): Promise<ModelClassifierResult> => {
  const settings = settingsManager?.getSettings()
  if (!settings) {
    return { supported: false, detection: null }
  }

  const providerConfig = getProviderConfig(settings)
  if (settings.llmProvider === 'llama.cpp') {
    await ensureLocalLlmModelReady(settings.llmModel, settings.llmModelDir)
  }
  if (settings.llmProvider === 'openai-oauth') {
    providerConfig.apiKey = (await ensureOpenAIOAuthToken()) || ''
  }

  if (!providerConfig.apiKey?.trim()) {
    return { supported: false, detection: null }
  }

  const model = settings.llmModel || 'gpt-4o-mini'
  const classifierPrompt = getModelClassifierPrompt()
  const classifierInput = `Interviewer turn:\n${turnText}`

  try {
    let rawOutput = ''

    if (settings.llmProvider === 'openai-oauth') {
      const stream = streamChatGPTCodexResponse({
        accessToken: providerConfig.apiKey,
        accountId: settings.llmOauthAccountId || '',
        baseURL: providerConfig.baseURL,
        body: {
          model,
          instructions: classifierPrompt,
          input: [
            {
              role: 'user',
              content: [{ type: 'input_text', text: classifierInput }]
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
          rawOutput += event.delta
        }
      }
    } else if (settings.llmProvider === 'anthropic-compatible') {
      const response = await fetch(`${providerConfig.baseURL}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': providerConfig.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model,
          max_tokens: 800,
          temperature: 1,
          system: classifierPrompt,
          messages: [
            {
              role: 'user',
              content: [{ type: 'text', text: classifierInput }]
            }
          ]
        })
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Anthropic API error: ${response.status} ${errorText}`)
      }

      const data = await response.json()
      if (PIPELINE_VERBOSE) {
        console.log('[QuestionClassifier] Anthropic response:', JSON.stringify(data))
      }
      if (data.content && Array.isArray(data.content)) {
        const textBlock = data.content.find((block: { type: string }) => block.type === 'text')
        if (textBlock && textBlock.text) {
          rawOutput = textBlock.text
        } else {
          const thinkingBlock = data.content.find((block: { type: string }) => block.type === 'thinking')
          if (thinkingBlock && thinkingBlock.text) {
            const jsonMatch = thinkingBlock.text.match(/\{[\s\S]*?"shouldAnswer"[\s\S]*?\}/)
            if (jsonMatch) {
              rawOutput = jsonMatch[0]
            }
          }
        }
        if (PIPELINE_VERBOSE) {
          console.log('[QuestionClassifier] Anthropic raw output:', rawOutput)
        }
      }
    } else {
      const client = createOpenAIClient({
        apiKey: providerConfig.apiKey,
        baseURL: providerConfig.baseURL,
        customHeaders: providerConfig.customHeaders
      })

      const request: Record<string, unknown> = {
        model,
        stream: false,
        temperature: 0,
        messages: [
          { role: 'system', content: classifierPrompt },
          { role: 'user', content: classifierInput }
        ],
        max_completion_tokens: 120
      }

      const completion = await client.chat.completions.create(request as never)
      rawOutput = completion.choices[0]?.message?.content || ''
    }

    const parsed = extractClassifierJson(rawOutput)
    if (!parsed) {
      if (PIPELINE_VERBOSE) {
        console.warn('[QuestionClassifier] invalid model JSON output')
      }
      return { supported: false, detection: null }
    }

    if (!parsed.shouldAnswer || parsed.questionType === 'none') {
      if (PIPELINE_VERBOSE) {
        console.log('[QuestionClassifier] model classified as non-question:', {
          confidence: parsed.confidence
        })
      }
      return { supported: true, detection: null }
    }

    if (parsed.confidence < MODEL_CLASSIFIER_THRESHOLD) {
      if (PIPELINE_VERBOSE) {
        console.log('[QuestionClassifier] model confidence below threshold:', {
          confidence: parsed.confidence
        })
      }
      return { supported: true, detection: null }
    }

    return {
      supported: true,
      detection: {
        text: turnText,
        confidence: parsed.confidence,
        questionType: parsed.questionType
      }
    }
  } catch (error) {
    if (PIPELINE_VERBOSE) {
      console.warn(
        '[QuestionClassifier] model classifier unavailable, using heuristic fallback:',
        error
      )
    }
    return { supported: false, detection: null }
  }
}

const generateAnswerForQuestion = async (
  questionText: string,
  epoch = pipelineEpoch
): Promise<void> => {
  const settings = settingsManager?.getSettings()
  const isAnthropic = settings?.llmProvider === 'anthropic-compatible'

  if (!isAnthropic && !openaiService) {
    throw new Error('Answer generation is not available')
  }

  if (isAnthropic && !anthropicService) {
    throw new Error('Answer generation is not available')
  }

  if (epoch !== pipelineEpoch) {
    return
  }

  if (isGeneratingAnswer) {
    throw new Error('An answer is already being generated')
  }

  const trimmedQuestion = questionText.trim()
  if (!trimmedQuestion) {
    throw new Error('No question text provided')
  }

  answerTimingTrace.answerRequestedAt = Date.now()
  isGeneratingAnswer = true
  mainWindow?.webContents.send('generation-start')
  const requestId = reserveAnswerRequest(epoch)
  mainWindow?.webContents.send('question-detected', {
    text: trimmedQuestion,
    confidence: 1,
    questionType: 'direct'
  })

  try {
    const profile = avatarProfileManager?.getProfile()
    if (epoch !== pipelineEpoch || !isCurrentAnswerRequest(requestId)) {
      releaseAnswerRequest(requestId)
      return
    }
    answerTimingTrace.ragReadyAt = Date.now()

    if (isAnthropic && anthropicService) {
      await anthropicService.generateAnswer(
        trimmedQuestion,
        {
          identityBase: profile ? buildIdentityBase(profile) : '',
          answerStyle: profile ? buildAnswerStyle(profile) : '',
          interviewContext: profile ? buildInterviewContext(profile) : '',
          avatarContext: profile?.candidateKnowledge || ''
        },
        requestId
      )
    } else if (openaiService) {
      await openaiService.generateAnswer(
        trimmedQuestion,
        {
          identityBase: profile ? buildIdentityBase(profile) : '',
          answerStyle: profile ? buildAnswerStyle(profile) : '',
          interviewContext: profile ? buildInterviewContext(profile) : '',
          avatarContext: profile?.candidateKnowledge || ''
        },
        requestId
      )
    }
  } catch (error) {
    releaseAnswerRequest(requestId)
    throw error
  }
}

const attachOpenAIServiceListeners = (service: OpenAIService): void => {
  service.removeAllListeners('stream')
  service.removeAllListeners('complete')
  service.removeAllListeners('truncated')
  service.removeAllListeners('error')

  service.on('stream', (event: OpenAIStreamEvent) => {
    if (!isCurrentAnswerRequest(event.requestId)) {
      return
    }

    if (!answerTimingTrace.firstStreamAt) {
      answerTimingTrace.firstStreamAt = Date.now()
    }

    mainWindow?.webContents.send('answer-stream', event.chunk)
  })

  service.on('complete', (event: OpenAICompleteEvent) => {
    const isCurrent = releaseAnswerRequest(event.requestId)
    if (!isCurrent) {
      return
    }

    lastAnswerCompletedAt = Date.now()
    logAnswerTimingSummary('complete')
    resetAnswerTimingTrace()
    mainWindow?.webContents.send('answer-complete', event.answer)
    mainWindow?.webContents.send('generation-end')
  })

  service.on('truncated', (event: OpenAITruncatedEvent) => {
    if (!isCurrentAnswerRequest(event.requestId)) {
      return
    }

    if (PIPELINE_VERBOSE) {
      console.warn('[Pipeline] answer truncated by max token limit')
    }
    mainWindow?.webContents.send('answer-truncated')
    mainWindow?.webContents.send('generation-end')
  })

  service.on('error', (event: OpenAIErrorEvent) => {
    const isCurrent = releaseAnswerRequest(event.requestId)
    if (!isCurrent) {
      return
    }

    logAnswerTimingSummary('error')
    resetAnswerTimingTrace()
    console.error('[Pipeline] answer-error event:', event.error)
    mainWindow?.webContents.send('answer-error', String(event.error))
    mainWindow?.webContents.send('generation-end')
  })
}

interface AnthropicStreamEvent {
  requestId: number
  chunk: string
}

interface AnthropicCompleteEvent {
  requestId: number
  answer: string
}

interface AnthropicErrorEvent {
  requestId: number
  error: unknown
}

const attachAnthropicServiceListeners = (service: AnthropicService): void => {
  service.removeAllListeners('stream')
  service.removeAllListeners('complete')
  service.removeAllListeners('error')

  service.on('stream', (event: AnthropicStreamEvent) => {
    if (!isCurrentAnswerRequest(event.requestId)) {
      return
    }

    if (!answerTimingTrace.firstStreamAt) {
      answerTimingTrace.firstStreamAt = Date.now()
    }

    mainWindow?.webContents.send('answer-stream', event.chunk)
  })

  service.on('complete', (event: AnthropicCompleteEvent) => {
    const isCurrent = releaseAnswerRequest(event.requestId)
    if (!isCurrent) {
      return
    }

    lastAnswerCompletedAt = Date.now()
    logAnswerTimingSummary('complete')
    resetAnswerTimingTrace()
    mainWindow?.webContents.send('answer-complete', event.answer)
    mainWindow?.webContents.send('generation-end')
  })

  service.on('error', (event: AnthropicErrorEvent) => {
    const isCurrent = releaseAnswerRequest(event.requestId)
    if (!isCurrent) {
      return
    }

    logAnswerTimingSummary('error')
    resetAnswerTimingTrace()
    mainWindow?.webContents.send('answer-error', String(event.error))
    mainWindow?.webContents.send('generation-end')
  })
}

const scheduleAnswerForDetectedQuestion = (questionText: string, epoch = pipelineEpoch): void => {
  if (epoch !== pipelineEpoch) {
    return
  }

  const trimmedQuestion = questionText.trim()
  if (trimmedQuestion && !pendingQuestionBase) {
    pendingQuestionBase = trimmedQuestion
  } else if (
    trimmedQuestion &&
    pendingQuestionBase &&
    pendingQuestionBase.toLowerCase() !== trimmedQuestion.toLowerCase()
  ) {
    pendingQuestionFragments.push(trimmedQuestion)
  }

  restartPendingQuestionTimer(epoch)
}

export function initializeIpcHandlers(window: BrowserWindow, waylandFlag = false): void {
  unregisterIpcHandlers()
  questionDetector?.removeAllListeners()
  resetRuntimePipelineState()
  mainWindow = window
  isWaylandSession = waylandFlag
  settingsManager = new SettingsManager()
  historyManager = new HistoryManager()
  questionDetector = new QuestionDetector()
  avatarProfileManager = new AvatarProfileManager()
  settingsManager.flushPendingMigrations()
  warmupConfiguredLocalLlm().catch((err) => console.warn('[LlamaCpp] warmup failed:', err))

  ipcMain.handle('get-settings', () => {
    return settingsManager?.getSettings()
  })

  ipcMain.handle('update-settings', (_event, updates: Partial<AppSettings>) => {
    const llmModelDirChanged = updates.llmModelDir !== undefined
    settingsManager?.updateSettings(updates)

    if (llmModelDirChanged) {
      void llamaCppLlmServer.dispose()
    }

    if (updates.alwaysOnTop !== undefined && mainWindow && !isWaylandSession) {
      mainWindow.setAlwaysOnTop(updates.alwaysOnTop)
    }
    if (updates.windowOpacity !== undefined && mainWindow && !isWaylandSession) {
      mainWindow.setOpacity(updates.windowOpacity)
    }

    return settingsManager?.getSettings()
  })

  ipcMain.handle('get-avatar-profile', () => {
    return avatarProfileManager?.getProfile()
  })

  ipcMain.handle('update-avatar-profile', async (_event, updates: Partial<AvatarProfile>) => {
    if (!avatarProfileManager) {
      throw new Error('Avatar profile manager not initialized')
    }

    const profile = avatarProfileManager.updateProfile(updates)
    return profile
  })

  ipcMain.handle('generate-answer-manually', async (_event, questionText: string) => {
    await generateAnswerForQuestion(questionText)
    return { success: true }
  })

  ipcMain.handle('get-window-capabilities', () => {
    return {
      platform: process.platform,
      isWayland: isWaylandSession,
      supportsAlwaysOnTop: !isWaylandSession,
      supportsWindowOpacity: !isWaylandSession,
      warning: isWaylandSession ? 'Unavailable on GNOME Wayland.' : ''
    }
  })

  ipcMain.handle('connect-openai-oauth', async () => {
    try {
      const tokens = await startOpenAIOAuthFlow()
      settingsManager?.updateSettings({
        llmProvider: 'openai-oauth',
        llmAuthMode: 'oauth-token',
        llmOauthToken: tokens.accessToken,
        llmOauthRefreshToken: tokens.refreshToken,
        llmOauthExpiresAt: tokens.expiresAt,
        llmOauthAccountId: tokens.accountId,
        llmModel: 'gpt-5.4'
      })
      return { success: true, settings: settingsManager?.getSettings() }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'OpenAI OAuth sign-in failed.'
      }
    }
  })

  ipcMain.handle('disconnect-openai-oauth', async () => {
    try {
      settingsManager?.updateSettings({
        llmOauthToken: '',
        llmOauthRefreshToken: '',
        llmOauthExpiresAt: 0,
        llmOauthAccountId: ''
      })
      return { success: true, settings: settingsManager?.getSettings() }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to clear OpenAI OAuth tokens.'
      }
    }
  })

  const getProviderPayloadState = (payload: {
    apiKey?: string
    oauthToken?: string
    provider?: 'openai' | 'openai-oauth' | 'openai-compatible' | 'llama.cpp' | 'anthropic-compatible'
    authMode?: 'api-key' | 'oauth-token'
  }): ProviderPayloadState => {
    const provider = payload?.provider || 'openai'
    const authMode = payload?.authMode || 'api-key'
    const oauthCredential = usesOAuthCredential({
      llmProvider: provider,
      llmAuthMode: authMode
    })

    return {
      provider,
      usesOAuthCredential: oauthCredential,
      credential: oauthCredential ? payload?.oauthToken?.trim() : payload?.apiKey?.trim()
    }
  }

  ipcMain.handle(
    'fetch-llm-models',
    async (
      _event,
      payload: {
        apiKey?: string
        oauthToken?: string
        provider?: 'openai' | 'openai-oauth' | 'openai-compatible' | 'llama.cpp' | 'anthropic-compatible'
        authMode?: 'api-key' | 'oauth-token'
        baseURL?: string
        customHeaders?: string
        llmModelDir?: string
      }
    ) => {
      const { provider, usesOAuthCredential, credential } = getProviderPayloadState(payload)

      if (usesOAuthCredential) {
        return {
          success: true,
          models: OPENAI_OAUTH_MODEL_OPTIONS.map((id) => ({ id, name: id }))
        }
      }

      if (isLlamaCppProvider(provider)) {
        const modelDirectory = ensureModelsDirectory(
          payload?.llmModelDir?.trim() ||
            settingsManager?.getSettings().llmModelDir ||
            getDefaultModelsDirectory()
        )
        return {
          success: true,
          models: listLlmModels(modelDirectory)
        }
      }

      if (isAnthropicProvider(provider)) {
        const baseURL = payload?.baseURL?.trim() || ANTHROPIC_BASE_URL
        const apiKey = credential || ''
        try {
          const client = createOpenAIClient({
            apiKey,
            baseURL,
            customHeaders: payload?.customHeaders
          })
          const response = await client.models.list()
          const models = response.data.map((model) => ({
            id: model.id,
            name: model.id
          }))
          return { success: true, models }
        } catch (error) {
          if (isNotFoundError(error)) {
            return { success: true, models: [] }
          }
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to fetch models',
            models: []
          }
        }
      }

      const baseURL = provider === 'openai-compatible' ? payload?.baseURL?.trim() : undefined

      if (!credential) {
        return {
          success: false,
          error: usesOAuthCredential ? 'OAuth token is required' : 'API key is required',
          models: []
        }
      }

      if (provider === 'openai-compatible' && !baseURL) {
        return {
          success: false,
          error: 'Base URL is required for OpenAI-compatible provider',
          models: []
        }
      }

      try {
        const client = createOpenAIClient({
          apiKey: credential,
          baseURL,
          customHeaders: payload?.customHeaders
        })

        let models: Array<{ id: string; name: string }> = []
        try {
          const response = await client.models.list()
          models = response.data.map((model) => ({
            id: model.id,
            name: model.id
          }))
        } catch (error) {
          // Some OpenAI-compatible endpoints don't expose /models.
          // In that case, do not block usage and allow manual model entry.
          if (!isNotFoundError(error)) {
            throw error
          }
        }

        return { success: true, models }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to fetch models'
        return { success: false, error: errorMessage, models: [] }
      }
    }
  )

  ipcMain.handle(
    'test-provider-connection',
    async (
      _event,
      payload: {
        apiKey?: string
        oauthToken?: string
        provider?: 'openai' | 'openai-oauth' | 'openai-compatible' | 'llama.cpp' | 'anthropic-compatible'
        authMode?: 'api-key' | 'oauth-token'
        baseURL?: string
        customHeaders?: string
        model?: string
        llmModelDir?: string
        testKind?: 'connect' | 'llm'
      }
    ) => {
      const {
        provider,
        usesOAuthCredential,
        credential: payloadCredential
      } = getProviderPayloadState(payload)
      const credential =
        provider === 'openai-oauth' && !payload?.oauthToken?.trim()
          ? await ensureOpenAIOAuthToken()
          : payloadCredential
      const storedSettings = settingsManager?.getSettings()
      const baseURL =
        provider === 'openai-oauth'
          ? CHATGPT_CODEX_BASE_URL
          : provider === 'openai-compatible'
            ? payload?.baseURL?.trim()
            : provider === 'llama.cpp'
              ? DEFAULT_LLM_BASE_URL
              : provider === 'anthropic-compatible'
                ? payload?.baseURL?.trim() || ANTHROPIC_BASE_URL
                : undefined
      const preferredModel = payload?.model?.trim()
      const testKind = payload?.testKind === 'llm' ? 'llm' : 'connect'

      if (!credential && !isLlamaCppProvider(provider) && !isAnthropicProvider(provider)) {
        return {
          success: false,
          message: usesOAuthCredential ? 'OAuth token is required' : 'API key is required'
        }
      }

      if (provider === 'openai-oauth' && !storedSettings?.llmOauthAccountId?.trim()) {
        return {
          success: false,
          message: 'OAuth account metadata is missing. Disconnect and sign in again.'
        }
      }

      if (provider === 'openai-compatible' && !baseURL) {
        return {
          success: false,
          message: 'Base URL is required for OpenAI-compatible provider'
        }
      }

      if (provider === 'llama.cpp' && !preferredModel) {
        return {
          success: false,
          message: 'Select a local llama.cpp model before testing the connection.'
        }
      }

      if (provider === 'anthropic-compatible' && !preferredModel) {
        return {
          success: false,
          message: 'Select a MiniMax model (e.g. MiniMax-M2.7) before testing the connection.'
        }
      }

      try {
        if (provider === 'llama.cpp') {
          const validation = await llamaCppLlmServer.validateModel(
            preferredModel || '',
            payload?.llmModelDir?.trim() ||
              storedSettings?.llmModelDir ||
              getDefaultModelsDirectory()
          )
          if (!validation.valid) {
            return {
              success: false,
              message: validation.error || 'Model validation failed'
            }
          }
        }

        if (provider === 'anthropic-compatible') {
          const apiKey = credential || ''
          const response = await fetch(`${baseURL}/v1/messages`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01',
              'anthropic-dangerous-direct-browser-access': 'true'
            },
            body: JSON.stringify({
              model: preferredModel || 'MiniMax-M2.7',
              max_tokens: 10,
              temperature: 1,
              messages: [
                {
                  role: 'user',
                  content: [{ type: 'text', text: 'Reply with exactly: pong' }]
                }
              ]
            })
          })

          if (!response.ok) {
            const errorText = await response.text()
            throw new Error(`Anthropic API error: ${response.status} ${errorText}`)
          }

          return {
            success: true,
            message: testKind === 'llm' ? 'LLM test passed.' : 'LLM connection established.',
            modelCount: 0,
            hasPreferredModel: true
          }
        }

        const client = createOpenAIClient({
          apiKey: credential || 'no-key',
          baseURL,
          customHeaders:
            provider === 'openai-oauth'
              ? storedSettings?.llmOauthAccountId
                ? `ChatGPT-Account-Id: ${storedSettings.llmOauthAccountId}`
                : undefined
              : payload?.customHeaders
        })

        if (provider === 'openai-oauth') {
          if (!credential || !storedSettings?.llmOauthAccountId?.trim()) {
            return {
              success: false,
              message: 'OAuth not connected. Please sign in again.',
              modelCount: 0,
              hasPreferredModel: false
            }
          }

          const now = Date.now()
          const expiresAt = storedSettings.llmOauthExpiresAt || 0
          if (expiresAt > 0 && expiresAt < now) {
            return {
              success: false,
              message: 'OAuth token expired. Please sign in again.',
              modelCount: 0,
              hasPreferredModel: false
            }
          }

          if (testKind === 'llm') {
            const oauthModel = preferredModel || 'gpt-5.4'
            const stream = streamChatGPTCodexResponse({
              accessToken: credential,
              accountId: storedSettings.llmOauthAccountId,
              baseURL,
              body: {
                model: oauthModel,
                instructions: 'Reply with exactly: pong',
                input: [
                  {
                    role: 'user',
                    content: [{ type: 'input_text', text: 'ping' }]
                  }
                ],
                tools: [],
                tool_choice: 'auto',
                parallel_tool_calls: false,
                store: false,
                include: []
              }
            })

            let sawOutput = false
            for await (const event of stream) {
              if (
                event.type === 'response.output_text.delta' ||
                event.type === 'response.completed'
              ) {
                sawOutput = true
                break
              }
            }

            if (!sawOutput) {
              throw new Error('OAuth LLM test did not produce output.')
            }

            return {
              success: true,
              message: 'LLM test passed.',
              modelCount: 0,
              hasPreferredModel: true
            }
          }

          return {
            success: true,
            message: 'OAuth token valid.',
            modelCount: 0,
            hasPreferredModel: true
          }
        }

        if (provider === 'openai' && usesOAuthCredential) {
          await client.chat.completions.create({
            model: preferredModel || OPENAI_OAUTH_MODEL_OPTIONS[0],
            messages: [{ role: 'user', content: 'ping' }],
            max_completion_tokens: 1,
            temperature: 0
          } as never)

          return {
            success: true,
            message: testKind === 'llm' ? 'LLM test passed.' : 'LLM connection established.',
            modelCount: 0,
            hasPreferredModel: true
          }
        }

        if (testKind === 'llm') {
          if (!preferredModel) {
            return {
              success: false,
              message: 'Select or enter a model before testing the LLM.',
              modelCount: 0,
              hasPreferredModel: false
            }
          }

          await client.chat.completions.create({
            model: preferredModel,
            messages: [{ role: 'user', content: 'ping' }],
            max_completion_tokens: 1,
            temperature: 0
          } as never)

          return {
            success: true,
            message: 'LLM test passed.',
            modelCount: 0,
            hasPreferredModel: true
          }
        }

        let models: string[] = []
        try {
          const response = await client.models.list()
          models = response.data.map((model) => model.id)
        } catch (error) {
          if (!isNotFoundError(error)) {
            if (!preferredModel) {
              throw error
            }

            const probeRequest: Record<string, unknown> = {
              model: preferredModel,
              messages: [{ role: 'user', content: 'ping' }],
              max_completion_tokens: 1,
              temperature: 0
            }

            await client.chat.completions.create(probeRequest as never)

            return {
              success: true,
              message: 'LLM connection established. Model listing unavailable.',
              modelCount: 0,
              models: [],
              hasPreferredModel: true
            }
          }

          // Fallback probe for endpoints that don't support GET /models
          const probeRequest: Record<string, unknown> = {
            model: preferredModel || 'qwen3.5-plus',
            messages: [{ role: 'user', content: 'ping' }],
            max_completion_tokens: 1,
            temperature: 0
          }

          await client.chat.completions.create(probeRequest as never)
        }

        const hasPreferredModel = preferredModel
          ? models.length > 0
            ? models.includes(preferredModel)
            : true
          : true
        const message = hasPreferredModel
          ? 'LLM connection established.'
          : `LLM connection established, but model "${preferredModel}" was not found.`

        return {
          success: true,
          message,
          modelCount: models.length,
          models,
          hasPreferredModel
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Connection failed'
        return { success: false, message: errorMessage, modelCount: 0, hasPreferredModel: false }
      }
    }
  )

  ipcMain.handle(
    'test-transcription-connection',
    async (
      _event,
      payload: {
        provider?: 'openai' | 'assemblyai'
        apiKey?: string
        language?: 'auto' | 'en' | 'pt'
        assemblyAiSpeechModel?: 'u3-rt-pro' | 'universal-streaming-multilingual' | 'universal-streaming-english'
        assemblyAiLanguageDetection?: boolean
        assemblyAiMinTurnSilence?: number
        assemblyAiMaxTurnSilence?: number
        assemblyAiKeytermsPrompt?: string
        assemblyAiPrompt?: string
      }
    ) => {
      const provider = payload?.provider || 'assemblyai'
      const apiKey = payload?.apiKey?.trim()
      const language = payload?.language === 'auto' ? undefined : payload?.language

      if (!apiKey) {
        return { success: false, message: 'Transcription API key is required.' }
      }

      if (provider === 'assemblyai') {
        if (
          payload?.assemblyAiSpeechModel === 'u3-rt-pro' &&
          payload?.assemblyAiPrompt?.trim() &&
          payload?.assemblyAiKeytermsPrompt?.trim()
        ) {
          return {
            success: false,
            message: 'AssemblyAI Universal 3 Pro does not support using prompt and keyterms together.'
          }
        }

        return testAssemblyAIConnection(apiKey, {
          language,
          speechModel: payload?.assemblyAiSpeechModel,
          languageDetection: payload?.assemblyAiLanguageDetection,
          minTurnSilence: payload?.assemblyAiMinTurnSilence,
          maxTurnSilence: payload?.assemblyAiMaxTurnSilence,
          keytermsPrompt: payload?.assemblyAiKeytermsPrompt,
          prompt: payload?.assemblyAiPrompt
        })
      }

      try {
        const client = createOpenAIClient({ apiKey })
        await client.models.list()
        return { success: true, message: 'OpenAI transcription credential looks valid.' }
      } catch (error) {
        return {
          success: false,
          message: error instanceof Error ? error.message : 'OpenAI transcription test failed'
        }
      }
    }
  )

  ipcMain.handle('start-capture', async () => {
    const settings = settingsManager?.getSettings()

    if (!settings) {
      throw new Error('Settings not available')
    }

    const transcriptionValidationError = validateTranscriptionSettings(settings)
    if (transcriptionValidationError) {
      throw new Error(transcriptionValidationError)
    }

    const validationError = validateProviderSettings(settings)
    if (validationError) {
      throw new Error(validationError)
    }

    try {
      resetRuntimePipelineState()
      if (whisperService) {
        whisperService.removeAllListeners()
        whisperService = null
      }
      if (openaiService) {
        openaiService.removeAllListeners()
        openaiService = null
      }
      if (anthropicService) {
        anthropicService.removeAllListeners()
        anthropicService = null
      }
      questionDetector?.removeAllListeners()

      const providerConfig = getProviderConfig(settings)
      if (settings.llmProvider === 'llama.cpp') {
        await ensureLocalLlmModelReady(settings.llmModel, settings.llmModelDir)
      }
      if (settings.llmProvider === 'openai-oauth') {
        providerConfig.apiKey = (await ensureOpenAIOAuthToken()) || ''
      }
      const transcriptionConfig = getTranscriptionConfig(settings)

      whisperService = new WhisperService({
        provider: transcriptionConfig.provider,
        apiKey: transcriptionConfig.apiKey,
        model: 'whisper-1',
        language:
          settings.transcriptionLanguage === 'auto' ? undefined : settings.transcriptionLanguage,
        assemblyAiSpeechModel: settings.assemblyAiSpeechModel,
        assemblyAiLanguageDetection: settings.assemblyAiLanguageDetection,
        assemblyAiMinTurnSilence: settings.assemblyAiMinTurnSilence,
        assemblyAiMaxTurnSilence: settings.assemblyAiMaxTurnSilence,
        assemblyAiKeytermsPrompt: settings.assemblyAiKeytermsPrompt,
        assemblyAiPrompt: settings.assemblyAiPrompt,
        silenceThresholdMs: settings.pauseThreshold
      })

      if (settings.llmProvider === 'anthropic-compatible') {
        anthropicService = new AnthropicService({
          apiKey: providerConfig.apiKey,
          baseURL: providerConfig.baseURL,
          model: settings.llmModel,
          temperature: 1
        })
        attachAnthropicServiceListeners(anthropicService)
      } else {
        openaiService = new OpenAIService({
          apiKey: providerConfig.apiKey,
          baseURL: providerConfig.baseURL,
          customHeaders: providerConfig.customHeaders,
          chatgptAccountId: settings.llmOauthAccountId,
          useResponsesApi: shouldUseResponsesApi(settings),
          model: settings.llmModel
        })
        attachOpenAIServiceListeners(openaiService)
      }

      whisperService.on('transcript', async (event) => {
        if (!isCapturing) {
          return
        }
        lastTranscriptActivityAt = Date.now()
        mainWindow?.webContents.send('transcript', event)

        if (utteranceDebounceTimer) {
          clearTimeout(utteranceDebounceTimer)
          utteranceDebounceTimer = null
        }

        if (pendingQuestionTimer) {
          if (event.isFinal && event.text.trim()) {
            pendingQuestionFragments.push(event.text.trim())
          }
          restartPendingQuestionTimer(pipelineEpoch)
          return
        }

        questionDetector?.addTranscript(event.text, event.isFinal)
      })

      whisperService.on('utteranceEnd', () => {
        if (!isCapturing) {
          return
        }
        answerTimingTrace.utteranceEndAt = Date.now()
        if (pendingQuestionTimer) {
          restartPendingQuestionTimer(pipelineEpoch, getPendingFinalizeDelay())
          mainWindow?.webContents.send('utterance-end')
          return
        }
        if (utteranceDebounceTimer) {
          clearTimeout(utteranceDebounceTimer)
        }
        const epochAtUtteranceEnd = pipelineEpoch
        utteranceDebounceTimer = setTimeout(() => {
          utteranceDebounceTimer = null
          if (epochAtUtteranceEnd !== pipelineEpoch) {
            return
          }
          if (!questionDetector) return

          void (async () => {
            answerTimingTrace.debounceElapsedAt = Date.now()
            if (isClassifyingQuestion) {
              return
            }

            isClassifyingQuestion = true
            const classifierStartedAt = Date.now()
            try {
              const turnText = questionDetector.getCurrentBuffer()
              if (!turnText) {
                questionDetector.clearBuffer()
                return
              }

              if (
                lastTranscriptActivityAt > classifierStartedAt ||
                epochAtUtteranceEnd !== pipelineEpoch
              ) {
                return
              }

              if (!shouldRunModelClassifier(turnText)) {
                const detected = questionDetector.onUtteranceEnd()
                if (!detected) {
                  notifyQuestionNotDetected(turnText)
                }
                return
              }

              const classifierResult = await classifyTurnWithModel(turnText)
              if (
                lastTranscriptActivityAt > classifierStartedAt ||
                epochAtUtteranceEnd !== pipelineEpoch
              ) {
                return
              }
              lastModelQuestionClassificationAt = Date.now()
              if (classifierResult.supported) {
                answerTimingTrace.classifierTriggeredAt = Date.now()
                questionDetector.clearBuffer()
                if (classifierResult.detection) {
                  questionDetector.emit('questionDetected', classifierResult.detection)
                } else {
                  notifyQuestionNotDetected(turnText)
                }
                return
              }

              const detected = questionDetector.onUtteranceEnd()
              if (!detected) {
                notifyQuestionNotDetected(turnText)
              }
            } finally {
              isClassifyingQuestion = false
            }
          })()
        }, getPostUtteranceDebounceMs())
        mainWindow?.webContents.send('utterance-end')
      })

      whisperService.on('speechStarted', () => {
        if (!isCapturing) {
          return
        }
        mainWindow?.webContents.send('speech-started')
      })

      whisperService.on('error', (error) => {
        const errorMessage = error instanceof Error ? error.message : 'Unknown capture error'
        console.error('Whisper error:', errorMessage)
        mainWindow?.webContents.send('capture-error', errorMessage)
      })

      questionDetector?.on('questionDetected', async (detection) => {
        if (!isCapturing) {
          return
        }
        if (isGeneratingAnswer) {
          return
        }
        scheduleAnswerForDetectedQuestion(detection.text, pipelineEpoch)
      })

      isCapturing = true
      await whisperService.start()
      if (PIPELINE_VERBOSE) {
        console.log('Audio capture started successfully')
      }

      return { success: true }
    } catch (error) {
      console.error('start-capture error:', error)
      const errorMessage = error instanceof Error ? error.message : 'Failed to start capture'
      throw new Error(errorMessage)
    }
  })

  ipcMain.handle('stop-capture', async () => {
    isCapturing = false
    resetRuntimePipelineState()

    if (whisperService) {
      const service = whisperService
      whisperService = null
      service.removeAllListeners()
      await service.stop()
    }

    if (openaiService) {
      const service = openaiService
      openaiService = null
      service.removeAllListeners()
    }

    questionDetector?.removeAllListeners()
    questionDetector?.clearBuffer()
    if (PIPELINE_VERBOSE) {
      console.log('Audio capture stopped')
    }

    return { success: true }
  })

  ipcMain.on('audio-data', (_event, audioData: ArrayBuffer) => {
    if (whisperService && isCapturing) {
      whisperService.addAudioData(audioData)
    }
  })

  ipcMain.handle('get-audio-sources', async () => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        fetchWindowIcons: true
      })

      return {
        sources: sources.map((source) => ({
          id: source.id,
          name: source.name,
          thumbnail: source.thumbnail.toDataURL()
        })),
        canceled: false
      }
    } catch (error) {
      if (!isAudioSourceSelectionCanceled(error)) {
        console.error('Failed to get audio sources:', error)
        throw new Error('Desktop audio source not available.')
      }

      return {
        sources: [],
        canceled: true
      }
    }
  })

  ipcMain.handle('set-always-on-top', (_event, value: boolean) => {
    if (!isWaylandSession) {
      mainWindow?.setAlwaysOnTop(value)
    }
    settingsManager?.setSetting('alwaysOnTop', value)
    return value
  })

  ipcMain.handle('set-window-opacity', (_event, value: number) => {
    if (!isWaylandSession) {
      mainWindow?.setOpacity(value)
    }
    settingsManager?.setSetting('windowOpacity', value)
    return value
  })

  ipcMain.handle('minimize-window', () => {
    mainWindow?.minimize()
  })

  ipcMain.handle('close-window', () => {
    mainWindow?.close()
  })

  ipcMain.handle('clear-history', () => {
    resetRuntimePipelineState()
    return { success: true }
  })

  ipcMain.handle('get-history', () => {
    return historyManager?.getHistory() || []
  })

  ipcMain.handle('save-history-entry', (_event, entry: AnswerEntry) => {
    historyManager?.addEntry(entry)
    return { success: true }
  })

  ipcMain.handle('save-history-entries', (_event, entries: AnswerEntry[]) => {
    historyManager?.addEntries(entries)
    return { success: true }
  })

  ipcMain.handle('clear-saved-history', () => {
    historyManager?.clearHistory()
    return { success: true }
  })

  ipcMain.handle('delete-history-entry', (_event, id: string) => {
    historyManager?.deleteEntry(id)
    return { success: true }
  })

  ipcMain.handle('write-to-clipboard', (_event, text: string) => {
    try {
      clipboard.writeText(text)
      return { success: true }
    } catch (error) {
      console.error('Failed to write to clipboard:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  })

  ipcMain.handle('capture-screenshot', async () => {
    try {
      if (!screenshotService) {
        screenshotService = new ScreenshotService(mainWindow || undefined)
      }

      const settings = settingsManager?.getSettings()
      const result = await screenshotService.captureActiveWindow(
        settings?.captureSourceId,
        settings?.captureSourceType
      )

      if (
        result.success &&
        result.sourceId &&
        result.sourceType &&
        settingsManager &&
        (settings?.captureSourceId !== result.sourceId ||
          settings?.captureSourceType !== result.sourceType)
      ) {
        settingsManager.updateSettings({
          captureSourceId: result.sourceId,
          captureSourceType: result.sourceType
        })
      }

      if (result.success && result.imageData) {
        mainWindow?.webContents.send('screenshot-captured', { imageData: result.imageData })
      }

      return result
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to capture screenshot'
      console.error('Screenshot capture error:', errorMessage)
      return {
        success: false,
        error: errorMessage
      }
    }
  })

  ipcMain.handle(
    'call-session-api',
    async (
      _event,
      payload: { sessionDuration: number; timestamp: number; [key: string]: unknown }
    ) => {
      try {
        const apiEndpoint = process.env.SESSION_API_URL?.trim()

        if (!apiEndpoint) {
          return {
            success: false,
            skipped: true
          }
        }

        const response = await fetch(apiEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        })

        if (!response.ok) {
          throw new Error(`API call failed with status: ${response.status}`)
        }

        const result = await response.json()
        return { success: true, data: result }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to call session API'
        console.error('Session API error:', errorMessage)
        return {
          success: false,
          error: errorMessage
        }
      }
    }
  )

  ipcMain.handle('analyze-screenshot', async (_event, imageData: string) => {
    const settings = settingsManager?.getSettings()

    if (!settings) {
      return {
        success: false,
        error: 'Settings not available'
      }
    }

    const validationError = validateProviderSettings(settings)
    if (validationError) {
      return {
        success: false,
        error: validationError
      }
    }

    const providerConfig = getProviderConfig(settings)
    if (settings.llmProvider === 'llama.cpp') {
      try {
        await ensureLocalLlmModelReady(settings.llmModel, settings.llmModelDir)
      } catch (err) {
        console.warn('[LlamaCpp] startup failed:', err)
      }
    }
    if (settings.llmProvider === 'openai-oauth') {
      providerConfig.apiKey = (await ensureOpenAIOAuthToken()) || ''
    }

    try {
      visionService = new VisionService({
        apiKey: providerConfig.apiKey,
        baseURL: providerConfig.baseURL,
        customHeaders: providerConfig.customHeaders,
        chatgptAccountId: settings.llmOauthAccountId,
        model: settings.llmModel || 'gpt-4o-mini'
      })

      if (!openaiService) {
        openaiService = new OpenAIService({
          apiKey: providerConfig.apiKey,
          baseURL: providerConfig.baseURL,
          customHeaders: providerConfig.customHeaders,
          chatgptAccountId: settings.llmOauthAccountId,
          useResponsesApi: shouldUseResponsesApi(settings),
          model: settings.llmModel
        })
        attachOpenAIServiceListeners(openaiService)
      } else {
        openaiService.updateConfig({
          apiKey: providerConfig.apiKey,
          baseURL: providerConfig.baseURL,
          customHeaders: providerConfig.customHeaders,
          chatgptAccountId: settings.llmOauthAccountId,
          useResponsesApi: shouldUseResponsesApi(settings),
          model: settings.llmModel
        })
      }
      attachOpenAIServiceListeners(openaiService)

      const analysis = await visionService.analyzeScreenshot(imageData)

      if (analysis.isQuestion) {
        const questionText = analysis.questionText?.trim() || 'Interview question from screenshot'
        const profile = avatarProfileManager?.getProfile()

        mainWindow?.webContents.send('question-detected-from-image', {
          text: questionText,
          questionType: analysis.questionType,
          confidence: analysis.confidence
        })

        try {
          const requestId = reserveAnswerRequest(pipelineEpoch)
          isGeneratingAnswer = true
          await openaiService.generateSolutionFromImage(
            imageData,
            analysis.questionText && analysis.questionText.trim().length > 10
              ? questionText
              : undefined,
            analysis.questionType,
            {
              identityBase: profile ? buildIdentityBase(profile) : '',
              answerStyle: profile ? buildAnswerStyle(profile) : '',
              interviewContext: profile ? buildInterviewContext(profile) : '',
              avatarContext: profile?.candidateKnowledge || ''
            },
            requestId
          )
        } catch (error) {
          console.error('Solution generation error:', error)
          mainWindow?.webContents.send('answer-error', (error as Error).message)
          return {
            success: false,
            error: (error as Error).message
          }
        }

        return {
          success: true,
          isQuestion: true,
          questionText: questionText,
          questionType: analysis.questionType
        }
      } else {
        if (
          analysis.confidence &&
          analysis.confidence >= 0.65 &&
          analysis.questionText &&
          analysis.questionText.trim().length > 20
        ) {
          const questionText = analysis.questionText?.trim() || 'Technical problem from screenshot'
          const profile = avatarProfileManager?.getProfile()

          mainWindow?.webContents.send('question-detected-from-image', {
            text: questionText,
            questionType: analysis.questionType || 'other',
            confidence: analysis.confidence
          })

          try {
            const requestId = reserveAnswerRequest(pipelineEpoch)
            isGeneratingAnswer = true
            await openaiService.generateSolutionFromImage(
              imageData,
              analysis.questionText && analysis.questionText.trim().length > 10
                ? questionText
                : undefined,
              analysis.questionType || 'other',
              {
                identityBase: profile ? buildIdentityBase(profile) : '',
                answerStyle: profile ? buildAnswerStyle(profile) : '',
                interviewContext: profile ? buildInterviewContext(profile) : '',
                avatarContext: profile?.candidateKnowledge || ''
              },
              requestId
            )

            return {
              success: true,
              isQuestion: true,
              questionText: questionText,
              questionType: analysis.questionType || 'other'
            }
          } catch (error) {
            console.error('Solution generation error:', error)
          }
        }

        mainWindow?.webContents.send('screenshot-no-question', {
          message:
            'No interview question detected in the screenshot. Please make sure the question is clearly visible and try again.'
        })
        return {
          success: true,
          isQuestion: false,
          message: 'No interview question detected in the screenshot'
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to analyze screenshot'
      console.error('Screenshot analysis error:', errorMessage)
      mainWindow?.webContents.send('answer-error', errorMessage)
      return {
        success: false,
        error: errorMessage
      }
    }
  })
}

export async function cleanupIpcHandlers(): Promise<void> {
  unregisterIpcHandlers()
  resetRuntimePipelineState()
  await llamaCppLlmServer.dispose()
  avatarProfileManager = null
  if (whisperService) {
    const service = whisperService
    whisperService = null
    service.removeAllListeners()
    await service.stop()
  }
  if (openaiService) {
    const service = openaiService
    openaiService = null
    service.removeAllListeners()
  }
  questionDetector?.removeAllListeners()
  questionDetector = null
  settingsManager = null
  historyManager = null
  screenshotService = null
  visionService = null
  mainWindow = null
  isCapturing = false
}
