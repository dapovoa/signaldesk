import { AlertCircle, CheckCircle, Eye, EyeOff, FolderOpen, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AppSettings, useInterviewStore } from '../store/interviewStore'
import type { WindowCapabilities } from '../../../shared/contracts'
import {
  getAssemblyAiLanguageDetectionDefault,
  getAssemblyAiTurnSilenceDefaults
} from '../../../shared/defaults'
import {
  getActiveLlmModel,
  normalizeLlmSettings,
  resolveLlmCredential,
  setActiveLlmModel,
  usesOAuthCredential
} from '../../../shared/llmSettings'

interface LlmFormState {
  provider: AppSettings['llmProvider']
  authMode: AppSettings['llmAuthMode']
  usesOAuth: boolean
  credential: string
  baseURL: string
}

function SectionDivider({ label }: { label: string }): React.ReactNode {
  return (
    <div className="flex items-center gap-3 py-1">
      <div className="h-px flex-1 bg-cyan-400/20" />
      <span className="settings-field-label shrink-0 text-dark-500">{label}</span>
      <div className="h-px flex-1 bg-cyan-400/20" />
    </div>
  )
}

const normalizeSettingsForUi = normalizeLlmSettings
const SETTINGS_AUTOSAVE_DELAY_MS = 400

const getLlmFormState = (settings: AppSettings): LlmFormState => {
  const provider = settings.llmProvider
  const authMode = settings.llmAuthMode
  const usesOAuth = usesOAuthCredential({
    llmProvider: provider,
    llmAuthMode: authMode
  })

  return {
    provider,
    authMode,
    usesOAuth,
    credential: resolveLlmCredential(settings),
    baseURL: settings.llmBaseUrl.trim()
  }
}

const setActiveLlmCredential = (settings: AppSettings, value: string): AppSettings => {
  if (usesOAuthCredential(settings)) {
    return { ...settings, llmOauthToken: value }
  }

  if (settings.llmProvider === 'openai-compatible') {
    return { ...settings, llmOpenAICompatibleApiKey: value }
  }

  if (settings.llmProvider === 'anthropic-compatible') {
    return { ...settings, llmAnthropicCompatibleApiKey: value }
  }

  return { ...settings, llmApiKey: value }
}

const supportsAssemblyAiLanguageDetection = (
  speechModel: AppSettings['assemblyAiSpeechModel']
): boolean => {
  return speechModel === 'universal-streaming-multilingual'
}

const getAssemblyAiPromptValidationError = (
  settings: Pick<AppSettings, 'transcriptionProvider' | 'assemblyAiSpeechModel' | 'assemblyAiPrompt' | 'assemblyAiKeytermsPrompt'>
): string | null => {
  if (
    settings.transcriptionProvider === 'assemblyai' &&
    settings.assemblyAiSpeechModel === 'u3-rt-pro' &&
    settings.assemblyAiPrompt.trim() &&
    settings.assemblyAiKeytermsPrompt.trim()
  ) {
    return 'AssemblyAI Universal 3 Pro does not support using prompt and keyterms together.'
  }

  return null
}

const applyAssemblyAiSpeechModel = (
  settings: AppSettings,
  speechModel: AppSettings['assemblyAiSpeechModel']
): AppSettings => {
  const currentDefaults = getAssemblyAiTurnSilenceDefaults(settings.assemblyAiSpeechModel)
  const nextDefaults = getAssemblyAiTurnSilenceDefaults(speechModel)
  const currentLanguageDetectionDefault = getAssemblyAiLanguageDetectionDefault(
    settings.assemblyAiSpeechModel
  )
  const nextLanguageDetectionDefault = getAssemblyAiLanguageDetectionDefault(speechModel)

  const nextSettings: AppSettings = {
    ...settings,
    assemblyAiSpeechModel: speechModel
  }

  if (
    settings.assemblyAiMinTurnSilence === currentDefaults.minTurnSilence &&
    settings.assemblyAiMaxTurnSilence === currentDefaults.maxTurnSilence
  ) {
    nextSettings.assemblyAiMinTurnSilence = nextDefaults.minTurnSilence
    nextSettings.assemblyAiMaxTurnSilence = nextDefaults.maxTurnSilence
  }

  if (settings.assemblyAiLanguageDetection === currentLanguageDetectionDefault) {
    nextSettings.assemblyAiLanguageDetection = nextLanguageDetectionDefault
  }

  return nextSettings
}

