import { BrowserWindow, clipboard, desktopCapturer, ipcMain, shell } from 'electron'
import * as fs from 'fs'
import { AnswerEntry } from '../../preload/index'
import {
  CHATGPT_CODEX_BASE_URL,
  refreshOpenAIOAuthTokens,
  startOpenAIOAuthFlow
} from '../services/openaiOAuth'
import { HistoryManager } from '../services/historyManager'
import { createOpenAIClient } from '../services/openaiClient'
import { OpenAIService } from '../services/openaiService'
import { QuestionDetector } from '../services/questionDetector'
import { ScreenshotService } from '../services/screenshotService'
import { AppSettings, SettingsManager } from '../services/settingsManager'
import { testAssemblyAIConnection } from '../services/assemblyAIRealtime'
import { AvatarKnowledgeService } from '../services/avatarKnowledgeService'
import {
  AvatarProfile,
  AvatarProfileManager,
  getDefaultAvatarSourceDirectory
} from '../services/avatarProfileManager'
import { streamChatGPTCodexResponse } from '../services/chatgptCodexClient'
import { VisionService } from '../services/visionService'
import { WhisperService } from '../services/whisperService'

let whisperService: WhisperService | null = null
let openaiService: OpenAIService | null = null
let questionDetector: QuestionDetector | null = null
let settingsManager: SettingsManager | null = null
let historyManager: HistoryManager | null = null
let screenshotService: ScreenshotService | null = null
let visionService: VisionService | null = null
let avatarKnowledgeService: AvatarKnowledgeService | null = null
let avatarProfileManager: AvatarProfileManager | null = null
let mainWindow: BrowserWindow | null = null
let isCapturing = false
let isGeneratingAnswer = false
let isClassifyingQuestion = false
let lastModelQuestionClassificationAt = 0
let utteranceDebounceTimer: NodeJS.Timeout | null = null
let isWaylandSession = false
const OPENAI_OAUTH_MODELS = [
  'gpt-5.4',
  'gpt-5.4-mini',
  'gpt-5.3-codex',
  'gpt-5.2-codex',
  'gpt-5.2',
  'gpt-5.1-codex-max',
  'gpt-5.1-codex-mini'
]

const isNotFoundError = (error: unknown): boolean => {
  if (!error) return false
  const msg = error instanceof Error ? error.message : String(error)
  return msg.includes('404') || msg.toLowerCase().includes('not found')
}

