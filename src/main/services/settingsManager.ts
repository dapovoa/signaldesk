import { config } from 'dotenv'
import { app, safeStorage } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { getDefaultOutputTokens, isDeepSeekModelConfig } from './llmDefaults'

// Load environment variables from .env file
config()

export interface AppSettings {
  transcriptionProvider: 'openai' | 'assemblyai'
  transcriptionApiKey: string
  assemblyAiSpeechModel: 'universal-streaming-multilingual' | 'universal-streaming-english'
  assemblyAiLanguageDetection: boolean
  assemblyAiMinTurnSilence: number
  assemblyAiMaxTurnSilence: number
  assemblyAiKeytermsPrompt: string
  assemblyAiPrompt: string
  llmProvider: 'openai' | 'openai-oauth' | 'openai-compatible'
  llmAuthMode: 'api-key' | 'oauth-token'
  llmApiKey: string
  llmOauthToken: string
  llmOauthRefreshToken: string
  llmOauthExpiresAt: number
  llmOauthAccountId: string
  llmBaseUrl: string
  llmCustomHeaders: string
  llmModel: string
  deepseekTemperature: number
  deepseekTopP: number
  deepseekMaxTokens: number
  transcriptionLanguage: 'auto' | 'en' | 'pt'
  alwaysOnTop: boolean
  windowOpacity: number
  pauseThreshold: number
  autoStart: boolean
}

const OPENAI_OAUTH_MODEL_OPTIONS = [
  'gpt-5.4',
  'gpt-5.4-mini',
  'gpt-5.3-codex',
  'gpt-5.2-codex',
  'gpt-5.2',
  'gpt-5.1-codex-max',
  'gpt-5.1-codex-mini'
]

const getDeepSeekMaxTokenLimit = (): number => 8192

const clampNumber = (value: number | undefined, min: number, max: number, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback

const getSuggestedModels = (settings: Pick<AppSettings, 'llmProvider' | 'llmBaseUrl'>): string[] => {
  if (settings.llmProvider === 'openai-oauth') {
    return OPENAI_OAUTH_MODEL_OPTIONS
  }

  if (settings.llmProvider !== 'openai-compatible') {
    return []
  }

  const baseURL = settings.llmBaseUrl.toLowerCase()
  if (baseURL.includes('deepseek')) {
    return ['deepseek-chat', 'deepseek-reasoner']
  }

  if (baseURL.includes('minimax')) {
    return ['MiniMax-M2.5', 'MiniMax-Text-01']
  }

  if (baseURL.includes('aliyuncs') || baseURL.includes('dashscope')) {
    return ['qwen3.5-plus', 'qwen-plus', 'qwen-max', 'qwen3-vl-plus']
  }

  return []
}

const getDefaultModelForSettings = (settings: Pick<AppSettings, 'llmProvider' | 'llmBaseUrl'>): string => {
  const suggestedModels = getSuggestedModels(settings)
  if (suggestedModels.length > 0) {
    return suggestedModels[0]
  }

  if (settings.llmProvider === 'openai') {
    return 'gpt-4o-mini'
  }

  return ''
}

const hydrateStoredSettings = (savedSettings: Record<string, unknown>): AppSettings => {
  const hydratedSettings = { ...DEFAULT_SETTINGS }

  for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof AppSettings>) {
    if (key in savedSettings) {
      ;(hydratedSettings as Record<string, unknown>)[key] = savedSettings[key]
    }
  }

  return hydratedSettings
}