export function SettingsModal(): React.ReactNode | null {
  const { settings, showSettings, setShowSettings, setSettings } = useInterviewStore()
  const [localSettings, setLocalSettings] = useState<AppSettings>(settings)
  const [showCredential, setShowCredential] = useState(false)
  const [showTranscriptionCredential, setShowTranscriptionCredential] = useState(false)
  const [models, setModels] = useState<Array<{ id: string; name: string }>>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [transcriptionStatus, setTranscriptionStatus] = useState<
    'idle' | 'connecting' | 'testing' | 'ok' | 'error'
  >('idle')
  const [transcriptionMessage, setTranscriptionMessage] = useState<string>('')
  const [transcriptionModels, setTranscriptionModels] = useState<string[]>([])
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>(
    'idle'
  )
  const [connectionMessage, setConnectionMessage] = useState<string>('')
  const [llmTestStatus, setLlmTestStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>(
    'idle'
  )
  const [oauthStatus, setOauthStatus] = useState<'idle' | 'connecting' | 'ok' | 'error'>('idle')
  const [oauthMessage, setOauthMessage] = useState<string>('')
  const [connectedModels, setConnectedModels] = useState<string[]>([])
  const [windowCapabilities, setWindowCapabilities] = useState<WindowCapabilities>({
    platform: 'linux',
    isWayland: false,
    supportsAlwaysOnTop: true,
    supportsWindowOpacity: true,
    warning: ''
  })
  const fetchTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const settingsAutosaveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const saveChainRef = useRef<Promise<AppSettings | null>>(Promise.resolve(null))
  const lastPersistedSettingsRef = useRef<string>(JSON.stringify(normalizeSettingsForUi(settings)))
  const localSettingsRef = useRef<AppSettings>(localSettings)
  const [llmModelsRefreshTick, setLlmModelsRefreshTick] = useState(0)
  const {
    llmProvider,
    llmAuthMode,
    llmApiKey,
    llmOpenAICompatibleApiKey,
    llmAnthropicCompatibleApiKey,
    llmOauthToken,
    llmBaseUrl
  } = localSettings

  useEffect(() => {
    const normalizedSettings = normalizeSettingsForUi(settings)
    const serializedSettings = JSON.stringify(normalizedSettings)
    const hasPendingLocalChanges =
      JSON.stringify(normalizeSettingsForUi(localSettingsRef.current)) !== lastPersistedSettingsRef.current

    if (!showSettings || !hasPendingLocalChanges) {
      lastPersistedSettingsRef.current = serializedSettings
      setLocalSettings(normalizedSettings)
    }
  }, [settings, showSettings])

  useEffect(() => {
    localSettingsRef.current = localSettings
  }, [localSettings])

  useEffect(() => {
    setTranscriptionStatus('idle')
    setTranscriptionMessage('')
  }, [
    localSettings.transcriptionProvider,
    localSettings.transcriptionApiKey,
    localSettings.openaiTranscriptionApiKey,
    localSettings.groqTranscriptionApiKey,
    localSettings.groqTranscriptionModel,
    localSettings.transcriptionLanguage,
    localSettings.whisperModel,
    localSettings.assemblyAiSpeechModel,
    localSettings.assemblyAiLanguageDetection,
    localSettings.assemblyAiMinTurnSilence,
    localSettings.assemblyAiMaxTurnSilence,
    localSettings.assemblyAiKeytermsPrompt,
    localSettings.assemblyAiPrompt
  ])

  useEffect(() => {
    if (localSettings.transcriptionProvider === 'groq') {
      if (!localSettings.groqTranscriptionApiKey.trim()) {
        setTranscriptionModels([])
        return
      }
      const loadGroqModels = async (): Promise<void> => {
        try {
          const result = await window.api.listTranscriptionModels({
            apiKey: localSettings.groqTranscriptionApiKey,
            provider: 'groq'
          })
          if (result.success && result.models.length > 0) {
            setTranscriptionModels(result.models.map((m) => m.id))
          } else {
            setTranscriptionModels([])
          }
        } catch {
          setTranscriptionModels([])
        }
      }
      loadGroqModels()
      return
    }
    if (localSettings.transcriptionProvider !== 'openai') return
    if (!localSettings.openaiTranscriptionApiKey.trim()) return

    const loadTranscriptionModels = async (): Promise<void> => {
      try {
        const result = await window.api.listTranscriptionModels({
          apiKey: localSettings.openaiTranscriptionApiKey
        })
        if (result.success && result.models.length > 0) {
          setTranscriptionModels(result.models.map((m) => m.id))
        } else {
          setTranscriptionModels([])
        }
      } catch {
        setTranscriptionModels([])
      }
    }

    loadTranscriptionModels()
  }, [localSettings.transcriptionProvider, localSettings.openaiTranscriptionApiKey, localSettings.groqTranscriptionApiKey])

  useEffect(() => {
    const loadWindowCapabilities = async (): Promise<void> => {
      try {
        const capabilities = await window.api.getWindowCapabilities()
        setWindowCapabilities(capabilities)
      } catch (error) {
        console.error('Failed to load window capabilities:', error)
      }
    }

    loadWindowCapabilities()
  }, [])

  const persistSettings = useCallback(
    async (settingsToPersist: AppSettings): Promise<AppSettings> => {
      const normalizedSettings = normalizeSettingsForUi(settingsToPersist)
      const serializedSettings = JSON.stringify(normalizedSettings)

      if (serializedSettings === lastPersistedSettingsRef.current) {
        return normalizedSettings
      }

      const saveTask = async (): Promise<AppSettings> => {
        try {
          const updatedSettings = normalizeSettingsForUi(
            (await window.api.updateSettings(normalizedSettings)) as AppSettings
          )
          lastPersistedSettingsRef.current = JSON.stringify(updatedSettings)
          setSettings(updatedSettings)
          return updatedSettings
        } catch (err) {
          console.error('Failed to save settings:', err)
          throw err
        }
      }

      const queuedSave = saveChainRef.current.catch(() => null).then(saveTask)
      saveChainRef.current = queuedSave
      return queuedSave
    },
    [setSettings]
  )

  const flushPendingSettingsSave = useCallback(async (): Promise<AppSettings> => {
    if (settingsAutosaveTimeoutRef.current) {
      clearTimeout(settingsAutosaveTimeoutRef.current)
      settingsAutosaveTimeoutRef.current = null
    }

    return persistSettings(localSettingsRef.current)
  }, [persistSettings])

  useEffect(() => {
    if (!showSettings) {
      if (settingsAutosaveTimeoutRef.current) {
        clearTimeout(settingsAutosaveTimeoutRef.current)
        settingsAutosaveTimeoutRef.current = null
      }
      return
    }

    const serializedSettings = JSON.stringify(normalizeSettingsForUi(localSettings))
    if (serializedSettings === lastPersistedSettingsRef.current) {
      return
    }

    settingsAutosaveTimeoutRef.current = setTimeout(() => {
      void persistSettings(localSettingsRef.current)
    }, SETTINGS_AUTOSAVE_DELAY_MS)

    return () => {
      if (settingsAutosaveTimeoutRef.current) {
        clearTimeout(settingsAutosaveTimeoutRef.current)
        settingsAutosaveTimeoutRef.current = null
      }
    }
  }, [localSettings, persistSettings, showSettings])

  useEffect(() => {
    return () => {
      if (settingsAutosaveTimeoutRef.current) {
        clearTimeout(settingsAutosaveTimeoutRef.current)
      }
      if (fetchTimeoutRef.current) {
        clearTimeout(fetchTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (fetchTimeoutRef.current) {
      clearTimeout(fetchTimeoutRef.current)
    }
    setConnectionStatus('idle')
    setConnectionMessage('')

    const provider = llmProvider
    const authMode = llmAuthMode
    const usesOAuth = usesOAuthCredential({
      llmProvider,
      llmAuthMode
    })
    const usesLocalLlama = provider === 'llama.cpp'
    const usesAnthropic = provider === 'anthropic-compatible'
    const credential = resolveLlmCredential({
      llmProvider,
      llmAuthMode,
      llmApiKey,
      llmOpenAICompatibleApiKey,
      llmAnthropicCompatibleApiKey,
      llmOauthToken
    })
    const baseURL = llmBaseUrl.trim()
    if (usesLocalLlama || (usesAnthropic && credential)) {
      setModelsLoading(true)
      setModelsError(null)

      fetchTimeoutRef.current = setTimeout(async () => {
        try {
          const result = await window.api.fetchLlmModels({
            provider,
            authMode,
            apiKey: usesOAuth ? undefined : credential,
            oauthToken: usesOAuth ? credential : undefined,
            baseURL: usesAnthropic ? baseURL : undefined,
            llmModelDir: provider === 'llama.cpp' ? localSettings.llmModelDir : undefined
          })

          if (result.success) {
            setModels(result.models)
            setConnectedModels(result.models.map(m => m.id))
            setModelsError(null)
          } else {
            setModels([])
            setModelsError(result.error || 'Failed to fetch models')
          }
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : 'Failed to fetch models'
          setModels([])
          setModelsError(errorMessage)
        } finally {
          setModelsLoading(false)
        }
      }, 200)

      return () => {
        if (fetchTimeoutRef.current) {
          clearTimeout(fetchTimeoutRef.current)
        }
      }
    }

    if (!credential) {
      setModels([])
      setModelsError(null)
      setModelsLoading(false)
      return
    }

    if (provider === 'openai-compatible' && !baseURL) {
      setModels([])
      setModelsError('Base URL is required for OpenAI compatible provider')
      setModelsLoading(false)
      return
    }

    setModelsLoading(true)
    setModelsError(null)

    fetchTimeoutRef.current = setTimeout(async () => {
      try {
        const result = await window.api.fetchLlmModels({
          apiKey: usesOAuth ? undefined : credential,
          oauthToken: usesOAuth ? credential : undefined,
          provider,
          authMode,
          baseURL: provider === 'openai-compatible' ? baseURL : undefined,
        })

        if (result.success) {
          setModels(result.models)
          setModelsError(null)
        } else {
          setModels([])
          setModelsError(result.error || 'Failed to fetch models')
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to fetch models'
        setModels([])
        setModelsError(errorMessage)
      } finally {
        setModelsLoading(false)
      }
    }, 800)

    return () => {
      if (fetchTimeoutRef.current) {
        clearTimeout(fetchTimeoutRef.current)
      }
    }
  }, [
    llmApiKey,
    llmOpenAICompatibleApiKey,
    llmAnthropicCompatibleApiKey,
    llmOauthToken,
    llmProvider,
    llmAuthMode,
    llmBaseUrl,
    localSettings.llmModelDir,
    llmModelsRefreshTick
  ])

  useEffect(() => {
    if (!showSettings) return

    const refreshModels = (): void => {
      setLlmModelsRefreshTick((value) => value + 1)
    }

    const handleVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') {
        refreshModels()
      }
    }

    window.addEventListener('focus', refreshModels)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.removeEventListener('focus', refreshModels)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [showSettings])

  useEffect(() => {
    if (modelsLoading) {
      return
    }

    const provider = localSettings.llmProvider
    const constrainedModels =
      provider === 'llama.cpp' || usesOAuthCredential(localSettings)

    if (!constrainedModels) {
      return
    }

    const availableModels = models.map((model) => model.id)
    const activeModel = getActiveLlmModel(localSettings)

    if (availableModels.length === 0) {
      if (provider === 'llama.cpp' && activeModel) {
        setLocalSettings(normalizeSettingsForUi(setActiveLlmModel(localSettings, '')))
      }
      return
    }

    if (activeModel && !availableModels.includes(activeModel)) {
      setLocalSettings(normalizeSettingsForUi(setActiveLlmModel(localSettings, '')))
    }
  }, [
    models,
    modelsLoading,
    localSettings.llmProvider,
    localSettings.llmAuthMode,
    localSettings.llmBaseUrl,
    localSettings.llmOpenAIModel,
    localSettings.llmOpenAIOAuthModel,
    localSettings.llmOpenAICompatibleModel,
    localSettings.llmAnthropicCompatibleModel,
    localSettings.llmLlamaCppModel
  ])

  if (!showSettings) return null

  const handleConnectTranscription = async (): Promise<void> => {
    try {
      const currentSettings = await flushPendingSettingsSave()
      const apiKey =
        currentSettings.transcriptionProvider === 'assemblyai'
          ? currentSettings.transcriptionApiKey.trim()
          : currentSettings.transcriptionProvider === 'groq'
            ? currentSettings.groqTranscriptionApiKey.trim()
            : currentSettings.openaiTranscriptionApiKey.trim()

      if (!apiKey) {
        setTranscriptionStatus('error')
        setTranscriptionMessage('Transcription credential is required before connecting.')
        return
      }

      const assemblyAiValidationError = getAssemblyAiPromptValidationError(currentSettings)
      if (assemblyAiValidationError) {
        setTranscriptionStatus('error')
        setTranscriptionMessage(assemblyAiValidationError)
        return
      }

      setTranscriptionStatus('connecting')
      setTranscriptionMessage('')

      const result = await window.api.connectTranscription()

      setTranscriptionStatus(result.success ? 'ok' : 'error')
      setTranscriptionMessage(result.message)
    } catch (err) {
      setTranscriptionStatus('error')
      setTranscriptionMessage(err instanceof Error ? err.message : 'Failed to connect transcription.')
    }
  }

  const handleTestTranscription = async (): Promise<void> => {
    try {
      const currentSettings = await flushPendingSettingsSave()
      const apiKey =
        currentSettings.transcriptionProvider === 'assemblyai'
          ? currentSettings.transcriptionApiKey.trim()
          : currentSettings.transcriptionProvider === 'groq'
            ? currentSettings.groqTranscriptionApiKey.trim()
            : currentSettings.openaiTranscriptionApiKey.trim()

      const assemblyAiValidationError = getAssemblyAiPromptValidationError(currentSettings)

      if (!apiKey) {
        setTranscriptionStatus('error')
        setTranscriptionMessage('Transcription credential is required before testing.')
        return
      }

      if (assemblyAiValidationError) {
        setTranscriptionStatus('error')
        setTranscriptionMessage(assemblyAiValidationError)
        return
      }

      setTranscriptionStatus('testing')
      setTranscriptionMessage('')

      const result = await window.api.testTranscriptionConnection({
        provider: currentSettings.transcriptionProvider,
        apiKey,
        whisperModel:
          currentSettings.transcriptionProvider === 'groq'
            ? currentSettings.groqTranscriptionModel
            : currentSettings.whisperModel,
        language: currentSettings.transcriptionLanguage,
        assemblyAiSpeechModel: currentSettings.assemblyAiSpeechModel,
        assemblyAiLanguageDetection: currentSettings.assemblyAiLanguageDetection,
        assemblyAiMinTurnSilence: currentSettings.assemblyAiMinTurnSilence,
        assemblyAiMaxTurnSilence: currentSettings.assemblyAiMaxTurnSilence,
        assemblyAiKeytermsPrompt: currentSettings.assemblyAiKeytermsPrompt,
        assemblyAiPrompt: currentSettings.assemblyAiPrompt
      })

      setTranscriptionStatus(result.success ? 'ok' : 'error')
      setTranscriptionMessage(result.message)
    } catch (err) {
      setTranscriptionStatus('error')
      setTranscriptionMessage(err instanceof Error ? err.message : 'Transcription test failed.')
    }
  }

  const handleTestConnection = async (): Promise<void> => {
    try {
      const currentSettings = await flushPendingSettingsSave()
      const { provider, authMode, credential, baseURL, usesOAuth } = getLlmFormState(currentSettings)

      if (provider === 'openai-oauth' && oauthStatus === 'ok') {
        setOauthStatus('idle')
        setOauthMessage('')
      }

      if (provider !== 'llama.cpp' && !credential) {
        setConnectionStatus('error')
        setConnectionMessage(
          provider === 'openai-oauth'
            ? 'Connect via browser before testing the OAuth provider.'
            : 'Credential is required before testing the connection.'
        )
        return
      }

      if (provider === 'anthropic-compatible' && !credential) {
        setConnectionStatus('error')
        setConnectionMessage('API Key is required for Anthropic Compatible.')
        return
      }

      if (provider === 'openai-compatible' && !baseURL) {
        setConnectionStatus('error')
        setConnectionMessage('Base URL is required for OpenAI compatible provider.')
        return
      }

      setConnectionStatus('testing')
      setConnectionMessage('')

      const result = await window.api.testProviderConnection({
        apiKey: usesOAuth ? undefined : credential,
        oauthToken: usesOAuth ? credential : undefined,
        provider,
        authMode,
        baseURL:
          provider === 'openai-compatible' || provider === 'anthropic-compatible'
            ? baseURL
            : undefined,
        model: getActiveLlmModel(currentSettings),
        llmModelDir: provider === 'llama.cpp' ? currentSettings.llmModelDir : undefined,
        testKind: 'connect'
      })

      if (result.success) {
        setConnectionStatus('ok')
        setConnectionMessage(result.message)
        if (result.models && result.models.length > 0) {
          setConnectedModels(result.models)
        } else if (provider === 'anthropic-compatible' || provider === 'openai-compatible') {
          const modelsResult = await window.api.fetchLlmModels({
            provider,
            apiKey: credential,
            baseURL:
              provider === 'openai-compatible' || provider === 'anthropic-compatible'
                ? baseURL
                : undefined
          })
          if (modelsResult.success && modelsResult.models.length > 0) {
            setConnectedModels(modelsResult.models.map(m => m.id))
          }
        }
      } else {
        setConnectionStatus('error')
        setConnectionMessage(result.message || 'Connection test failed.')
      }
    } catch (err) {
      setConnectionStatus('error')
      setConnectionMessage(err instanceof Error ? err.message : 'Connection test failed.')
    }
  }

  const handleTestLlm = async (): Promise<void> => {
    try {
      const currentSettings = await flushPendingSettingsSave()
      const { provider, authMode, credential, baseURL, usesOAuth } = getLlmFormState(currentSettings)

      if (provider !== 'llama.cpp' && !credential) {
        setLlmTestStatus('error')
        setConnectionMessage(
          provider === 'openai-oauth'
            ? 'Connect via browser before testing the OAuth provider.'
            : 'Credential is required before testing the LLM.'
        )
        return
      }

      if (provider === 'openai-compatible' && !baseURL) {
        setLlmTestStatus('error')
        setConnectionMessage('Base URL is required for OpenAI compatible provider.')
        return
      }

      setLlmTestStatus('testing')
      setConnectionMessage('')
      const result = await window.api.testProviderConnection({
        apiKey: usesOAuth ? undefined : credential,
        oauthToken: usesOAuth ? credential : undefined,
        provider,
        authMode,
        baseURL:
          provider === 'openai-compatible' || provider === 'anthropic-compatible'
            ? baseURL
            : undefined,
        model: getActiveLlmModel(currentSettings),
        llmModelDir: provider === 'llama.cpp' ? currentSettings.llmModelDir : undefined,
        testKind: 'llm'
      })

      if (result.success) {
        setLlmTestStatus('ok')
        setConnectionMessage('LLM connection working.')
      } else {
        setLlmTestStatus('error')
        setConnectionMessage(result.message || 'Connection test failed.')
      }
    } catch (err) {
      setLlmTestStatus('error')
      setConnectionMessage(err instanceof Error ? err.message : 'Connection test failed.')
    } finally {
      setTimeout(() => {
        setLlmTestStatus((current) => current === 'testing' ? 'idle' : current)
      }, 10000)
    }
  }

  const handleOpacityChange = async (value: number): Promise<void> => {
    if (!windowCapabilities.supportsWindowOpacity) {
      return
    }
    setLocalSettings({ ...localSettings, windowOpacity: value })
    await window.api.setWindowOpacity(value)
  }

  const handleOpenLlmModelFolder = async (): Promise<void> => {
    try {
      const result = await window.api.openLlmModelsFolder()
      if (!result.success) {
        throw new Error(result.error || 'Failed to open GGUF models folder.')
      }

      setLlmModelsRefreshTick((value) => value + 1)
    } catch (err) {
      setConnectionStatus('error')
      setConnectionMessage(
        err instanceof Error ? err.message : 'Failed to open GGUF models folder.'
      )
    }
  }

  const handleClose = async (): Promise<void> => {
    try {
      await flushPendingSettingsSave()
      setShowSettings(false)
    } catch {
      // Keep the modal to saved changes
    }
  }

  const activeLlmModel = getActiveLlmModel(localSettings)
  const hasStoredOAuthSession = Boolean(
    localSettings.llmOauthToken || localSettings.llmOauthRefreshToken
  )
  const usesManualCredentialInput =
    localSettings.llmProvider !== 'openai-oauth' &&
    localSettings.llmProvider !== 'llama.cpp'
  const usesOAuthCredentialForInput = usesOAuthCredential(localSettings)

  const handleConnectOpenAI = async (): Promise<void> => {
    try {
      await flushPendingSettingsSave()
      setModels([])
      setModelsError(null)
      setConnectionStatus('idle')
      setConnectionMessage('')
      setOauthStatus('connecting')
      setOauthMessage('')
      const result = await window.api.connectOpenAIOAuth()
      if (!result.success || !result.settings) {
        setOauthStatus('error')
        setOauthMessage(result.error || 'OpenAI sign-in failed.')
        return
      }

      const nextSettings = normalizeSettingsForUi({
        ...(result.settings as AppSettings),
        llmProvider: 'openai-oauth' as const
      })
      setSettings(nextSettings)
      setLocalSettings(nextSettings)
      setOauthStatus('ok')
      setOauthMessage('OpenAI browser sign-in completed.')
      const modelsResult = await window.api.fetchLlmModels({
        provider: 'openai-oauth',
        oauthToken: result.settings.llmOauthToken
      })
      if (modelsResult.success && modelsResult.models.length > 0) {
        setConnectedModels(modelsResult.models.map(m => m.id))
      }
    } catch (err) {
      setOauthStatus('error')
      setOauthMessage(err instanceof Error ? err.message : 'OpenAI sign-in failed.')
    }
  }

  const handleDisconnectOpenAI = async (): Promise<void> => {
    try {
      await flushPendingSettingsSave()
      setModels([])
      setModelsError(null)
      setConnectedModels([])
      setConnectionStatus('idle')
      setConnectionMessage('')
      const result = await window.api.disconnectOpenAIOAuth()
      if (!result.success || !result.settings) {
        setOauthStatus('error')
        setOauthMessage(result.error || 'Failed to clear OpenAI sign-in.')
        return
      }

      const nextSettings = normalizeSettingsForUi(result.settings as AppSettings)
      setSettings(nextSettings)
      setLocalSettings(nextSettings)
      setOauthStatus('idle')
      setOauthMessage('')
    } catch (err) {
      setOauthStatus('error')
      setOauthMessage(err instanceof Error ? err.message : 'Failed to clear OpenAI sign-in.')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md">
      <div className="settings-modal mx-4 w-full max-w-lg overflow-hidden rounded-[14px] bg-[rgba(7,16,24,0.97)] shadow-2xl animate-fade-in">
        <div className="flex items-center justify-between border-b border-white/5 bg-white/[0.02] px-4 py-3.5">
          <h2 className="settings-modal-title">Settings</h2>
          <button
            onClick={handleClose}
            className="rounded-lg border border-white/5 bg-white/[0.04] p-2 text-dark-400 transition-colors hover:border-cyan-400/15 hover:bg-cyan-400/8 hover:text-dark-200"
          >
            <X size={18} />
          </button>
        </div>

        <div className="settings-stack custom-scrollbar max-h-[32rem] space-y-4 overflow-y-auto px-6 py-4">
          <div className="space-y-2">
            <label className="block text-sm font-medium text-dark-200">
              Transcription Provider
            </label>
            <select
              value={localSettings.transcriptionProvider}
              onChange={(e) =>
                setLocalSettings({
                  ...localSettings,
                  transcriptionProvider: e.target.value as AppSettings['transcriptionProvider']
                })
              }
              className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 focus:outline-none focus:border-blue-500 transition-colors"
            >
              <option value="assemblyai">AssemblyAI</option>
              <option value="openai">OpenAI</option>
              <option value="groq">Groq</option>
            </select>
          </div>

          {localSettings.transcriptionProvider === 'assemblyai' && (
            <>
              <div className="space-y-2">
                <label className="block text-sm font-medium text-dark-200">
                  AssemblyAI API Key
                  <a
                    href="https://www.assemblyai.com/dashboard/signup"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-2 text-xs text-blue-400 hover:underline"
                  >
                    Dashboard →
                  </a>
                </label>
                <div className="relative">
                  <input
                    type={showTranscriptionCredential ? 'text' : 'password'}
                    value={localSettings.transcriptionApiKey}
                    onChange={(e) =>
                      setLocalSettings({ ...localSettings, transcriptionApiKey: e.target.value })
                    }
                    placeholder="Enter your AssemblyAI API key"
                    className="w-full px-3 py-2 pr-10 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 placeholder-dark-500 focus:outline-none focus:border-blue-500 transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowTranscriptionCredential(!showTranscriptionCredential)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-dark-400 hover:text-dark-200"
                  >
                    {showTranscriptionCredential ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-dark-200">
                  AssemblyAI Speech Model
                </label>
                <select
                  value={localSettings.assemblyAiSpeechModel}
                  onChange={(e) =>
                    setLocalSettings(
                      applyAssemblyAiSpeechModel(
                        localSettings,
                        e.target.value as AppSettings['assemblyAiSpeechModel']
                      )
                    )
                  }
                  className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 focus:outline-none focus:border-blue-500 transition-colors"
                >
                  <option value="u3-rt-pro">Universal 3 Pro</option>
                  <option value="universal-streaming-multilingual">
                    Universal Streaming Multilingual
                  </option>
                  <option value="universal-streaming-english">Universal Streaming English</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-dark-200">
                  Language Detection
                </label>
                <select
                  value={localSettings.assemblyAiLanguageDetection ? 'on' : 'off'}
                  disabled={!supportsAssemblyAiLanguageDetection(localSettings.assemblyAiSpeechModel)}
                  onChange={(e) =>
                    setLocalSettings({
                      ...localSettings,
                      assemblyAiLanguageDetection: e.target.value === 'on'
                    })
                  }
                  className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 focus:outline-none focus:border-blue-500 transition-colors disabled:opacity-60"
                >
                  <option value="on">On</option>
                  <option value="off">Off</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-dark-200">
                  Min Turn Silence
                  <span className="ml-2 text-xs text-dark-400">
                    {localSettings.assemblyAiMinTurnSilence}ms
                  </span>
                </label>
                <input
                  type="range"
                  min="80"
                  max="800"
                  step="20"
                  value={localSettings.assemblyAiMinTurnSilence}
                  onChange={(e) =>
                    setLocalSettings({
                      ...localSettings,
                      assemblyAiMinTurnSilence: Number(e.target.value)
                    })
                  }
                  className="w-full accent-blue-500"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-dark-200">
                  Max Turn Silence
                  <span className="ml-2 text-xs text-dark-400">
                    {localSettings.assemblyAiMaxTurnSilence}ms
                  </span>
                </label>
                <input
                  type="range"
                  min="400"
                  max="2500"
                  step="50"
                  value={localSettings.assemblyAiMaxTurnSilence}
                  onChange={(e) =>
                    setLocalSettings({
                      ...localSettings,
                      assemblyAiMaxTurnSilence: Number(e.target.value)
                    })
                  }
                  className="w-full accent-blue-500"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-dark-200">Keyterms Prompt</label>
                <textarea
                  value={localSettings.assemblyAiKeytermsPrompt}
                  onChange={(e) =>
                    setLocalSettings({ ...localSettings, assemblyAiKeytermsPrompt: e.target.value })
                  }
                  rows={4}
                  className="custom-scrollbar-subtle h-28 w-full overflow-y-auto rounded-lg border border-dark-600 bg-dark-800 px-3 py-2 text-sm text-dark-100 placeholder-dark-500 transition-colors focus:border-blue-500 focus:outline-none resize-none"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-dark-200">
                  Streaming Prompt
                </label>
                <textarea
                  value={localSettings.assemblyAiPrompt}
                  onChange={(e) =>
                    setLocalSettings({ ...localSettings, assemblyAiPrompt: e.target.value })
                  }
                  placeholder=""
                  rows={4}
                  className="custom-scrollbar-subtle h-28 w-full overflow-y-auto rounded-lg border border-dark-600 bg-dark-800 px-3 py-2 text-sm text-dark-100 placeholder-dark-500 transition-colors focus:border-blue-500 focus:outline-none resize-none"
                />
              </div>

              <button
                type="button"
                onClick={handleTestTranscription}
                disabled={transcriptionStatus === 'testing'}
                className="settings-action mt-2 w-full px-3 py-2 text-sm transition-colors disabled:opacity-60"
              >
                {transcriptionStatus === 'testing' ? 'Testing STT...' : 'Test STT'}
              </button>
              {transcriptionStatus === 'ok' && (
                <div className="settings-status-ok flex items-center gap-1.5 text-xs">
                  <CheckCircle size={12} />
                  <span>{transcriptionMessage}</span>
                </div>
              )}
              {transcriptionStatus === 'error' && (
                <div className="settings-status-error flex items-center gap-1.5 text-xs">
                  <AlertCircle size={12} />
                  <span>{transcriptionMessage}</span>
                </div>
              )}
            </>
          )}

          {localSettings.transcriptionProvider === 'openai' && (
            <>
              <div className="space-y-2">
                <label className="block text-sm font-medium text-dark-200">
                  OpenAI Transcription API Key
                  <a
                    href="https://platform.openai.com/api-keys"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-2 text-xs text-blue-400 hover:underline"
                  >
                    Dashboard →
                  </a>
                </label>
                <div className="relative">
                  <input
                    type={showTranscriptionCredential ? 'text' : 'password'}
                    value={localSettings.openaiTranscriptionApiKey}
                    onChange={(e) =>
                      setLocalSettings({ ...localSettings, openaiTranscriptionApiKey: e.target.value })
                    }
                    placeholder="Enter your OpenAI API key"
                    className="w-full px-3 py-2 pr-10 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 placeholder-dark-500 focus:outline-none focus:border-blue-500 transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowTranscriptionCredential(!showTranscriptionCredential)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-dark-400 hover:text-dark-200"
                  >
                    {showTranscriptionCredential ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-dark-200">
                  Transcription Language
                </label>
                <select
                  value={localSettings.transcriptionLanguage}
                  onChange={(e) =>
                    setLocalSettings({
                      ...localSettings,
                      transcriptionLanguage: e.target.value as AppSettings['transcriptionLanguage']
                    })
                  }
                  className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 focus:outline-none focus:border-blue-500 transition-colors"
                >
                  <option value="auto">Auto detect</option>
                  <option value="pt">Portuguese</option>
                  <option value="en">English</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-dark-200">Whisper Model</label>
                {transcriptionModels.length > 0 ? (
                  <select
                    value={localSettings.whisperModel}
                    onChange={(e) =>
                      setLocalSettings({
                        ...localSettings,
                        whisperModel: e.target.value
                      })
                    }
                    className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 focus:outline-none focus:border-blue-500 transition-colors"
                  >
                    <option value="">Select a model</option>
                    {transcriptionModels.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={localSettings.whisperModel}
                    onChange={(e) =>
                      setLocalSettings({
                        ...localSettings,
                        whisperModel: e.target.value
                      })
                    }
                    placeholder="Enter model slug"
                    className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 placeholder-dark-500 focus:outline-none focus:border-blue-500 transition-colors"
                  />
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleConnectTranscription}
                  disabled={transcriptionStatus === 'connecting'}
                  className="settings-action px-3 py-2 text-sm transition-colors disabled:opacity-60"
                >
                  {transcriptionStatus === 'connecting' ? 'Connecting...' : 'Connect STT'}
                </button>
                <button
                  type="button"
                  onClick={handleTestTranscription}
                  disabled={transcriptionStatus === 'testing'}
                  className="settings-action px-3 py-2 text-sm transition-colors disabled:opacity-60"
                >
                  {transcriptionStatus === 'testing' ? 'Testing...' : 'Test STT'}
                </button>
              </div>
              {transcriptionStatus === 'ok' && (
                <div className="settings-status-ok flex items-center gap-1.5 text-xs">
                  <CheckCircle size={12} />
                  <span>{transcriptionMessage}</span>
                </div>
              )}
              {transcriptionStatus === 'error' && (
                <div className="settings-status-error flex items-center gap-1.5 text-xs">
                  <AlertCircle size={12} />
                  <span>{transcriptionMessage}</span>
                </div>
              )}
            </>
          )}

          {localSettings.transcriptionProvider === 'groq' && (
            <>
              <div className="space-y-2">
                <label className="block text-sm font-medium text-dark-200">
                  Groq API Key
                  <a
                    href="https://console.groq.com/api-keys"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-2 text-xs text-blue-400 hover:underline"
                  >
                    Console →
                  </a>
                </label>
                <div className="relative">
                  <input
                    type={showTranscriptionCredential ? 'text' : 'password'}
                    value={localSettings.groqTranscriptionApiKey}
                    onChange={(e) =>
                      setLocalSettings({ ...localSettings, groqTranscriptionApiKey: e.target.value })
                    }
                    placeholder="Enter your Groq API key"
                    className="w-full px-3 py-2 pr-10 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 placeholder-dark-500 focus:outline-none focus:border-blue-500 transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowTranscriptionCredential(!showTranscriptionCredential)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-dark-400 hover:text-dark-200"
                  >
                    {showTranscriptionCredential ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-dark-200">
                  Transcription Language
                </label>
                <select
                  value={localSettings.transcriptionLanguage}
                  onChange={(e) =>
                    setLocalSettings({
                      ...localSettings,
                      transcriptionLanguage: e.target.value as AppSettings['transcriptionLanguage']
                    })
                  }
                  className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 focus:outline-none focus:border-blue-500 transition-colors"
                >
                  <option value="auto">Auto detect</option>
                  <option value="en">English</option>
                  <option value="pt">Portuguese</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-dark-200">Whisper Model</label>
                {transcriptionModels.length > 0 ? (
                  <select
                    value={localSettings.groqTranscriptionModel}
                    onChange={(e) =>
                      setLocalSettings({
                        ...localSettings,
                        groqTranscriptionModel: e.target.value
                      })
                    }
                    className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 focus:outline-none focus:border-blue-500 transition-colors"
                  >
                    {transcriptionModels.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={localSettings.groqTranscriptionModel}
                    onChange={(e) =>
                      setLocalSettings({
                        ...localSettings,
                        groqTranscriptionModel: e.target.value
                      })
                    }
                    placeholder="Enter model slug"
                    className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 placeholder-dark-500 focus:outline-none focus:border-blue-500 transition-colors"
                  />
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleConnectTranscription}
                  disabled={transcriptionStatus === 'connecting'}
                  className="settings-action px-3 py-2 text-sm transition-colors disabled:opacity-60"
                >
                  {transcriptionStatus === 'connecting' ? 'Connecting...' : 'Connect STT'}
                </button>
                <button
                  type="button"
                  onClick={handleTestTranscription}
                  disabled={transcriptionStatus === 'testing'}
                  className="settings-action px-3 py-2 text-sm transition-colors disabled:opacity-60"
                >
                  {transcriptionStatus === 'testing' ? 'Testing...' : 'Test STT'}
                </button>
              </div>
              {transcriptionStatus === 'ok' && (
                <div className="settings-status-ok flex items-center gap-1.5 text-xs">
                  <CheckCircle size={12} />
                  <span>{transcriptionMessage}</span>
                </div>
              )}
              {transcriptionStatus === 'error' && (
                <div className="settings-status-error flex items-center gap-1.5 text-xs">
                  <AlertCircle size={12} />
                  <span>{transcriptionMessage}</span>
                </div>
              )}
            </>
          )}

          <SectionDivider label="LLM" />

          <div className="space-y-2">
            <label className="block text-sm font-medium text-dark-200">LLM Provider</label>
            <select
              value={localSettings.llmProvider}
              onChange={(e) => {
                const nextProvider = e.target.value as AppSettings['llmProvider']
                const nextSettings: AppSettings = {
                  ...localSettings,
                  llmProvider: nextProvider,
                  llmAuthMode:
                    nextProvider === 'openai'
                      ? localSettings.llmAuthMode
                      : nextProvider === 'openai-compatible' ||
                          nextProvider === 'anthropic-compatible' ||
                          nextProvider === 'llama.cpp'
                        ? 'api-key'
                        : 'oauth-token'
                }
                setModels([])
                setModelsError(null)
                setConnectedModels([])
                setConnectionStatus('idle')
                setConnectionMessage('')
                setLlmTestStatus('idle')
                setOauthStatus('idle')
                setOauthMessage('')
                setLocalSettings(normalizeSettingsForUi(nextSettings))
              }}
              className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 focus:outline-none focus:border-blue-500 transition-colors"
            >
              <option value="openai">OpenAI</option>
              <option value="openai-oauth">OpenAI OAuth</option>
              <option value="openai-compatible">OpenAI Compatible</option>
              <option value="anthropic-compatible">Anthropic Compatible</option>
              <option value="llama.cpp">GGUF Models</option>
            </select>
          </div>

          {localSettings.llmProvider === 'openai' && (
            <div className="space-y-2">
              <label className="block text-sm font-medium text-dark-200">OpenAI Auth Mode</label>
              <select
                value={localSettings.llmAuthMode}
                onChange={(e) =>
                  setLocalSettings(
                    normalizeSettingsForUi({
                      ...localSettings,
                      llmAuthMode: e.target.value as AppSettings['llmAuthMode']
                    })
                  )
                }
                className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 focus:outline-none focus:border-blue-500 transition-colors"
              >
                <option value="api-key">API Key</option>
                <option value="oauth-token">OAuth Token</option>
              </select>
            </div>
          )}

          {usesManualCredentialInput && (
            <div className="space-y-2">
              <label className="block text-sm font-medium text-dark-200">
                {usesOAuthCredentialForInput ? 'OAuth Token' : 'API Key'}
                {localSettings.llmProvider === 'openai' &&
                  localSettings.llmAuthMode === 'api-key' && (
                    <a
                      href="https://platform.openai.com/api-keys"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-2 text-xs text-blue-400 hover:underline"
                    >
                      Dashboard →
                    </a>
                  )}
              </label>
              <div className="relative">
                <input
                  type={showCredential ? 'text' : 'password'}
                  value={getLlmFormState(localSettings).credential}
                  onChange={(e) => setLocalSettings(setActiveLlmCredential(localSettings, e.target.value))}
                  placeholder={
                    usesOAuthCredentialForInput
                      ? 'Enter your OAuth access token'
                      : 'Enter your API key'
                  }
                  className="w-full px-3 py-2 pr-10 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 placeholder-dark-500 focus:outline-none focus:border-blue-500 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowCredential(!showCredential)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-dark-400 hover:text-dark-200"
                >
                  {showCredential ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
          )}
          {localSettings.llmProvider === 'openai-oauth' && (
            <div className="space-y-2">
              {!hasStoredOAuthSession ? (
                <button
                  type="button"
                  onClick={handleConnectOpenAI}
                  disabled={oauthStatus === 'connecting'}
                  className="settings-action w-full px-3 py-2 text-sm transition-colors disabled:opacity-60"
                >
                  {oauthStatus === 'connecting' ? 'Opening browser...' : 'Connect via browser'}
                </button>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={handleDisconnectOpenAI}
                    className="settings-action px-3 py-2 text-sm transition-colors hover:border-red-400/20 hover:bg-red-500/10 hover:text-red-300"
                  >
                    Disconnect
                  </button>
                  <button
                    type="button"
                    onClick={handleTestLlm}
                    disabled={llmTestStatus === 'testing'}
                    className="settings-action px-3 py-2 text-sm transition-colors disabled:opacity-60"
                  >
                    {llmTestStatus === 'testing' ? 'Testing...' : 'Test LLM'}
                  </button>
                </div>
              )}
              {oauthStatus === 'ok' && (
                <div className="settings-status-ok flex items-center gap-1.5 text-xs">
                  <CheckCircle size={12} />
                  <span>{oauthMessage}</span>
                </div>
              )}
              {oauthStatus === 'error' && (
                <div className="settings-status-error flex items-center gap-1.5 text-xs">
                  <AlertCircle size={12} />
                  <span>{oauthMessage}</span>
                </div>
              )}
              {llmTestStatus === 'ok' && (
                <div className="settings-status-ok flex items-center gap-1.5 text-xs">
                  <CheckCircle size={12} />
                  <span>{connectionMessage || 'LLM test passed.'}</span>
                </div>
              )}
              {llmTestStatus === 'error' && (
                <div className="settings-status-error flex items-center gap-1.5 text-xs">
                  <AlertCircle size={12} />
                  <span>{connectionMessage || 'LLM test failed.'}</span>
                </div>
              )}
            </div>
          )}

          {(localSettings.llmProvider === 'openai-compatible' || localSettings.llmProvider === 'anthropic-compatible') && (
            <>
              <div className="space-y-2">
                <label className="block text-sm font-medium text-dark-200">
                  {localSettings.llmProvider === 'anthropic-compatible' ? 'Anthropic Base URL' : 'OpenAI-Compatible Base URL'}
                </label>
                <input
                  type="text"
                  value={localSettings.llmBaseUrl}
                  onChange={(e) =>
                    setLocalSettings({ ...localSettings, llmBaseUrl: e.target.value })
                  }
                  placeholder="https://api.provider.com/v1"
                  className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 placeholder-dark-500 focus:outline-none focus:border-blue-500 transition-colors"
                />
              </div>

            </>
          )}

          <div className="space-y-2">
            {localSettings.llmProvider === 'openai-oauth' && !hasStoredOAuthSession ? null : (
              <>
                <label className="block text-sm font-medium text-dark-200">
                  Answer Generation Model
                </label>
                <div className="flex gap-2">
                  {modelsLoading ? (
                    <div className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-500 flex items-center">
                      Loading models...
                    </div>
                  ) : modelsError ? (
                    <div className="w-full space-y-2">
                      <input
                        type="text"
                        value={activeLlmModel}
                        onChange={(e) =>
                          setLocalSettings(normalizeSettingsForUi(setActiveLlmModel(localSettings, e.target.value)))
                        }
                        placeholder={
                          localSettings.llmProvider === 'llama.cpp'
                            ? 'Enter GGUF model filename'
                            : 'Enter model slug'
                        }
                        className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 placeholder-dark-500 focus:outline-none focus:border-blue-500 transition-colors"
                      />
                      <div className="settings-status-error flex items-center gap-1.5 text-xs">
                        <AlertCircle size={12} />
                        <span>{modelsError}</span>
                      </div>
                    </div>
                  ) : connectedModels.length > 0 ? (
                    <select
                      value={activeLlmModel}
                      onChange={(e) =>
                        setLocalSettings(normalizeSettingsForUi(setActiveLlmModel(localSettings, e.target.value)))
                      }
                      className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 focus:outline-none focus:border-blue-500 transition-colors"
                    >
                      {connectedModels.map((model) => (
                        <option key={model} value={model}>
                          {model}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={activeLlmModel}
                      onChange={(e) =>
                        setLocalSettings(normalizeSettingsForUi(setActiveLlmModel(localSettings, e.target.value)))
                      }
                      placeholder={
                        localSettings.llmProvider === 'llama.cpp'
                          ? 'Enter GGUF model filename'
                          : 'Enter model slug'
                      }
                      className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 placeholder-dark-500 focus:outline-none focus:border-blue-500 transition-colors"
                    />
                  )}
                  {localSettings.llmProvider === 'llama.cpp' && (
                    <button
                      type="button"
                      onClick={handleOpenLlmModelFolder}
                      className="settings-action flex items-center justify-center px-3 py-2 text-sm transition-colors"
                      title="Open GGUF models folder"
                    >
                      <FolderOpen size={16} />
                    </button>
                  )}
                </div>
              </>
            )}
          </div>

          {localSettings.llmProvider !== 'openai-oauth' && (
            <>
            {localSettings.llmProvider === 'llama.cpp' ? (
              <div className="space-y-1">
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <label className="settings-subtitle block text-[11px]">Temperature</label>
                    <input
                      type="number"
                      min="0"
                      max="2"
                      step="0.05"
                      value={localSettings.llmTemperature ?? 1.0}
                      onChange={(e) =>
                        setLocalSettings({
                          ...localSettings,
                          llmTemperature: parseFloat(e.target.value) || 1.0
                        })
                      }
                      className="w-full rounded-lg border border-dark-600 bg-dark-800 px-3 py-2 text-sm text-dark-100 placeholder-dark-500 transition-colors [appearance:textfield] focus:outline-none focus:border-blue-500 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="settings-subtitle block text-[11px]">Top P</label>
                    <input
                      type="number"
                      min="0"
                      max="1"
                      step="0.05"
                      value={localSettings.llmTopP ?? 0.95}
                      onChange={(e) =>
                        setLocalSettings({
                          ...localSettings,
                          llmTopP: parseFloat(e.target.value) || 0.95
                        })
                      }
                      className="w-full rounded-lg border border-dark-600 bg-dark-800 px-3 py-2 text-sm text-dark-100 placeholder-dark-500 transition-colors [appearance:textfield] focus:outline-none focus:border-blue-500 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="settings-subtitle block text-[11px]">Top K</label>
                    <input
                      type="number"
                      min="1"
                      max="100"
                      step="1"
                      value={localSettings.llmTopK ?? 64}
                      onChange={(e) =>
                        setLocalSettings({
                          ...localSettings,
                          llmTopK: parseInt(e.target.value, 10) || 64
                        })
                      }
                      className="w-full rounded-lg border border-dark-600 bg-dark-800 px-3 py-2 text-sm text-dark-100 placeholder-dark-500 transition-colors [appearance:textfield] focus:outline-none focus:border-blue-500 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    />
                  </div>
                </div>
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={handleTestLlm}
                    disabled={llmTestStatus === 'testing'}
                    className="settings-action mt-6 w-full px-3 py-2 text-sm transition-colors disabled:opacity-60"
                  >
                    {llmTestStatus === 'testing' ? 'Testing...' : 'Test LLM'}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={handleTestConnection}
                    disabled={connectionStatus === 'testing'}
                    className="settings-action px-3 py-2 text-sm transition-colors disabled:opacity-60"
                  >
                    {connectionStatus === 'testing' ? 'Connecting...' : 'Connect'}
                  </button>
                  <button
                    type="button"
                    onClick={handleTestLlm}
                    disabled={llmTestStatus === 'testing'}
                    className="settings-action px-3 py-2 text-sm transition-colors disabled:opacity-60"
                  >
                    {llmTestStatus === 'testing' ? 'Testing...' : 'Test LLM'}
                  </button>
                </div>
                {connectionStatus === 'ok' && (
                  <div className="settings-status-ok flex items-center gap-1.5 text-xs">
                    <CheckCircle size={12} />
                    <span>{connectionMessage}</span>
                  </div>
                )}
                {connectionStatus === 'error' && (
                  <div className="settings-status-error flex items-center gap-1.5 text-xs">
                    <AlertCircle size={12} />
                    <span>{connectionMessage}</span>
                  </div>
                )}
              </>
            )}
              {llmTestStatus === 'ok' && (
                <div className="settings-status-ok flex items-center gap-1.5 text-xs">
                  <CheckCircle size={12} />
                  <span>{connectionMessage || 'LLM test passed.'}</span>
                </div>
              )}
              {llmTestStatus === 'error' && (
                <div className="settings-status-error flex items-center gap-1.5 text-xs">
                  <AlertCircle size={12} />
                  <span>{connectionMessage || 'LLM test failed.'}</span>
                </div>
              )}
            </>
          )}

          {windowCapabilities.platform !== 'linux' && (
            <>
              <SectionDivider label="Window" />

              <div className="space-y-2">
                <label className="block text-sm font-medium text-dark-200">
                  Window Opacity
                  <span className="ml-2 text-xs text-dark-400">
                    {Math.round(localSettings.windowOpacity * 100)}%
                  </span>
                </label>
                {!windowCapabilities.supportsWindowOpacity && (
                  <p className="text-xs text-dark-500">{windowCapabilities.warning}</p>
                )}
                <input
                  type="range"
                  min="0.3"
                  max="1"
                  step="0.05"
                  value={localSettings.windowOpacity}
                  onChange={(e) => handleOpacityChange(Number(e.target.value))}
                  disabled={!windowCapabilities.supportsWindowOpacity}
                  className={`w-full accent-blue-500 ${
                    windowCapabilities.supportsWindowOpacity ? '' : 'opacity-50 cursor-not-allowed'
                  }`}
                />
              </div>
            </>
          )}
        </div>

      </div>
    </div>
  )
}