const getProviderConfig = (settings: AppSettings) => {
  const isOpenAICompatible =
    settings.llmProvider === 'openai-compatible' || settings.llmProvider === 'openai-oauth'
  const credential =
    settings.llmProvider === 'openai-oauth' ||
    (settings.llmProvider === 'openai' && settings.llmAuthMode === 'oauth-token')
      ? settings.llmOauthToken
      : settings.llmApiKey

  return {
    apiKey: credential,
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

  return settings.llmProvider === 'openai' && settings.llmAuthMode !== 'oauth-token'
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

const getTranscriptionConfig = (settings: AppSettings) => {
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
  const hasCredential =
    settings.llmProvider === 'openai-oauth' ||
    (settings.llmProvider === 'openai' && settings.llmAuthMode === 'oauth-token')
      ? Boolean(settings.llmOauthToken?.trim())
      : Boolean(settings.llmApiKey?.trim())

  if (!hasCredential) {
    return settings.llmProvider === 'openai-oauth'
      ? 'OpenAI OAuth token not configured. Please sign in in Settings.'
      : settings.llmProvider === 'openai' && settings.llmAuthMode === 'oauth-token'
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

  if (settings.transcriptionProvider === 'openai' && !settings.llmApiKey?.trim()) {
    return 'OpenAI API key not configured for transcription. Please add it in Settings.'
  }

  return null
}

const buildInterviewContext = (profile: AvatarProfile): string => {
  const sections = [
    { label: 'Candidate Background', value: profile.cvSummary.trim() },
    { label: 'Target Role', value: profile.jobTitle.trim() },
    { label: 'Company', value: profile.companyName.trim() },
    { label: 'Job Description', value: profile.jobDescription.trim() },
    { label: 'Company Details', value: profile.companyContext.trim() }
  ].filter((section) => section.value)

  return sections.map((section) => `${section.label}:\n${section.value}`).join('\n\n')
}

const buildIdentityBase = (profile: AvatarProfile): string => profile.identityBase.trim()

const ensureDirectory = (directory: string): void => {
  fs.mkdirSync(directory, { recursive: true })
}

const logAvatarContext = (question: string, avatarContext?: { snippets: Array<{
  title: string
  sectionTitle: string
  kind: string
  tags: string[]
  distance: number
}>; promptContext: string } | null): void => {
  if (!avatarContext) {
    console.log('[AvatarRAG] no retrieved memory:', { question })
    return
  }

  console.log('[AvatarRAG] retrieved memory:', {
    question,
    promptContextLength: avatarContext.promptContext.length,
    snippets: avatarContext.snippets.map((snippet) => ({
      title: snippet.title,
      sectionTitle: snippet.sectionTitle,
      kind: snippet.kind,
      tags: snippet.tags,
      distance: Number(snippet.distance.toFixed(4))
    }))
  })
}

type ClassifierQuestionType = 'direct' | 'indirect' | 'scenario' | 'none'

interface ModelQuestionClassification {
  shouldAnswer: boolean
  confidence: number
  questionType: ClassifierQuestionType
}

interface ModelClassifierResult {
  supported: boolean
  detection: { text: string; confidence: number; questionType: 'direct' | 'indirect' | 'scenario' } | null
}

const MODEL_CLASSIFIER_THRESHOLD = 0.62
const MODEL_CLASSIFIER_MIN_CHARS = 80
const MODEL_CLASSIFIER_MIN_INTERVAL_MS = 5000

const notifyQuestionNotDetected = (text: string): void => {
  const normalized = text.trim()
  if (!normalized) return
  mainWindow?.webContents.send('question-not-detected-by-model', { text: normalized })
}

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

  lastModelQuestionClassificationAt = now
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
      console.warn('[QuestionClassifier] invalid model JSON output')
      return { supported: false, detection: null }
    }

    if (!parsed.shouldAnswer || parsed.questionType === 'none') {
      console.log('[QuestionClassifier] model classified as non-question:', {
        confidence: parsed.confidence
      })
      return { supported: true, detection: null }
    }

    if (parsed.confidence < MODEL_CLASSIFIER_THRESHOLD) {
      console.log('[QuestionClassifier] model confidence below threshold:', {
        confidence: parsed.confidence
      })
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
    console.warn('[QuestionClassifier] model classifier unavailable, using heuristic fallback:', error)
    return { supported: false, detection: null }
  }
}

const generateAnswerForQuestion = async (questionText: string): Promise<void> => {
  if (!openaiService) {
    throw new Error('Answer generation is not available')
  }

  if (isGeneratingAnswer) {
    throw new Error('An answer is already being generated')
  }

  const trimmedQuestion = questionText.trim()
  if (!trimmedQuestion) {
    throw new Error('No question text provided')
  }

  isGeneratingAnswer = true
  mainWindow?.webContents.send('question-detected', {
    text: trimmedQuestion,
    confidence: 1,
    questionType: 'direct'
  })

  try {
    const profile = avatarProfileManager?.getProfile()
    const avatarContext = await avatarKnowledgeService?.buildContextPack(trimmedQuestion)
    logAvatarContext(trimmedQuestion, avatarContext)
    await openaiService.generateAnswer(trimmedQuestion, {
      identityBase: profile ? buildIdentityBase(profile) : '',
      interviewContext: profile ? buildInterviewContext(profile) : '',
      avatarContext: avatarContext?.promptContext
    })
  } catch (error) {
    isGeneratingAnswer = false
    throw error
  }
}

export function initializeIpcHandlers(window: BrowserWindow, waylandFlag = false): void {
  mainWindow = window
  isWaylandSession = waylandFlag
  settingsManager = new SettingsManager()
  historyManager = new HistoryManager()
  questionDetector = new QuestionDetector()
  avatarProfileManager = new AvatarProfileManager()
  settingsManager.flushPendingMigrations()
  avatarKnowledgeService = new AvatarKnowledgeService(avatarProfileManager.getProfile())

  // Settings handlers
  ipcMain.handle('get-settings', () => {
    return settingsManager?.getSettings()
  })

  ipcMain.handle('update-settings', (_event, updates: Partial<AppSettings>) => {
    settingsManager?.updateSettings(updates)

    // Apply window settings immediately
    if (updates.alwaysOnTop !== undefined && mainWindow && !isWaylandSession) {
      mainWindow.setAlwaysOnTop(updates.alwaysOnTop)
    }
    if (updates.windowOpacity !== undefined && mainWindow && !isWaylandSession) {
      mainWindow.setOpacity(updates.windowOpacity)
    }

    return settingsManager?.getSettings()
  })

  ipcMain.handle('has-api-keys', () => {
    return settingsManager?.hasApiKeys()
  })

  ipcMain.handle('get-avatar-profile', () => {
    return avatarProfileManager?.getProfile()
  })

  ipcMain.handle('update-avatar-profile', async (_event, updates: Partial<AvatarProfile>) => {
    if (!avatarProfileManager) {
      throw new Error('Avatar profile manager not initialized')
    }

    const profile = avatarProfileManager.updateProfile(updates)
    avatarKnowledgeService?.updateProfile(profile)
    return profile
  })

  ipcMain.handle('open-avatar-memory-folder', async () => {
    const targetDirectory = getDefaultAvatarSourceDirectory()
    ensureDirectory(targetDirectory)
    const error = await shell.openPath(targetDirectory)

    return {
      success: !error,
      path: targetDirectory,
      error: error || undefined
    }
  })

  ipcMain.handle('get-avatar-index-status', async () => {
    if (!avatarProfileManager || !avatarKnowledgeService) {
      throw new Error('Avatar services not initialized')
    }

    return avatarKnowledgeService.getStatus(avatarProfileManager.getProfile())
  })

  ipcMain.handle('reindex-avatar-sources', async () => {
    if (!avatarProfileManager || !avatarKnowledgeService) {
      throw new Error('Avatar services not initialized')
    }

    return avatarKnowledgeService.reindex(avatarProfileManager.getProfile(), (progress) => {
      mainWindow?.webContents.send('avatar-reindex-progress', progress)
    })
  })

  ipcMain.handle('generate-answer-manually', async (_event, questionText: string) => {
    await generateAnswerForQuestion(questionText)
    return { success: true }
  })

  ipcMain.handle('get-window-capabilities', () => {
    return {
      isWayland: isWaylandSession,
      supportsAlwaysOnTop: !isWaylandSession,
      supportsWindowOpacity: !isWaylandSession,
      warning: isWaylandSession
        ? 'Unavailable on GNOME Wayland.'
        : ''
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

  const resolveCredentialFromPayload = (payload: {
    apiKey?: string
    oauthToken?: string
    provider?: 'openai' | 'openai-oauth' | 'openai-compatible'
    authMode?: 'api-key' | 'oauth-token'
  }): string | undefined => {
    const provider = payload?.provider || 'openai'
    const authMode = payload?.authMode || 'api-key'
    return provider === 'openai-oauth' || (provider === 'openai' && authMode === 'oauth-token')
      ? payload?.oauthToken?.trim()
      : payload?.apiKey?.trim()
  }

  // Fetch models from selected provider
  ipcMain.handle(
    'fetch-openai-models',
    async (
      _event,
      payload: {
        apiKey?: string
        oauthToken?: string
        provider?: 'openai' | 'openai-oauth' | 'openai-compatible'
        authMode?: 'api-key' | 'oauth-token'
        baseURL?: string
        customHeaders?: string
      }
    ) => {
      const provider = payload?.provider || 'openai'
      const authMode = payload?.authMode || 'api-key'

      if (provider === 'openai-oauth') {
        return {
          success: true,
          models: OPENAI_OAUTH_MODELS.map((id) => ({ id, name: id }))
        }
      }

      const credential = resolveCredentialFromPayload(payload)
      const baseURL = provider === 'openai-compatible' ? payload?.baseURL?.trim() : undefined

      if (!credential) {
        return {
          success: false,
          error: provider === 'openai' && authMode === 'oauth-token' ? 'OAuth token is required' : 'API key is required',
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
        console.error('Error fetching models:', errorMessage)
        return { success: false, error: errorMessage, models: [] }
      }
    }
  )

  ipcMain.handle(
    'fetch-ollama-embedding-models',
    async (_event, payload?: { baseURL?: string }) => {
      const normalizedBaseUrl = (payload?.baseURL?.trim() || process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/+$/, '')

      try {
        const response = await fetch(`${normalizedBaseUrl}/api/tags`, {
          method: 'GET',
          headers: {
            Accept: 'application/json'
          }
        })

        if (!response.ok) {
          const body = await response.text()
          throw new Error(`Ollama tags request failed: ${response.status} ${body}`)
        }

        const payloadJson = (await response.json()) as {
          models?: Array<{
            name?: string
            model?: string
            details?: {
              family?: string
              families?: string[]
            }
          }>
        }

        const models = (payloadJson.models || [])
          .map((model) => {
            const id = model.name?.trim() || model.model?.trim() || ''
            if (!id) return null

            return {
              id,
              name: id
            }
          })
          .filter((model): model is { id: string; name: string } => Boolean(model))
          .sort((left, right) => left.id.localeCompare(right.id))

        return { success: true, models }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to fetch Ollama models'
        console.error('Error fetching Ollama embedding models:', errorMessage)
        return { success: false, error: errorMessage, models: [] as Array<{ id: string; name: string }> }
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
        provider?: 'openai' | 'openai-oauth' | 'openai-compatible'
        authMode?: 'api-key' | 'oauth-token'
        baseURL?: string
        customHeaders?: string
        model?: string
      }
    ) => {
      const provider = payload?.provider || 'openai'
      const authMode = payload?.authMode || 'api-key'
      const credential =
        provider === 'openai-oauth' && !payload?.oauthToken?.trim()
          ? await ensureOpenAIOAuthToken()
          : resolveCredentialFromPayload(payload)
      const storedSettings = settingsManager?.getSettings()
      const baseURL =
        provider === 'openai-oauth'
          ? CHATGPT_CODEX_BASE_URL
          : provider === 'openai-compatible'
          ? payload?.baseURL?.trim()
          : undefined
      const preferredModel = payload?.model?.trim()

      if (!credential) {
        return {
          success: false,
          message:
            provider === 'openai-oauth' || (provider === 'openai' && authMode === 'oauth-token')
              ? 'OAuth token is required'
              : 'API key is required'
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

      try {
        const client = createOpenAIClient({
          apiKey: credential,
          baseURL,
          customHeaders:
            provider === 'openai-oauth'
              ? storedSettings?.llmOauthAccountId
                ? `ChatGPT-Account-Id: ${storedSettings.llmOauthAccountId}`
                : undefined
              : payload?.customHeaders
        })

        if (payload?.provider === 'openai-oauth') {
          const oauthModel = preferredModel || 'gpt-5.4'
          const stream = streamChatGPTCodexResponse({
            accessToken: credential,
            accountId: storedSettings?.llmOauthAccountId || '',
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
          for await (const event of stream) {
            if (event.type === 'response.output_text.delta') {
              break
            }
          }

          return {
            success: true,
            message: 'LLM connection established.',
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
            throw error
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
        assemblyAiSpeechModel?: 'universal-streaming-multilingual' | 'universal-streaming-english'
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

  // Audio capture handlers
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
      // IMPORTANT: Clean up any existing services/listeners first to prevent duplicates
      if (whisperService) {
        whisperService.removeAllListeners()
        whisperService = null
      }
      if (openaiService) {
        openaiService.removeAllListeners()
        openaiService = null
      }
      questionDetector?.removeAllListeners()

      const providerConfig = getProviderConfig(settings)
      if (settings.llmProvider === 'openai-oauth') {
        providerConfig.apiKey = (await ensureOpenAIOAuthToken()) || ''
      }
      const transcriptionConfig = getTranscriptionConfig(settings)

      // Initialize Whisper service for transcription
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
        assemblyAiPrompt: settings.assemblyAiPrompt
      })

      // Initialize OpenAI service for answer generation
      openaiService = new OpenAIService({
        apiKey: providerConfig.apiKey,
        baseURL: providerConfig.baseURL,
        customHeaders: providerConfig.customHeaders,
        chatgptAccountId: settings.llmOauthAccountId,
        useResponsesApi: shouldUseResponsesApi(settings),
        model: settings.llmModel
      })

      // Set up OpenAI event listeners ONCE
      openaiService.on('stream', (chunk) => {
        console.log('[Pipeline] answer-stream chunk:', chunk.slice(0, 80))
        mainWindow?.webContents.send('answer-stream', chunk)
      })

      openaiService.on('complete', (answer) => {
        isGeneratingAnswer = false
        console.log('[Pipeline] answer-complete:', answer.slice(0, 160))
        mainWindow?.webContents.send('answer-complete', answer)
      })

      openaiService.on('truncated', () => {
        console.warn('[Pipeline] answer truncated by max token limit')
        mainWindow?.webContents.send('answer-truncated')
      })

      openaiService.on('error', (error) => {
        isGeneratingAnswer = false
        console.error('[Pipeline] answer-error event:', error)
      })

      // Set up Whisper event listeners
      whisperService.on('transcript', async (event) => {
        if (!isCapturing) {
          return
        }
        console.log('[Pipeline] transcript received:', {
          text: event.text,
          isFinal: event.isFinal
        })
        questionDetector?.addTranscript(event.text, event.isFinal)
        mainWindow?.webContents.send('transcript', event)

        // Try early detection for faster response on high-confidence questions
        if (event.isFinal && questionDetector && openaiService) {
          const earlyDetection = questionDetector.checkEarlyDetection(event.text)
          if (earlyDetection) {
            if (isGeneratingAnswer) {
              console.log('[Pipeline] skipping early detection while answer is already generating')
              return
            }
            console.log('[Pipeline] early detection triggered:', earlyDetection)
            mainWindow?.webContents.send('question-detected', earlyDetection)
            try {
              await generateAnswerForQuestion(earlyDetection.text)
            } catch (error) {
              isGeneratingAnswer = false
              console.error('[Pipeline] early detection answer failed:', error)
              mainWindow?.webContents.send('answer-error', (error as Error).message)
            }
          }
        }
      })

      whisperService.on('utteranceEnd', () => {
        if (!isCapturing) {
          return
        }
        console.log('[Pipeline] utterance end -> debounce')
        if (utteranceDebounceTimer) {
          clearTimeout(utteranceDebounceTimer)
        }
        utteranceDebounceTimer = setTimeout(() => {
          utteranceDebounceTimer = null
          if (!questionDetector) return

          void (async () => {
            console.log('[Pipeline] debounce elapsed -> detector')
            if (isClassifyingQuestion) {
              console.log('[Pipeline] classifier busy, skipping this cycle')
              return
            }

            isClassifyingQuestion = true
            try {
              const turnText = questionDetector.getCurrentBuffer()
              if (!turnText) {
                questionDetector.clearBuffer()
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
              if (classifierResult.supported) {
                questionDetector.clearBuffer()
                if (classifierResult.detection) {
                  console.log('[Pipeline] model classifier triggered:', classifierResult.detection)
                  questionDetector.emit('questionDetected', classifierResult.detection)
                } else {
                  console.log('[Pipeline] model classifier did not detect a question')
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
        }, 1200)
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

      // Set up question detector listener ONCE
      questionDetector?.on('questionDetected', async (detection) => {
        if (!isCapturing) {
          return
        }
        if (isGeneratingAnswer) {
          console.log('[Pipeline] skipping detector trigger while answer is already generating')
          return
        }
        console.log('[Pipeline] detector triggered:', detection)
        mainWindow?.webContents.send('question-detected', detection)

        if (openaiService) {
          try {
            await generateAnswerForQuestion(detection.text)
          } catch (error) {
            isGeneratingAnswer = false
            console.error('[Pipeline] detector answer failed:', error)
            mainWindow?.webContents.send('answer-error', (error as Error).message)
          }
        }
      })

      isCapturing = true
      // Start Whisper service
      await whisperService.start()
      console.log('Audio capture started successfully')

      return { success: true }
    } catch (error) {
      console.error('start-capture error:', error)
      const errorMessage = error instanceof Error ? error.message : 'Failed to start capture'
      throw new Error(errorMessage)
    }
  })

  ipcMain.handle('stop-capture', async () => {
    isCapturing = false
    isGeneratingAnswer = false
    if (utteranceDebounceTimer) {
      clearTimeout(utteranceDebounceTimer)
      utteranceDebounceTimer = null
    }

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

    // Remove question detector listeners to prevent duplicates on next start
    questionDetector?.removeAllListeners()
    questionDetector?.clearBuffer()
    console.log('Audio capture stopped')

    return { success: true }
  })

  ipcMain.handle('get-capture-status', () => {
    return isCapturing
  })

  // Audio data from renderer
  ipcMain.on('audio-data', (_event, audioData: ArrayBuffer) => {
    if (whisperService && isCapturing) {
      whisperService.addAudioData(audioData)
    }
  })

  // Get audio sources for system audio capture
  ipcMain.handle('get-audio-sources', async () => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        fetchWindowIcons: true
      })

      return sources.map((source) => ({
        id: source.id,
        name: source.name,
        thumbnail: source.thumbnail.toDataURL()
      }))
    } catch (error) {
      console.error('Failed to get audio sources:', error)
      throw new Error('Desktop audio source not available.')
    }
  })

  // Window control handlers
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

  // Clear conversation history
  ipcMain.handle('clear-history', () => {
    return { success: true }
  })

  // History handlers
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

  // Clipboard handlers
  ipcMain.handle('write-to-clipboard', (_event, text: string) => {
    try {
      clipboard.writeText(text)
      return { success: true }
    } catch (error) {
      console.error('Failed to write to clipboard:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  })

  // Screenshot handlers
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

  // Session API handler
  ipcMain.handle(
    'call-session-api',
    async (
      _event,
      payload: { sessionDuration: number; timestamp: number; [key: string]: unknown }
    ) => {
      try {
        // Placeholder API endpoint - can be configured via settings or environment variable
        const API_ENDPOINT = process.env.SESSION_API_URL || 'https://api.example.com/session'

        const response = await fetch(API_ENDPOINT, {
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
        console.log('Session API called successfully:', result)
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
    if (settings.llmProvider === 'openai-oauth') {
      providerConfig.apiKey = (await ensureOpenAIOAuthToken()) || ''
    }

    try {
      // Recreate vision service with latest provider settings
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

        // Set up OpenAI event listeners
        openaiService.on('stream', (chunk) => {
          mainWindow?.webContents.send('answer-stream', chunk)
        })

        openaiService.on('complete', (answer) => {
          mainWindow?.webContents.send('answer-complete', answer)
        })

        openaiService.on('truncated', () => {
          mainWindow?.webContents.send('answer-truncated')
        })
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

      // Analyze screenshot for interview question
      console.log('Analyzing screenshot for interview question...')
      const analysis = await visionService.analyzeScreenshot(imageData)

      console.log('Analysis result:', {
        isQuestion: analysis.isQuestion,
        hasQuestionText: !!analysis.questionText,
        questionTextLength: analysis.questionText?.length || 0,
        questionType: analysis.questionType,
        confidence: analysis.confidence
      })

      // Check if question is detected - be more lenient
      if (analysis.isQuestion) {
        // If we have question text, use it. Otherwise, we'll extract from image directly
        const questionText = analysis.questionText?.trim() || 'Interview question from screenshot'
        const profile = avatarProfileManager?.getProfile()
        const avatarContext = await avatarKnowledgeService?.buildContextPack(questionText)

        console.log('Question detected:', questionText.substring(0, 100))
        console.log('Question type:', analysis.questionType)

        // Send question detected event
        mainWindow?.webContents.send('question-detected-from-image', {
          text: questionText,
          questionType: analysis.questionType,
          confidence: analysis.confidence
        })

        // Generate solution - pass questionText only if we have it, otherwise let the model extract from image
        try {
          await openaiService.generateSolutionFromImage(
            imageData,
            analysis.questionText && analysis.questionText.trim().length > 10
              ? questionText
              : undefined,
            analysis.questionType,
            {
              identityBase: profile ? buildIdentityBase(profile) : '',
              interviewContext: profile ? buildInterviewContext(profile) : '',
              avatarContext: avatarContext?.promptContext
            }
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
        // Only force a generation pass when extraction is still fairly strong.
        if (
          analysis.confidence &&
          analysis.confidence >= 0.65 &&
          analysis.questionText &&
          analysis.questionText.trim().length > 20
        ) {
          console.log('Moderate-confidence question text found, attempting answer generation...')
          const questionText = analysis.questionText?.trim() || 'Technical problem from screenshot'
          const profile = avatarProfileManager?.getProfile()
          const avatarContext = await avatarKnowledgeService?.buildContextPack(questionText)

          mainWindow?.webContents.send('question-detected-from-image', {
            text: questionText,
            questionType: analysis.questionType || 'other',
            confidence: analysis.confidence
          })

          try {
            await openaiService.generateSolutionFromImage(
              imageData,
              analysis.questionText && analysis.questionText.trim().length > 10
                ? questionText
                : undefined,
              analysis.questionType || 'other',
              {
                identityBase: profile ? buildIdentityBase(profile) : '',
                interviewContext: profile ? buildInterviewContext(profile) : '',
                avatarContext: avatarContext?.promptContext
              }
            )

            return {
              success: true,
              isQuestion: true,
              questionText: questionText,
              questionType: analysis.questionType || 'other'
            }
          } catch (error) {
            console.error('Solution generation error:', error)
            // Fall through to no question message
          }
        }

        console.log('No question detected. Analysis:', {
          isQuestion: analysis.isQuestion,
          confidence: analysis.confidence,
          hasQuestionText: !!analysis.questionText
        })

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
  avatarKnowledgeService?.dispose()
  avatarKnowledgeService = null
  avatarProfileManager = null
  isGeneratingAnswer = false
  if (whisperService) {
    await whisperService.stop()
    whisperService = null
  }
  if (openaiService) {
    openaiService.removeAllListeners()
    openaiService = null
  }
  questionDetector = null
  settingsManager = null
  historyManager = null
  screenshotService = null
  visionService = null
  mainWindow = null
  isCapturing = false
}
