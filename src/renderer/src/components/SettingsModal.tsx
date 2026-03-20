import { AlertCircle, CheckCircle, Eye, EyeOff, Loader2, Save, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { AppSettings, useInterviewStore } from '../store/interviewStore'

interface ModelOption {
  id: string
  name: string
}

const AWARENESS_LIMITS = {
  cvSummary: 700,
  jobTitle: 60,
  companyName: 30,
  jobDescription: 1600,
  companyContext: 250
} as const

const normalizeAwarenessText = (value: string): string =>
  value.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

const clampAwarenessField = (
  field: keyof typeof AWARENESS_LIMITS,
  value: string
): string => normalizeAwarenessText(value).slice(0, AWARENESS_LIMITS[field])

const getAwarenessLength = (value: string): number => normalizeAwarenessText(value).length

const OPENAI_OAUTH_MODEL_OPTIONS: ModelOption[] = [
  { id: 'gpt-5.4', name: 'gpt-5.4' },
  { id: 'gpt-5.4-mini', name: 'gpt-5.4-mini' },
  { id: 'gpt-5.3-codex', name: 'gpt-5.3-codex' },
  { id: 'gpt-5.2-codex', name: 'gpt-5.2-codex' },
  { id: 'gpt-5.2', name: 'gpt-5.2' },
  { id: 'gpt-5.1-codex-max', name: 'gpt-5.1-codex-max' },
  { id: 'gpt-5.1-codex-mini', name: 'gpt-5.1-codex-mini' }
]

const getSuggestedModels = (settings: AppSettings): ModelOption[] => {
  if (settings.llmProvider === 'openai-oauth') {
    return OPENAI_OAUTH_MODEL_OPTIONS
  }

  if (settings.llmProvider !== 'openai-compatible') {
    return []
  }

  const baseURL = settings.llmBaseUrl.toLowerCase()
  if (baseURL.includes('deepseek')) {
    return [
      { id: 'deepseek-chat', name: 'deepseek-chat' },
      { id: 'deepseek-reasoner', name: 'deepseek-reasoner' }
    ]
  }

  if (baseURL.includes('minimax')) {
    return [
      { id: 'MiniMax-M2.5', name: 'MiniMax-M2.5' },
      { id: 'MiniMax-Text-01', name: 'MiniMax-Text-01' }
    ]
  }

  if (baseURL.includes('aliyuncs') || baseURL.includes('dashscope')) {
    return [
      { id: 'qwen3.5-plus', name: 'qwen3.5-plus' },
      { id: 'qwen-plus', name: 'qwen-plus' },
      { id: 'qwen-max', name: 'qwen-max' },
      { id: 'qwen3-vl-plus', name: 'qwen3-vl-plus' }
    ]
  }

  return []
}

const getDefaultModelForSettings = (settings: AppSettings): string => {
  const suggestedModels = getSuggestedModels(settings)
  if (suggestedModels.length > 0) {
    return suggestedModels[0].id
  }

  if (settings.llmProvider === 'openai') {
    return 'gpt-4o-mini'
  }

  return ''
}

const normalizeSettingsForUi = (settings: AppSettings): AppSettings => {
  const suggestedModels = getSuggestedModels(settings)
  let llmModel = settings.llmModel

  if (settings.llmProvider === 'openai-oauth') {
    if (!suggestedModels.some((model) => model.id === llmModel)) {
      llmModel = suggestedModels[0]?.id || 'gpt-5.4'
    }
  } else if (
    settings.llmProvider === 'openai-compatible' &&
    OPENAI_OAUTH_MODEL_OPTIONS.some((model) => model.id === llmModel)
  ) {
    llmModel = getDefaultModelForSettings(settings)
  } else if (
    settings.llmProvider === 'openai' &&
    (!llmModel ||
      llmModel.startsWith('deepseek-') ||
      llmModel.startsWith('qwen') ||
      llmModel.startsWith('MiniMax-') ||
      llmModel.startsWith('glm-'))
  ) {
    llmModel = getDefaultModelForSettings(settings)
  }

  return {
    ...settings,
    llmModel
  }
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

    const provider = localSettings.llmProvider
    const authMode = localSettings.llmAuthMode
    const credential =
      provider === 'openai-oauth' || (provider === 'openai' && authMode === 'oauth-token')
        ? localSettings.llmOauthToken?.trim()
        : localSettings.llmApiKey?.trim()
    const baseURL = localSettings.llmBaseUrl?.trim()
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
      setModelsError('Base URL is required for OpenAI-compatible provider')
      setModelsLoading(false)
      return
    }

    setModelsLoading(true)
    setModelsError(null)

    fetchTimeoutRef.current = setTimeout(async () => {
      try {
        const result = await window.api.fetchOpenAIModels({
          apiKey: provider === 'openai' && authMode === 'api-key' ? credential : undefined,
          oauthToken: authMode === 'oauth-token' ? credential : undefined,
          provider,
          authMode,
          baseURL: provider === 'openai-compatible' ? baseURL : undefined,
          customHeaders:
            provider === 'openai-compatible' ? localSettings.llmCustomHeaders : undefined
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
    localSettings.llmApiKey,
    localSettings.llmOauthToken,
    localSettings.llmProvider,
    localSettings.llmAuthMode,
    localSettings.llmBaseUrl,
    localSettings.llmCustomHeaders
  ])

  if (!showSettings) return null

  const handleTestTranscription = async (): Promise<void> => {
    const apiKey =
      localSettings.transcriptionProvider === 'assemblyai'
        ? localSettings.transcriptionApiKey.trim()
        : localSettings.llmApiKey.trim()

    if (!apiKey) {
      setTranscriptionStatus('error')
      setTranscriptionMessage('Transcription credential is required before testing.')
      return
    }

    if (
      localSettings.transcriptionProvider === 'assemblyai' &&
      localSettings.assemblyAiPrompt.trim() &&
      localSettings.assemblyAiKeytermsPrompt.trim()
    ) {
      setTranscriptionStatus('error')
      setTranscriptionMessage('AssemblyAI prompt and keyterms cannot be used together.')
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
    const provider = localSettings.llmProvider
    const authMode = localSettings.llmAuthMode
    const credential =
      provider === 'openai-oauth' || (provider === 'openai' && authMode === 'oauth-token')
        ? localSettings.llmOauthToken?.trim()
        : localSettings.llmApiKey?.trim()
    const baseURL = localSettings.llmBaseUrl?.trim()
    if (!credential) {
      setConnectionStatus('error')
      setConnectionMessage('Credential is required before testing the connection.')
      return
    }

    if (provider === 'openai-compatible' && !baseURL) {
      setConnectionStatus('error')
      setConnectionMessage('Base URL is required for OpenAI-compatible provider.')
      return
    }

    try {
      setConnectionStatus('testing')
      setConnectionMessage('')

      const result = await window.api.testProviderConnection({
        apiKey: provider === 'openai' && authMode === 'api-key' ? credential : undefined,
        oauthToken:
          provider === 'openai-oauth' || authMode === 'oauth-token' ? credential : undefined,
        provider,
        authMode,
        baseURL: provider === 'openai-compatible' ? baseURL : undefined,
        customHeaders:
          provider === 'openai-compatible' ? localSettings.llmCustomHeaders : undefined,
        model: localSettings.llmModel
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
      if (
        localSettings.transcriptionProvider === 'assemblyai' &&
        localSettings.assemblyAiPrompt.trim() &&
        localSettings.assemblyAiKeytermsPrompt.trim()
      ) {
        setSaveStatus('error')
        setTranscriptionStatus('error')
        setTranscriptionMessage('AssemblyAI prompt and keyterms cannot be used together.')
        setTimeout(() => setSaveStatus('idle'), 3000)
        return
      }

      setSaveStatus('saving')
      const updatedSettings = await window.api.updateSettings(normalizeSettingsForUi(localSettings))
      setSettings(updatedSettings as AppSettings)
      setSaveStatus('saved')
      setTimeout(() => {
        setSaveStatus('idle')
        setShowSettings(false)
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

  const handleClose = (): void => {
    setLocalSettings(normalizeSettingsForUi(settings))
    setShowSettings(false)
  }

  const suggestedModels = getSuggestedModels(localSettings)
  const hasStoredOAuthSession = Boolean(
    localSettings.llmOauthToken || localSettings.llmOauthRefreshToken
  )

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
        llmProvider: 'openai-oauth' as const,
        llmModel: result.settings.llmModel || 'gpt-5.4'
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
          <h2 className="text-base font-medium text-dark-100">Settings</h2>
          <button
            onClick={handleClose}
            className="rounded-lg border border-white/5 bg-white/[0.04] p-2 text-dark-400 transition-colors hover:border-cyan-400/15 hover:bg-cyan-400/8 hover:text-dark-200"
          >
            <X size={18} />
          </button>
        </div>

        <div className="settings-stack custom-scrollbar max-h-[32rem] space-y-4 overflow-y-auto px-6 py-4">
          <div className="space-y-2">
            <label className="block text-sm font-medium text-dark-200">Transcription Provider</label>
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
                <label className="block text-sm font-medium text-dark-200">AssemblyAI Speech Model</label>
                <select
                  value={localSettings.assemblyAiSpeechModel}
                  onChange={(e) =>
                    setLocalSettings({
                      ...localSettings,
                      assemblyAiSpeechModel: e.target.value as AppSettings['assemblyAiSpeechModel']
                    })
                  }
                  className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 focus:outline-none focus:border-blue-500 transition-colors"
                >
                  <option value="universal-streaming-multilingual">Universal Streaming Multilingual</option>
                  <option value="universal-streaming-english">Universal Streaming English</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-dark-200">Language Detection</label>
                <select
                  value={localSettings.assemblyAiLanguageDetection ? 'on' : 'off'}
                  onChange={(e) =>
                    setLocalSettings({
                      ...localSettings,
                      assemblyAiLanguageDetection: e.target.value === 'on'
                    })
                  }
                  className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 focus:outline-none focus:border-blue-500 transition-colors"
                >
                  <option value="on">On</option>
                  <option value="off">Off</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-dark-200">
                  Min Turn Silence
                  <span className="ml-2 text-xs text-dark-400">{localSettings.assemblyAiMinTurnSilence}ms</span>
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
                  <span className="ml-2 text-xs text-dark-400">{localSettings.assemblyAiMaxTurnSilence}ms</span>
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
                  placeholder="Metoprolol, Dextroamphetamine, Toyota, Abercrombie and Fitch"
                  rows={3}
                  className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 placeholder-dark-500 focus:outline-none focus:border-blue-500 transition-colors resize-y"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-dark-200">Streaming Prompt</label>
                <textarea
                  value={localSettings.assemblyAiPrompt}
                  onChange={(e) =>
                    setLocalSettings({ ...localSettings, assemblyAiPrompt: e.target.value })
                  }
                  placeholder={'Transcribe verbatim.\nAlways include punctuation in output.\nUse period/question mark only for complete sentences.'}
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

          <div className="space-y-2">
            <label className="block text-sm font-medium text-dark-200">LLM Provider</label>
            <select
              value={localSettings.llmProvider}
              onChange={(e) => {
                const nextProvider = e.target.value as AppSettings['llmProvider']
                const nextSettings: AppSettings = {
                  ...localSettings,
                  llmProvider: nextProvider,
                  llmAuthMode: nextProvider === 'openai' ? localSettings.llmAuthMode : 'oauth-token'
                }

                nextSettings.llmModel = getDefaultModelForSettings(nextSettings)
                setModels([])
                setModelsError(null)
                setConnectionStatus('idle')
                setConnectionMessage('')
                setOauthStatus('idle')
                setOauthMessage('')
                setLocalSettings(normalizeSettingsForUi(nextSettings))
              }}
              className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 focus:outline-none focus:border-blue-500 transition-colors"
            >
              <option value="openai">OpenAI</option>
              <option value="openai-oauth">OpenAI OAuth</option>
              <option value="openai-compatible">OpenAI-Compatible</option>
            </select>
          </div>

          <div className="space-y-2">
            {localSettings.llmProvider === 'openai' && (
              <div className="space-y-2">
                <label className="block text-sm font-medium text-dark-200">OpenAI Auth Mode</label>
                <select
                  value={localSettings.llmAuthMode}
                  onChange={(e) =>
                    setLocalSettings({
                      ...localSettings,
                      llmAuthMode: e.target.value as AppSettings['llmAuthMode']
                    })
                  }
                  className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 focus:outline-none focus:border-blue-500 transition-colors"
                >
                  <option value="api-key">API Key</option>
                  <option value="oauth-token">OAuth Token</option>
                </select>
              </div>
            )}

            <label className="block text-sm font-medium text-dark-200">
              {localSettings.llmProvider === 'openai-oauth' ||
              (localSettings.llmProvider === 'openai' &&
                localSettings.llmAuthMode === 'oauth-token')
                ? 'OAuth Token'
                : 'API Key'}
              {localSettings.llmProvider === 'openai' && localSettings.llmAuthMode === 'api-key' && (
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
            {localSettings.llmProvider === 'openai-oauth' && (
              <div className="space-y-2">
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
            <div className="relative">
              <input
                type={showCredential ? 'text' : 'password'}
                value={
                  localSettings.llmProvider === 'openai-oauth' ||
                  (localSettings.llmProvider === 'openai' &&
                    localSettings.llmAuthMode === 'oauth-token')
                    ? localSettings.llmOauthToken
                    : localSettings.llmApiKey
                }
                onChange={(e) =>
                  setLocalSettings(
                    localSettings.llmProvider === 'openai-oauth' ||
                      (localSettings.llmProvider === 'openai' &&
                        localSettings.llmAuthMode === 'oauth-token')
                      ? { ...localSettings, llmOauthToken: e.target.value }
                      : { ...localSettings, llmApiKey: e.target.value }
                  )
                }
                placeholder={
                  localSettings.llmProvider === 'openai-oauth' ||
                  (localSettings.llmProvider === 'openai' &&
                    localSettings.llmAuthMode === 'oauth-token')
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
            <button
              type="button"
              onClick={handleTestConnection}
              disabled={connectionStatus === 'testing'}
              className="settings-action mt-2 w-full px-3 py-2 text-sm transition-colors disabled:opacity-60"
            >
              {connectionStatus === 'testing' ? 'Testing LLM...' : 'Test LLM'}
            </button>
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

          {localSettings.llmProvider === 'openai-compatible' && (
            <>
              <div className="space-y-2">
                <label className="block text-sm font-medium text-dark-200">
                  OpenAI-Compatible Base URL
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

          <div className="space-y-2">
            <label className="block text-sm font-medium text-dark-200">Answer Generation Model</label>
            <input
              type="text"
              value={localSettings.llmModel}
              onChange={(e) => setLocalSettings({ ...localSettings, llmModel: e.target.value })}
              placeholder="e.g. deepseek-chat, qwen-max, glm-4"
              className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 placeholder-dark-500 focus:outline-none focus:border-blue-500 transition-colors"
            />
            {suggestedModels.length > 0 && (
              <select
                value=""
                onChange={(e) => {
                  if (e.target.value) {
                    setLocalSettings({ ...localSettings, llmModel: e.target.value })
                  }
                }}
                className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 focus:outline-none focus:border-blue-500 transition-colors"
              >
                <option value="">Suggested models</option>
                {suggestedModels.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name}
                  </option>
                ))}
              </select>
            )}
            {modelsLoading && (
              <div className="flex items-center gap-2 text-xs text-dark-400">
                <Loader2 size={14} className="animate-spin text-blue-400" />
                <span>Loading models...</span>
              </div>
            )}
            {models.length > 0 && (
              <select
                value=""
                onChange={(e) => {
                  if (e.target.value) {
                    setLocalSettings({ ...localSettings, llmModel: e.target.value })
                  }
                }}
                className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 focus:outline-none focus:border-blue-500 transition-colors"
              >
                <option value="">Quick pick from provider models (optional)</option>
                {models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name}
                  </option>
                ))}
              </select>
            )}
            {modelsError && (
              <div className="settings-status-error flex items-center gap-1.5 text-xs">
                <AlertCircle size={12} />
                <span>{modelsError}</span>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <label className="block text-sm font-medium text-dark-200">CV Summary</label>
              <span className="text-xs text-dark-400">
                {getAwarenessLength(localSettings.cvSummary)}/{AWARENESS_LIMITS.cvSummary}
              </span>
            </div>
            <textarea
              value={localSettings.cvSummary}
              onChange={(e) =>
                setLocalSettings({
                  ...localSettings,
                  cvSummary: clampAwarenessField('cvSummary', e.target.value)
                })
              }
              maxLength={AWARENESS_LIMITS.cvSummary}
              placeholder="Summarize your background, strengths, and relevant experience..."
              rows={5}
              className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 placeholder-dark-500 focus:outline-none focus:border-blue-500 transition-colors resize-y"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <label className="block text-sm font-medium text-dark-200">Role / Position</label>
              <span className="text-xs text-dark-400">
                {getAwarenessLength(localSettings.jobTitle)}/{AWARENESS_LIMITS.jobTitle}
              </span>
            </div>
            <input
              type="text"
              value={localSettings.jobTitle}
              onChange={(e) =>
                setLocalSettings({
                  ...localSettings,
                  jobTitle: clampAwarenessField('jobTitle', e.target.value)
                })
              }
              maxLength={AWARENESS_LIMITS.jobTitle}
              placeholder="e.g. Senior Backend Engineer"
              className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 placeholder-dark-500 focus:outline-none focus:border-blue-500 transition-colors"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <label className="block text-sm font-medium text-dark-200">Company</label>
              <span className="text-xs text-dark-400">
                {getAwarenessLength(localSettings.companyName)}/{AWARENESS_LIMITS.companyName}
              </span>
            </div>
            <input
              type="text"
              value={localSettings.companyName}
              onChange={(e) =>
                setLocalSettings({
                  ...localSettings,
                  companyName: clampAwarenessField('companyName', e.target.value)
                })
              }
              maxLength={AWARENESS_LIMITS.companyName}
              placeholder="Company name"
              className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 placeholder-dark-500 focus:outline-none focus:border-blue-500 transition-colors"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <label className="block text-sm font-medium text-dark-200">Job Description</label>
              <span className="text-xs text-dark-400">
                {getAwarenessLength(localSettings.jobDescription)}/{AWARENESS_LIMITS.jobDescription}
              </span>
            </div>
            <textarea
              value={localSettings.jobDescription}
              onChange={(e) =>
                setLocalSettings({
                  ...localSettings,
                  jobDescription: clampAwarenessField('jobDescription', e.target.value)
                })
              }
              maxLength={AWARENESS_LIMITS.jobDescription}
              placeholder="Paste the job description or the main requirements..."
              rows={6}
              className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 placeholder-dark-500 focus:outline-none focus:border-blue-500 transition-colors resize-y"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <label className="block text-sm font-medium text-dark-200">Company Context</label>
              <span className="text-xs text-dark-400">
                {getAwarenessLength(localSettings.companyContext)}/{AWARENESS_LIMITS.companyContext}
              </span>
            </div>
            <textarea
              value={localSettings.companyContext}
              onChange={(e) =>
                setLocalSettings({
                  ...localSettings,
                  companyContext: clampAwarenessField('companyContext', e.target.value)
                })
              }
              maxLength={AWARENESS_LIMITS.companyContext}
              placeholder="Add product, market, team, stack, culture, or other company details..."
              rows={5}
              className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 placeholder-dark-500 focus:outline-none focus:border-blue-500 transition-colors resize-y"
            />
          </div>

          {localSettings.transcriptionProvider !== 'assemblyai' && (
            <>
              <div className="space-y-2">
                <label className="block text-sm font-medium text-dark-200">Transcription Language</label>
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
                  <span className="ml-2 text-xs text-dark-400">{localSettings.pauseThreshold}ms</span>
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
              onClick={handleClose}
              className="rounded-lg border border-white/5 bg-white/[0.04] px-4 py-2 text-sm font-medium text-dark-300 transition-colors hover:border-cyan-400/15 hover:bg-cyan-400/8 hover:text-dark-100"
            >
              Cancel
            </button>
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
