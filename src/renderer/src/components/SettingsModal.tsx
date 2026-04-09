import { AlertCircle, CheckCircle, Eye, EyeOff, FolderOpen, Loader2, Save, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { AppSettings, useInterviewStore } from '../store/interviewStore'
import {
  getActiveLlmModel,
  getSuggestedLlmModels,
  normalizeLlmSettings,
  resolveLlmCredential,
  setActiveLlmModel,
  usesOAuthCredential
} from '../../../shared/llmSettings'

interface ModelOption {
  id: string
  name: string
}

interface LlmFormState {
  provider: AppSettings['llmProvider']
  authMode: AppSettings['llmAuthMode']
  usesOAuth: boolean
  credential: string
  baseURL: string
}

const toModelOptions = (modelIds: string[]): ModelOption[] =>
  modelIds.map((id) => ({ id, name: id }))

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

const getAssemblyAiTurnSilenceDefaults = (
  speechModel: AppSettings['assemblyAiSpeechModel']
): { minTurnSilence: number; maxTurnSilence: number } => {
  if (speechModel === 'u3-rt-pro') {
    return { minTurnSilence: 100, maxTurnSilence: 1000 }
  }

  return { minTurnSilence: 400, maxTurnSilence: 1280 }
}

const getAssemblyAiLanguageDetectionDefault = (
  speechModel: AppSettings['assemblyAiSpeechModel']
): boolean => {
  return speechModel === 'universal-streaming-multilingual'
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
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [models, setModels] = useState<ModelOption[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [transcriptionStatus, setTranscriptionStatus] = useState<
    'idle' | 'testing' | 'ok' | 'error'
  >('idle')
  const [transcriptionMessage, setTranscriptionMessage] = useState<string>('')
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>(
    'idle'
  )
  const [connectionMessage, setConnectionMessage] = useState<string>('')
  const [oauthStatus, setOauthStatus] = useState<'idle' | 'connecting' | 'ok' | 'error'>('idle')
  const [oauthMessage, setOauthMessage] = useState<string>('')
  const [windowCapabilities, setWindowCapabilities] = useState({
    isWayland: false,
    supportsAlwaysOnTop: true,
    supportsWindowOpacity: true,
    warning: ''
  })
  const fetchTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const {
    llmProvider,
    llmAuthMode,
    llmApiKey,
    llmOpenAICompatibleApiKey,
    llmAnthropicCompatibleApiKey,
    llmOauthToken,
    llmBaseUrl,
    llmCustomHeaders
  } = localSettings

  useEffect(() => {
    setLocalSettings(normalizeSettingsForUi(settings))
  }, [settings, showSettings])

  useEffect(() => {
    setTranscriptionStatus('idle')
    setTranscriptionMessage('')
  }, [
    localSettings.transcriptionProvider,
    localSettings.transcriptionApiKey,
    localSettings.transcriptionLanguage,
    localSettings.assemblyAiSpeechModel,
    localSettings.assemblyAiLanguageDetection,
    localSettings.assemblyAiMinTurnSilence,
    localSettings.assemblyAiMaxTurnSilence,
    localSettings.assemblyAiKeytermsPrompt,
    localSettings.assemblyAiPrompt
  ])

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
    if (usesLocalLlama || usesAnthropic) {
      setModelsLoading(true)
      setModelsError(null)

      fetchTimeoutRef.current = setTimeout(async () => {
        try {
          const result = await window.api.fetchLlmModels({
            provider,
            authMode,
            llmModelDir: provider === 'llama.cpp' ? localSettings.llmModelDir : undefined
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

    if (provider === 'openai-oauth') {
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
          customHeaders: provider === 'openai-compatible' ? llmCustomHeaders : undefined
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
    llmCustomHeaders,
    localSettings.llmModelDir
  ])

  useEffect(() => {
    if (modelsLoading) {
      return
    }

    const provider = localSettings.llmProvider
    const constrainedModels =
      provider === 'llama.cpp' ||
      provider === 'anthropic-compatible' ||
      usesOAuthCredential(localSettings)

    if (!constrainedModels) {
      return
    }

    const availableModels = (models.length > 0
      ? models
      : toModelOptions(getSuggestedLlmModels(localSettings))
    ).map((model) => model.id)
    const activeModel = getActiveLlmModel(localSettings)

    if (availableModels.length === 0) {
      if (provider === 'llama.cpp' && activeModel) {
        setLocalSettings(normalizeSettingsForUi(setActiveLlmModel(localSettings, '')))
      }
      return
    }

    if (!activeModel || !availableModels.includes(activeModel)) {
      setLocalSettings(normalizeSettingsForUi(setActiveLlmModel(localSettings, availableModels[0])))
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

  const handleTestTranscription = async (): Promise<void> => {
    const apiKey =
      localSettings.transcriptionProvider === 'assemblyai'
        ? localSettings.transcriptionApiKey.trim()
        : localSettings.llmApiKey.trim()

    const assemblyAiValidationError = getAssemblyAiPromptValidationError(localSettings)

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

    try {
      setTranscriptionStatus('testing')
      setTranscriptionMessage('')

      const result = await window.api.testTranscriptionConnection({
        provider: localSettings.transcriptionProvider,
        apiKey,
        language: localSettings.transcriptionLanguage,
        assemblyAiSpeechModel: localSettings.assemblyAiSpeechModel,
        assemblyAiLanguageDetection: localSettings.assemblyAiLanguageDetection,
        assemblyAiMinTurnSilence: localSettings.assemblyAiMinTurnSilence,
        assemblyAiMaxTurnSilence: localSettings.assemblyAiMaxTurnSilence,
        assemblyAiKeytermsPrompt: localSettings.assemblyAiKeytermsPrompt,
        assemblyAiPrompt: localSettings.assemblyAiPrompt
      })

      setTranscriptionStatus(result.success ? 'ok' : 'error')
      setTranscriptionMessage(result.message)
    } catch (err) {
      setTranscriptionStatus('error')
      setTranscriptionMessage(err instanceof Error ? err.message : 'Transcription test failed.')
    }
  }

  const handleTestConnection = async (): Promise<void> => {
    const { provider, authMode, credential, baseURL, usesOAuth } = getLlmFormState(localSettings)

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

    try {
      setConnectionStatus('testing')
      setConnectionMessage('')

      const result = await window.api.testProviderConnection({
        apiKey: usesOAuth ? undefined : credential,
        oauthToken: usesOAuth ? credential : undefined,
        provider,
        authMode,
        baseURL: provider === 'openai-compatible' ? baseURL : undefined,
        customHeaders:
          provider === 'openai-compatible' ? localSettings.llmCustomHeaders : undefined,
        model: getActiveLlmModel(localSettings),
        llmModelDir: provider === 'llama.cpp' ? localSettings.llmModelDir : undefined,
        llamaBinDir: provider === 'llama.cpp' ? localSettings.llamaBinDir : undefined
      })

      if (result.success) {
        setConnectionStatus('ok')
        setConnectionMessage(result.message)
      } else {
        setConnectionStatus('error')
        setConnectionMessage(result.message || 'Connection test failed.')
      }
    } catch (err) {
      setConnectionStatus('error')
      setConnectionMessage(err instanceof Error ? err.message : 'Connection test failed.')
    }
  }

  const handleSave = async (): Promise<void> => {
    try {
      const assemblyAiValidationError = getAssemblyAiPromptValidationError(localSettings)
      if (assemblyAiValidationError) {
        setSaveStatus('error')
        setTranscriptionStatus('error')
        setTranscriptionMessage(assemblyAiValidationError)
        setTimeout(() => setSaveStatus('idle'), 3000)
        return
      }

      setSaveStatus('saving')
      const updatedSettings = await window.api.updateSettings(normalizeSettingsForUi(localSettings))
      setSettings(updatedSettings as AppSettings)
      setSaveStatus('saved')
      setTimeout(() => {
        setSaveStatus('idle')
      }, 1000)
    } catch (err) {
      console.error('Failed to save settings:', err)
      setSaveStatus('error')
      setTimeout(() => setSaveStatus('idle'), 3000)
    }
  }

  const handleOpacityChange = async (value: number): Promise<void> => {
    if (!windowCapabilities.supportsWindowOpacity) {
      return
    }
    setLocalSettings({ ...localSettings, windowOpacity: value })
    await window.api.setWindowOpacity(value)
  }

  const handleChooseLlamaBinFolder = async (): Promise<void> => {
    try {
      const result = await window.api.selectLlamaBinDir(localSettings.llamaBinDir)
      if (result.success && result.directory) {
        setLocalSettings({ ...localSettings, llamaBinDir: result.directory })
        setConnectionStatus('idle')
        setConnectionMessage('')
      }
    } catch (err) {
      setConnectionStatus('error')
      setConnectionMessage(
        err instanceof Error ? err.message : 'Failed to choose llama.cpp binaries folder.'
      )
    }
  }

  const handleChooseLlmModelFolder = async (): Promise<void> => {
    try {
      const result = await window.api.selectLlmModelDir(localSettings.llmModelDir)
      if (result.success && result.directory) {
        const nextSettings =
          localSettings.llmProvider === 'llama.cpp'
            ? normalizeSettingsForUi(
                setActiveLlmModel(
                  {
                    ...localSettings,
                    llmModelDir: result.directory
                  },
                  ''
                )
              )
            : { ...localSettings, llmModelDir: result.directory }

        setLocalSettings(nextSettings)
        setConnectionStatus('idle')
        setConnectionMessage('')
      }
    } catch (err) {
      setConnectionStatus('error')
      setConnectionMessage(
        err instanceof Error ? err.message : 'Failed to choose GGUF models folder.'
      )
    }
  }

  const handleClose = (): void => {
    setLocalSettings(normalizeSettingsForUi(settings))
    setShowSettings(false)
  }

  const suggestedModels = toModelOptions(getSuggestedLlmModels(localSettings))
  const activeLlmModel = getActiveLlmModel(localSettings)
  const hasStoredOAuthSession = Boolean(
    localSettings.llmOauthToken || localSettings.llmOauthRefreshToken
  )
  const providerModelOptions = models.length > 0 ? models : suggestedModels
  const answerModelOptions = Array.from(
    new Map(
      [
        ...(activeLlmModel
          ? [{ id: activeLlmModel, name: activeLlmModel }]
          : []),
        ...providerModelOptions
      ].map((model) => [model.id, model] as const)
    ).values()
  )
  const usesManualCredentialInput =
    localSettings.llmProvider !== 'openai-oauth' &&
    localSettings.llmProvider !== 'llama.cpp'
  const usesOAuthCredentialForInput = usesOAuthCredential(localSettings)

  const handleConnectOpenAI = async (): Promise<void> => {
    try {
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
    } catch (err) {
      setOauthStatus('error')
      setOauthMessage(err instanceof Error ? err.message : 'OpenAI sign-in failed.')
    }
  }

  const handleDisconnectOpenAI = async (): Promise<void> => {
    try {
      setModels([])
      setModelsError(null)
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
                  placeholder={'Metoprolol\nDextroamphetamine\nToyota\nAbercrombie and Fitch'}
                  rows={4}
                  className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 placeholder-dark-500 focus:outline-none focus:border-blue-500 transition-colors resize-y"
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
                  className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 placeholder-dark-500 focus:outline-none focus:border-blue-500 transition-colors resize-y"
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

          <SectionDivider label="LLM" />

          <div className="space-y-2">
            <label className="block text-sm font-medium text-dark-200">LLM Provider</label>
            <select
              value={localSettings.llmProvider}
              onChange={(e) => {
                const nextProvider = e.target.value as AppSettings['llmProvider']
                const nextSettings = normalizeSettingsForUi({
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
                })
                setModels([])
                setModelsError(null)
                setConnectionStatus('idle')
                setConnectionMessage('')
                setOauthStatus('idle')
                setOauthMessage('')
                setLocalSettings(nextSettings)
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

          <div className="space-y-2">
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
              <>
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
              </>
            )}
            {localSettings.llmProvider === 'openai-oauth' && (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div className="w-full">
                    {oauthStatus === 'connecting' ? (
                      <button
                        type="button"
                        disabled
                        className="settings-action w-full px-3 py-2 text-sm disabled:opacity-60"
                      >
                        Opening browser...
                      </button>
                    ) : hasStoredOAuthSession ? (
                      <button
                        type="button"
                        onClick={handleDisconnectOpenAI}
                        className="settings-action w-full px-3 py-2 text-sm transition-colors hover:border-red-400/20 hover:bg-red-500/10 hover:text-red-300"
                      >
                        Disconnect
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={handleConnectOpenAI}
                        className="settings-action w-full px-3 py-2 text-sm transition-colors"
                      >
                        Connect via browser
                      </button>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={handleTestConnection}
                    disabled={connectionStatus === 'testing'}
                    className="settings-action w-full px-3 py-2 text-sm transition-colors disabled:opacity-60"
                  >
                    {connectionStatus === 'testing' ? 'Testing LLM...' : 'Test LLM'}
                  </button>
                </div>
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
              </div>
            )}
            {localSettings.llmProvider !== 'openai-oauth' && (
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={connectionStatus === 'testing'}
                className="settings-action mt-2 w-full px-3 py-2 text-sm transition-colors disabled:opacity-60"
              >
                {connectionStatus === 'testing' ? 'Testing LLM...' : 'Test LLM'}
              </button>
            )}
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
          </div>

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

              <div className="space-y-2">
                <label className="block text-sm font-medium text-dark-200">
                  Custom Headers (optional)
                </label>
                <input
                  type="text"
                  value={localSettings.llmCustomHeaders}
                  onChange={(e) =>
                    setLocalSettings({ ...localSettings, llmCustomHeaders: e.target.value })
                  }
                  placeholder="Header1:Value1,Header2:Value2"
                  className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 placeholder-dark-500 focus:outline-none focus:border-blue-500 transition-colors"
                />
              </div>
            </>
          )}

          {localSettings.llmProvider === 'llama.cpp' && (
            <>
              <div className="space-y-2">
                <label className="block text-sm font-medium text-dark-200">
                  Llama.cpp Binaries Folder
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    readOnly
                    value={localSettings.llamaBinDir || 'Default'}
                    className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 placeholder-dark-500 focus:outline-none focus:border-blue-500 transition-colors"
                    placeholder="Default"
                  />
                  <button
                    type="button"
                    onClick={handleChooseLlamaBinFolder}
                    className="settings-action flex items-center justify-center px-3 py-2 text-sm transition-colors"
                    title="Choose binaries folder"
                  >
                    <FolderOpen size={16} />
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-dark-200">GGUF Models Folder</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    readOnly
                    value={localSettings.llmModelDir || 'Default'}
                    className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 placeholder-dark-500 focus:outline-none focus:border-blue-500 transition-colors"
                    placeholder="Default"
                  />
                  <button
                    type="button"
                    onClick={handleChooseLlmModelFolder}
                    className="settings-action flex items-center justify-center px-3 py-2 text-sm transition-colors"
                    title="Choose GGUF models folder"
                  >
                    <FolderOpen size={16} />
                  </button>
                </div>
              </div>
            </>
          )}

          <div className="space-y-2">
            <label className="block text-sm font-medium text-dark-200">
              Answer Generation Model
            </label>
            <select
              value={activeLlmModel}
              onChange={(e) =>
                setLocalSettings(normalizeSettingsForUi(setActiveLlmModel(localSettings, e.target.value)))
              }
              disabled={answerModelOptions.length === 0}
              className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 focus:outline-none focus:border-blue-500 transition-colors disabled:opacity-60"
            >
              {answerModelOptions.length > 0 ? (
                answerModelOptions.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name}
                  </option>
                ))
              ) : (
                <option value="">No models available</option>
              )}
            </select>
            {modelsLoading && (
              <div className="flex items-center gap-2 text-xs text-dark-400">
                <Loader2 size={14} className="animate-spin text-blue-400" />
                <span>Loading models...</span>
              </div>
            )}
            {modelsError && (
              <div className="settings-status-error flex items-center gap-1.5 text-xs">
                <AlertCircle size={12} />
                <span>{modelsError}</span>
              </div>
            )}
          </div>

          {localSettings.transcriptionProvider !== 'assemblyai' && (
            <>
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
                <label className="block text-sm font-medium text-dark-200">
                  Silence Detection
                  <span className="ml-2 text-xs text-dark-400">
                    {localSettings.pauseThreshold}ms
                  </span>
                </label>
                <input
                  type="range"
                  min="500"
                  max="3000"
                  step="100"
                  value={localSettings.pauseThreshold}
                  onChange={(e) =>
                    setLocalSettings({ ...localSettings, pauseThreshold: Number(e.target.value) })
                  }
                  className="w-full accent-blue-500"
                />
              </div>
            </>
          )}

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
        </div>

        <div className="flex items-center justify-between border-t border-white/5 px-4 py-3.5">
          <div className="flex items-center gap-3">
            {saveStatus === 'error' && (
              <div className="flex items-center gap-2 text-sm text-red-400">
                <AlertCircle size={16} />
                <span>Failed to save</span>
              </div>
            )}
            {saveStatus === 'saved' && (
              <div className="flex items-center gap-2 text-sm text-green-400">
                <CheckCircle size={16} />
                <span>Saved!</span>
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={saveStatus === 'saving'}
              className="flex items-center gap-2 rounded-lg border border-cyan-400/25 bg-gradient-to-r from-cyan-400 to-teal-400 px-4 py-2 text-sm font-medium text-slate-950 transition-colors hover:from-cyan-300 hover:to-teal-300 disabled:opacity-50"
            >
              <Save size={16} />
              <span>{saveStatus === 'saving' ? 'Saving...' : 'Save'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