const normalizeSettings = (settings: AppSettings): AppSettings => {
  let llmModel = settings.llmModel
  let llmAuthMode = settings.llmAuthMode

  if (settings.llmProvider === 'openai-oauth') {
    llmAuthMode = 'oauth-token'
    if (!OPENAI_OAUTH_MODEL_OPTIONS.includes(llmModel)) {
      llmModel = OPENAI_OAUTH_MODEL_OPTIONS[0]
    }
  } else if (settings.llmProvider === 'openai-compatible') {
    llmAuthMode = 'api-key'
    if (llmModel && OPENAI_OAUTH_MODEL_OPTIONS.includes(llmModel)) {
      llmModel = getDefaultModelForSettings(settings)
    }
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

  const isDeepSeek =
    settings.llmProvider === 'openai-compatible' &&
    isDeepSeekModelConfig({ ...settings, model: llmModel })
  const deepseekFallback = getDefaultOutputTokens({ ...settings, model: llmModel })
  const requestedDeepSeekMaxTokens = isDeepSeek ? settings.deepseekMaxTokens : deepseekFallback
  const isLegacyDeepSeekTokenDefault = isDeepSeek && requestedDeepSeekMaxTokens === 120
  const deepseekMaxTokens = Math.round(
    clampNumber(
      isLegacyDeepSeekTokenDefault ? undefined : requestedDeepSeekMaxTokens,
      32,
      getDeepSeekMaxTokenLimit(),
      deepseekFallback
    )
  )

  return {
    ...settings,
    deepseekTemperature: clampNumber(settings.deepseekTemperature, 0, 2, 0.3),
    deepseekTopP: clampNumber(settings.deepseekTopP, 0, 1, 0.9),
    deepseekMaxTokens,
    llmAuthMode,
    llmModel
  }
}

// Load from environment variables if available
const getEnvApiKey = (key: string): string => {
  return process.env[key] || process.env[`VITE_${key}`] || ''
}

const DEFAULT_SETTINGS: AppSettings = {
  transcriptionProvider:
    process.env.TRANSCRIPTION_PROVIDER === 'assemblyai' ||
    process.env.VITE_TRANSCRIPTION_PROVIDER === 'assemblyai'
      ? 'assemblyai'
      : 'openai',
  transcriptionApiKey:
    process.env.ASSEMBLYAI_API_KEY || process.env.VITE_ASSEMBLYAI_API_KEY || '',
  assemblyAiSpeechModel:
    process.env.ASSEMBLYAI_SPEECH_MODEL === 'universal-streaming-english'
      ? 'universal-streaming-english'
      : 'universal-streaming-multilingual',
  assemblyAiLanguageDetection:
    process.env.ASSEMBLYAI_LANGUAGE_DETECTION === 'false' ||
    process.env.VITE_ASSEMBLYAI_LANGUAGE_DETECTION === 'false'
      ? false
      : true,
  assemblyAiMinTurnSilence: Number(process.env.ASSEMBLYAI_MIN_TURN_SILENCE || 160),
  assemblyAiMaxTurnSilence: Number(process.env.ASSEMBLYAI_MAX_TURN_SILENCE || 1280),
  assemblyAiKeytermsPrompt:
    process.env.ASSEMBLYAI_KEYTERMS_PROMPT || process.env.VITE_ASSEMBLYAI_KEYTERMS_PROMPT || '',
  assemblyAiPrompt:
    process.env.ASSEMBLYAI_PROMPT || process.env.VITE_ASSEMBLYAI_PROMPT || '',
  llmProvider:
    process.env.LLM_PROVIDER === 'openai-compatible' ||
    process.env.VITE_LLM_PROVIDER === 'openai-compatible'
      ? 'openai-compatible'
      : process.env.LLM_PROVIDER === 'openai-oauth' ||
          process.env.VITE_LLM_PROVIDER === 'openai-oauth'
        ? 'openai-oauth'
      : 'openai',
  llmAuthMode:
    process.env.LLM_AUTH_MODE === 'oauth-token' || process.env.VITE_LLM_AUTH_MODE === 'oauth-token'
      ? 'oauth-token'
      : 'api-key',
  llmApiKey: getEnvApiKey('LLM_API_KEY') || getEnvApiKey('OPENAI_API_KEY'),
  llmOauthToken:
    process.env.LLM_OAUTH_TOKEN ||
    process.env.VITE_LLM_OAUTH_TOKEN ||
    process.env.OPENAI_OAUTH_TOKEN ||
    process.env.VITE_OPENAI_OAUTH_TOKEN ||
    '',
  llmOauthRefreshToken: '',
  llmOauthExpiresAt: 0,
  llmOauthAccountId: '',
  llmBaseUrl:
    process.env.LLM_BASE_URL ||
    process.env.VITE_LLM_BASE_URL ||
    process.env.OPENAI_BASE_URL ||
    process.env.VITE_OPENAI_BASE_URL ||
    '',
  llmCustomHeaders:
    process.env.LLM_CUSTOM_HEADERS ||
    process.env.VITE_LLM_CUSTOM_HEADERS ||
    process.env.OPENAI_CUSTOM_HEADERS ||
    process.env.VITE_OPENAI_CUSTOM_HEADERS ||
    '',
  llmModel:
    process.env.LLM_MODEL ||
    process.env.VITE_LLM_MODEL ||
    process.env.OPENAI_MODEL ||
    process.env.VITE_OPENAI_MODEL ||
    'gpt-4o-mini',
  deepseekTemperature: Number(process.env.DEEPSEEK_TEMPERATURE || 0.3),
  deepseekTopP: Number(process.env.DEEPSEEK_TOP_P || 0.9),
  deepseekMaxTokens: Number(
    process.env.DEEPSEEK_MAX_TOKENS || getDefaultOutputTokens({ model: 'deepseek-chat' })
  ),
  transcriptionLanguage:
    process.env.TRANSCRIPTION_LANGUAGE === 'pt' || process.env.VITE_TRANSCRIPTION_LANGUAGE === 'pt'
      ? 'pt'
      : process.env.TRANSCRIPTION_LANGUAGE === 'en' ||
          process.env.VITE_TRANSCRIPTION_LANGUAGE === 'en'
        ? 'en'
        : 'auto',
  alwaysOnTop: true,
  windowOpacity: 1.0,
  pauseThreshold: 1500,
  autoStart: false
}

export class SettingsManager {
  private settingsPath: string
  private settings: AppSettings
  private pendingMigrationSave: boolean

  constructor() {
    const userDataPath = app.getPath('userData')
    this.settingsPath = path.join(userDataPath, 'settings.json')
    const loaded = this.loadSettings()
    this.settings = loaded.settings
    this.pendingMigrationSave = loaded.needsSave
  }

  private loadSettings(): { settings: AppSettings; needsSave: boolean } {
    try {
      if (fs.existsSync(this.settingsPath)) {
        const data = fs.readFileSync(this.settingsPath, 'utf-8')
        const savedSettings = JSON.parse(data)
        let needsSave = false

        // Backward compatibility with older OpenAI-specific setting keys.
        if (!savedSettings.llmApiKey && savedSettings.openaiApiKey) {
          savedSettings.llmApiKey = savedSettings.openaiApiKey
          needsSave = true
        }
        if (!savedSettings.llmOauthToken && savedSettings.openaiOauthToken) {
          savedSettings.llmOauthToken = savedSettings.openaiOauthToken
          needsSave = true
        }
        if (!savedSettings.llmOauthRefreshToken && savedSettings.openaiOauthRefreshToken) {
          savedSettings.llmOauthRefreshToken = savedSettings.openaiOauthRefreshToken
          needsSave = true
        }
        if (!savedSettings.llmBaseUrl && savedSettings.openaiBaseUrl) {
          savedSettings.llmBaseUrl = savedSettings.openaiBaseUrl
          needsSave = true
        }
        if (!savedSettings.llmCustomHeaders && savedSettings.openaiCustomHeaders) {
          savedSettings.llmCustomHeaders = savedSettings.openaiCustomHeaders
          needsSave = true
        }
        if (!savedSettings.llmModel && savedSettings.openaiModel) {
          savedSettings.llmModel = savedSettings.openaiModel
          needsSave = true
        }
        if ('llmDisableThinking' in savedSettings) {
          delete savedSettings.llmDisableThinking
          needsSave = true
        }
        if ('llmReasoningMode' in savedSettings) {
          delete savedSettings.llmReasoningMode
          needsSave = true
        }
        if (!savedSettings.transcriptionProvider) {
          savedSettings.transcriptionProvider = 'assemblyai'
          needsSave = true
        }
        if (!savedSettings.assemblyAiSpeechModel) {
          savedSettings.assemblyAiSpeechModel = 'universal-streaming-multilingual'
          needsSave = true
        }
        if (savedSettings.assemblyAiLanguageDetection === undefined) {
          savedSettings.assemblyAiLanguageDetection = true
          needsSave = true
        }
        if (!savedSettings.assemblyAiMinTurnSilence) {
          savedSettings.assemblyAiMinTurnSilence = 160
          needsSave = true
        }
        if (!savedSettings.assemblyAiMaxTurnSilence) {
          savedSettings.assemblyAiMaxTurnSilence = 1280
          needsSave = true
        }
        // Decrypt API keys if encryption is available
        if (safeStorage.isEncryptionAvailable()) {
          if (!savedSettings.llmApiKeyEncrypted && savedSettings.openaiApiKeyEncrypted) {
            savedSettings.llmApiKeyEncrypted = savedSettings.openaiApiKeyEncrypted
            needsSave = true
          }
          if (!savedSettings.llmOauthTokenEncrypted && savedSettings.openaiOauthTokenEncrypted) {
            savedSettings.llmOauthTokenEncrypted = savedSettings.openaiOauthTokenEncrypted
            needsSave = true
          }
          if (
            !savedSettings.llmOauthRefreshTokenEncrypted &&
            savedSettings.openaiOauthRefreshTokenEncrypted
          ) {
            savedSettings.llmOauthRefreshTokenEncrypted =
              savedSettings.openaiOauthRefreshTokenEncrypted
            needsSave = true
          }
          if (savedSettings.llmApiKeyEncrypted) {
            try {
              savedSettings.llmApiKey = safeStorage.decryptString(
                Buffer.from(savedSettings.llmApiKeyEncrypted, 'base64')
              )
              delete savedSettings.llmApiKeyEncrypted
              needsSave = true
            } catch {
              savedSettings.llmApiKey = ''
            }
          }
          if (savedSettings.llmOauthTokenEncrypted) {
            try {
              savedSettings.llmOauthToken = safeStorage.decryptString(
                Buffer.from(savedSettings.llmOauthTokenEncrypted, 'base64')
              )
              delete savedSettings.llmOauthTokenEncrypted
              needsSave = true
            } catch {
              savedSettings.llmOauthToken = ''
            }
          }
          if (savedSettings.llmOauthRefreshTokenEncrypted) {
            try {
              savedSettings.llmOauthRefreshToken = safeStorage.decryptString(
                Buffer.from(savedSettings.llmOauthRefreshTokenEncrypted, 'base64')
              )
              delete savedSettings.llmOauthRefreshTokenEncrypted
              needsSave = true
            } catch {
              savedSettings.llmOauthRefreshToken = ''
            }
          }
          if (savedSettings.transcriptionApiKeyEncrypted) {
            try {
              savedSettings.transcriptionApiKey = safeStorage.decryptString(
                Buffer.from(savedSettings.transcriptionApiKeyEncrypted, 'base64')
              )
              delete savedSettings.transcriptionApiKeyEncrypted
              needsSave = true
            } catch {
              savedSettings.transcriptionApiKey = ''
            }
          }
        }

        const hydratedSettings = hydrateStoredSettings(savedSettings)
        const normalizedSettings = normalizeSettings(hydratedSettings)

        if (JSON.stringify(hydratedSettings) !== JSON.stringify(normalizedSettings)) {
          needsSave = true
        }

        return { settings: normalizedSettings, needsSave }
      }
    } catch (error) {
      console.error('Failed to load settings:', error)
    }
    return { settings: normalizeSettings({ ...DEFAULT_SETTINGS }), needsSave: false }
  }

  private saveSettings(): void {
    try {
      const settingsToSave = { ...normalizeSettings(this.settings) }

      // Encrypt API keys if encryption is available
      if (safeStorage.isEncryptionAvailable()) {
        if (settingsToSave.llmApiKey) {
          ;(settingsToSave as Record<string, unknown>).llmApiKeyEncrypted = safeStorage
            .encryptString(settingsToSave.llmApiKey)
            .toString('base64')
          settingsToSave.llmApiKey = ''
        }
        if (settingsToSave.llmOauthToken) {
          ;(settingsToSave as Record<string, unknown>).llmOauthTokenEncrypted = safeStorage
            .encryptString(settingsToSave.llmOauthToken)
            .toString('base64')
          settingsToSave.llmOauthToken = ''
        }
        if (settingsToSave.llmOauthRefreshToken) {
          ;(settingsToSave as Record<string, unknown>).llmOauthRefreshTokenEncrypted = safeStorage
            .encryptString(settingsToSave.llmOauthRefreshToken)
            .toString('base64')
          settingsToSave.llmOauthRefreshToken = ''
        }
        if (settingsToSave.transcriptionApiKey) {
          ;(settingsToSave as Record<string, unknown>).transcriptionApiKeyEncrypted = safeStorage
            .encryptString(settingsToSave.transcriptionApiKey)
            .toString('base64')
          settingsToSave.transcriptionApiKey = ''
        }
      }

      fs.writeFileSync(this.settingsPath, JSON.stringify(settingsToSave, null, 2))
      this.pendingMigrationSave = false
    } catch (error) {
      console.error('Failed to save settings:', error)
    }
  }

  flushPendingMigrations(): void {
    if (!this.pendingMigrationSave) {
      return
    }

    this.saveSettings()
  }

  getSettings(): AppSettings {
    this.settings = normalizeSettings(this.settings)
    return { ...this.settings }
  }

  getSetting<K extends keyof AppSettings>(key: K): AppSettings[K] {
    return this.settings[key]
  }

  updateSettings(updates: Partial<AppSettings>): void {
    this.settings = normalizeSettings({ ...this.settings, ...updates })
    this.pendingMigrationSave = false
    this.saveSettings()
  }

  setSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
    this.settings[key] = value
    this.settings = normalizeSettings(this.settings)
    this.pendingMigrationSave = false
    this.saveSettings()
  }

  resetToDefaults(): void {
    this.settings = normalizeSettings({ ...DEFAULT_SETTINGS })
    this.pendingMigrationSave = false
    this.saveSettings()
  }

  hasApiKeys(): boolean {
    const hasLlmCredential =
      this.settings.llmProvider === 'openai' && this.settings.llmAuthMode === 'oauth-token'
        ? Boolean(this.settings.llmOauthToken)
        : Boolean(this.settings.llmApiKey)
    const hasTranscriptionCredential =
      this.settings.transcriptionProvider === 'assemblyai'
        ? Boolean(this.settings.transcriptionApiKey)
        : Boolean(this.settings.llmApiKey)

    return hasLlmCredential && hasTranscriptionCredential
  }
}
