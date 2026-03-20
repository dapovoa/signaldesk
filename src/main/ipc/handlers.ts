import { BrowserWindow, clipboard, desktopCapturer, ipcMain } from 'electron'
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
let mainWindow: BrowserWindow | null = null
let isCapturing = false
let isGeneratingAnswer = false
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

export function initializeIpcHandlers(window: BrowserWindow, waylandFlag = false): void {
  mainWindow = window
  isWaylandSession = waylandFlag
  settingsManager = new SettingsManager()
  historyManager = new HistoryManager()
  questionDetector = new QuestionDetector()

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
        model: settings.llmModel,
        cvSummary: settings.cvSummary,
        jobTitle: settings.jobTitle,
        companyName: settings.companyName,
        jobDescription: settings.jobDescription,
        companyContext: settings.companyContext
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

      openaiService.on('error', (error) => {
        isGeneratingAnswer = false
        console.error('[Pipeline] answer-error event:', error)
      })

      // Set up Whisper event listeners
      whisperService.on('transcript', async (event) => {
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
              isGeneratingAnswer = true
              await openaiService.generateAnswer(earlyDetection.text)
            } catch (error) {
              isGeneratingAnswer = false
              console.error('[Pipeline] early detection answer failed:', error)
              mainWindow?.webContents.send('answer-error', (error as Error).message)
            }
          }
        }
      })

      whisperService.on('utteranceEnd', () => {
        console.log('[Pipeline] utterance end -> debounce')
        if (utteranceDebounceTimer) {
          clearTimeout(utteranceDebounceTimer)
        }
        utteranceDebounceTimer = setTimeout(() => {
          console.log('[Pipeline] debounce elapsed -> detector')
          questionDetector?.onUtteranceEnd()
          utteranceDebounceTimer = null
        }, 750)
        mainWindow?.webContents.send('utterance-end')
      })

      whisperService.on('speechStarted', () => {
        mainWindow?.webContents.send('speech-started')
      })

      whisperService.on('error', (error) => {
        const errorMessage = error instanceof Error ? error.message : 'Unknown capture error'
        console.error('Whisper error:', errorMessage)
        mainWindow?.webContents.send('capture-error', errorMessage)
      })

      // Set up question detector listener ONCE
      questionDetector?.on('questionDetected', async (detection) => {
        if (isGeneratingAnswer) {
          console.log('[Pipeline] skipping detector trigger while answer is already generating')
          return
        }
        console.log('[Pipeline] detector triggered:', detection)
        mainWindow?.webContents.send('question-detected', detection)

        if (openaiService) {
          try {
            isGeneratingAnswer = true
            await openaiService.generateAnswer(detection.text)
          } catch (error) {
            isGeneratingAnswer = false
            console.error('[Pipeline] detector answer failed:', error)
            mainWindow?.webContents.send('answer-error', (error as Error).message)
          }
        }
      })

      // Start Whisper service
      await whisperService.start()
      isCapturing = true
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
      await whisperService.stop()
      whisperService.removeAllListeners()
      whisperService = null
    }

    if (openaiService) {
      openaiService.removeAllListeners()
      openaiService = null
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
    openaiService?.clearHistory()
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

      const result = await screenshotService.captureActiveWindow()

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
        model: settings.llmModel || 'gpt-4o-mini'
      })

      if (!openaiService) {
        openaiService = new OpenAIService({
          apiKey: providerConfig.apiKey,
          baseURL: providerConfig.baseURL,
          customHeaders: providerConfig.customHeaders,
          chatgptAccountId: settings.llmOauthAccountId,
          useResponsesApi: shouldUseResponsesApi(settings),
          model: settings.llmModel,
          cvSummary: settings.cvSummary,
          jobTitle: settings.jobTitle,
          companyName: settings.companyName,
          jobDescription: settings.jobDescription,
          companyContext: settings.companyContext
        })

        // Set up OpenAI event listeners
        openaiService.on('stream', (chunk) => {
          mainWindow?.webContents.send('answer-stream', chunk)
        })

        openaiService.on('complete', (answer) => {
          mainWindow?.webContents.send('answer-complete', answer)
        })
      } else {
        openaiService.updateConfig({
          apiKey: providerConfig.apiKey,
          baseURL: providerConfig.baseURL,
          customHeaders: providerConfig.customHeaders,
          chatgptAccountId: settings.llmOauthAccountId,
          useResponsesApi: shouldUseResponsesApi(settings),
          model: settings.llmModel,
          cvSummary: settings.cvSummary,
          jobTitle: settings.jobTitle,
          companyName: settings.companyName,
          jobDescription: settings.jobDescription,
          companyContext: settings.companyContext
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
            analysis.questionType
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
        // No question detected - but if confidence is moderate, still try to generate solution
        if (analysis.confidence && analysis.confidence >= 0.3) {
          console.log('Low confidence but attempting solution generation anyway...')
          const questionText = analysis.questionText?.trim() || 'Technical problem from screenshot'

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
              analysis.questionType || 'other'
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

        // No question detected - log why
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
