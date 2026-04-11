import { config } from 'dotenv'
import { app, safeStorage } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import type { AppSettings, AssemblyAiSpeechModel } from '../../shared/contracts'
import {
  inferLlmModelStorageKey,
  normalizeLlmSettings,
  OPENAI_OAUTH_MODEL_OPTIONS
} from '../../shared/llmSettings'
import {
  ensureModelsDirectory,
  getDefaultModelsDirectory
} from './localEmbeddingPaths'
export type { AppSettings } from '../../shared/contracts'

config()

const hydrateStoredSettings = (savedSettings: Record<string, unknown>): AppSettings => {
  const hydratedSettings = { ...DEFAULT_SETTINGS }

  for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof AppSettings>) {
    if (key in savedSettings) {
      ;(hydratedSettings as Record<string, unknown>)[key] = savedSettings[key]
    }
  }

  return hydratedSettings
}

const getEnvApiKey = (key: string): string => {
  return process.env[key] || process.env[`VITE_${key}`] || ''
}

const DEFAULT_LLM_PROVIDER: AppSettings['llmProvider'] =
  process.env.LLM_PROVIDER === 'llama.cpp' || process.env.VITE_LLM_PROVIDER === 'llama.cpp'
    ? 'llama.cpp'
    : process.env.LLM_PROVIDER === 'anthropic-compatible' ||
        process.env.VITE_LLM_PROVIDER === 'anthropic-compatible'
      ? 'anthropic-compatible'
    : process.env.LLM_PROVIDER === 'openai-compatible' ||
        process.env.VITE_LLM_PROVIDER === 'openai-compatible'
      ? 'openai-compatible'
      : process.env.LLM_PROVIDER === 'openai-oauth' ||
          process.env.VITE_LLM_PROVIDER === 'openai-oauth'
        ? 'openai-oauth'
        : 'openai'

const ASSEMBLYAI_SPEECH_MODEL_ENV =
  process.env.ASSEMBLYAI_SPEECH_MODEL || process.env.VITE_ASSEMBLYAI_SPEECH_MODEL

const DEFAULT_ASSEMBLYAI_SPEECH_MODEL: AssemblyAiSpeechModel =
  ASSEMBLYAI_SPEECH_MODEL_ENV === 'universal-streaming-english'
      ? 'universal-streaming-english'
      : ASSEMBLYAI_SPEECH_MODEL_ENV === 'universal-streaming-multilingual'
        ? 'universal-streaming-multilingual'
        : 'u3-rt-pro'

const getAssemblyAiLanguageDetectionDefault = (speechModel: AssemblyAiSpeechModel): boolean => {
  return speechModel === 'universal-streaming-multilingual'
}

const getAssemblyAiSilenceDefaults = (
  speechModel: AssemblyAiSpeechModel
): { minTurnSilence: number; maxTurnSilence: number } => {
  if (speechModel === 'u3-rt-pro') {
    return { minTurnSilence: 100, maxTurnSilence: 1000 }
  }

  return { minTurnSilence: 400, maxTurnSilence: 1280 }
}

const isAssemblyAiSpeechModel = (value: unknown): value is AssemblyAiSpeechModel => {
  return (
    value === 'u3-rt-pro' ||
    value === 'universal-streaming-multilingual' ||
    value === 'universal-streaming-english'
  )
}

const DEFAULT_ASSEMBLYAI_SILENCE = getAssemblyAiSilenceDefaults(DEFAULT_ASSEMBLYAI_SPEECH_MODEL)
const DEFAULT_ENV_LLM_MODEL =
  process.env.LLM_MODEL ||
  process.env.VITE_LLM_MODEL ||
  process.env.OPENAI_MODEL ||
  process.env.VITE_OPENAI_MODEL ||
  ''

const DEFAULT_SETTINGS: AppSettings = {
  transcriptionProvider:
    process.env.TRANSCRIPTION_PROVIDER === 'assemblyai' ||
    process.env.VITE_TRANSCRIPTION_PROVIDER === 'assemblyai'
      ? 'assemblyai'
      : 'openai',
  transcriptionApiKey: process.env.ASSEMBLYAI_API_KEY || process.env.VITE_ASSEMBLYAI_API_KEY || '',
  assemblyAiSpeechModel: DEFAULT_ASSEMBLYAI_SPEECH_MODEL,
  assemblyAiLanguageDetection:
    process.env.ASSEMBLYAI_LANGUAGE_DETECTION === 'false' ||
    process.env.VITE_ASSEMBLYAI_LANGUAGE_DETECTION === 'false'
      ? false
      : process.env.ASSEMBLYAI_LANGUAGE_DETECTION === 'true' ||
          process.env.VITE_ASSEMBLYAI_LANGUAGE_DETECTION === 'true'
        ? true
        : getAssemblyAiLanguageDetectionDefault(DEFAULT_ASSEMBLYAI_SPEECH_MODEL),
  assemblyAiMinTurnSilence: Number(
    process.env.ASSEMBLYAI_MIN_TURN_SILENCE || DEFAULT_ASSEMBLYAI_SILENCE.minTurnSilence
  ),
  assemblyAiMaxTurnSilence: Number(
    process.env.ASSEMBLYAI_MAX_TURN_SILENCE || DEFAULT_ASSEMBLYAI_SILENCE.maxTurnSilence
  ),
  assemblyAiKeytermsPrompt:
    process.env.ASSEMBLYAI_KEYTERMS_PROMPT || process.env.VITE_ASSEMBLYAI_KEYTERMS_PROMPT || '',
  assemblyAiPrompt: process.env.ASSEMBLYAI_PROMPT || process.env.VITE_ASSEMBLYAI_PROMPT || '',
  llmProvider: DEFAULT_LLM_PROVIDER,
  llmAuthMode:
    process.env.LLM_AUTH_MODE === 'oauth-token' || process.env.VITE_LLM_AUTH_MODE === 'oauth-token'
      ? 'oauth-token'
      : 'api-key',
  llmApiKey: getEnvApiKey('LLM_API_KEY') || getEnvApiKey('OPENAI_API_KEY'),
  llmOpenAICompatibleApiKey: getEnvApiKey('OPENAI_COMPATIBLE_API_KEY'),
  llmAnthropicCompatibleApiKey: getEnvApiKey('ANTHROPIC_API_KEY'),
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
  llmModel: DEFAULT_ENV_LLM_MODEL,
  llmOpenAIModel:
    DEFAULT_LLM_PROVIDER === 'openai' && DEFAULT_ENV_LLM_MODEL ? DEFAULT_ENV_LLM_MODEL : 'gpt-4o-mini',
  llmOpenAIOAuthModel: OPENAI_OAUTH_MODEL_OPTIONS.includes(
    DEFAULT_ENV_LLM_MODEL as (typeof OPENAI_OAUTH_MODEL_OPTIONS)[number]
  )
    ? DEFAULT_ENV_LLM_MODEL
    : OPENAI_OAUTH_MODEL_OPTIONS[0],
  llmOpenAICompatibleModel:
    DEFAULT_LLM_PROVIDER === 'openai-compatible' ? DEFAULT_ENV_LLM_MODEL : '',
  llmAnthropicCompatibleModel:
    DEFAULT_LLM_PROVIDER === 'anthropic-compatible' && DEFAULT_ENV_LLM_MODEL
      ? DEFAULT_ENV_LLM_MODEL
      : 'MiniMax-M2.7',
  llmLlamaCppModel: DEFAULT_LLM_PROVIDER === 'llama.cpp' ? DEFAULT_ENV_LLM_MODEL : '',
  llmModelDir: process.env.SIGNALDESK_LLM_MODEL_DIR || '',
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
  captureSourceId: '',
  captureSourceType: 'auto'
}

const normalizeSettings = (settings: AppSettings): AppSettings =>
  normalizeLlmSettings({
    ...settings,
    llmModelDir: settings.llmModelDir?.trim() || getDefaultModelsDirectory()
  })

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
    this.applyRuntimeSettings()
  }

  private applyRuntimeSettings(): void {
    const normalized = normalizeSettings(this.settings)
    this.settings = normalized
    process.env.SIGNALDESK_LLM_MODEL_DIR = normalized.llmModelDir
    ensureModelsDirectory(normalized.llmModelDir)
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
        if (
          !savedSettings.llmOpenAICompatibleApiKey &&
          savedSettings.openaiCompatibleApiKey
        ) {
          savedSettings.llmOpenAICompatibleApiKey = savedSettings.openaiCompatibleApiKey
          needsSave = true
        }
        if (
          !savedSettings.llmAnthropicCompatibleApiKey &&
          savedSettings.anthropicCompatibleApiKey
        ) {
          savedSettings.llmAnthropicCompatibleApiKey = savedSettings.anthropicCompatibleApiKey
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
        const legacyModel =
          typeof savedSettings.llmModel === 'string' ? savedSettings.llmModel.trim() : ''
        if (legacyModel) {
          const inferredModelKey = inferLlmModelStorageKey(legacyModel, {
            llmProvider: (savedSettings.llmProvider ||
              DEFAULT_LLM_PROVIDER) as AppSettings['llmProvider'],
            llmAuthMode:
              savedSettings.llmAuthMode === 'oauth-token' ? 'oauth-token' : 'api-key'
          })

          if (!savedSettings[inferredModelKey]) {
            savedSettings[inferredModelKey] = legacyModel
            needsSave = true
          }
        }
        if (typeof savedSettings.llmModelDir !== 'string' || !savedSettings.llmModelDir.trim()) {
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
          savedSettings.assemblyAiSpeechModel = DEFAULT_ASSEMBLYAI_SPEECH_MODEL
          needsSave = true
        }
        if (!isAssemblyAiSpeechModel(savedSettings.assemblyAiSpeechModel)) {
          savedSettings.assemblyAiSpeechModel = DEFAULT_ASSEMBLYAI_SPEECH_MODEL
          needsSave = true
        }
        const speechModel = savedSettings.assemblyAiSpeechModel as AssemblyAiSpeechModel
        const silenceDefaults = getAssemblyAiSilenceDefaults(speechModel)
        if (savedSettings.assemblyAiLanguageDetection === undefined) {
          savedSettings.assemblyAiLanguageDetection =
            getAssemblyAiLanguageDetectionDefault(speechModel)
          needsSave = true
        }
        if (!savedSettings.assemblyAiMinTurnSilence) {
          savedSettings.assemblyAiMinTurnSilence = silenceDefaults.minTurnSilence
          needsSave = true
        }
        if (!savedSettings.assemblyAiMaxTurnSilence) {
          savedSettings.assemblyAiMaxTurnSilence = silenceDefaults.maxTurnSilence
          needsSave = true
        }
        if (
          speechModel === 'universal-streaming-multilingual' &&
          savedSettings.assemblyAiMinTurnSilence === 160 &&
          savedSettings.assemblyAiMaxTurnSilence === 1280
        ) {
          savedSettings.assemblyAiMinTurnSilence = 400
          needsSave = true
        }
        if (
          speechModel === 'u3-rt-pro' &&
          savedSettings.assemblyAiMinTurnSilence === 400 &&
          savedSettings.assemblyAiMaxTurnSilence === 1280
        ) {
          savedSettings.assemblyAiMinTurnSilence = 100
          savedSettings.assemblyAiMaxTurnSilence = 1000
          needsSave = true
        }
        if (
          !savedSettings.llmOpenAICompatibleApiKey &&
          savedSettings.llmProvider === 'openai-compatible' &&
          savedSettings.llmApiKey
        ) {
          savedSettings.llmOpenAICompatibleApiKey = savedSettings.llmApiKey
          needsSave = true
        }
        if (
          !savedSettings.llmAnthropicCompatibleApiKey &&
          savedSettings.llmProvider === 'anthropic-compatible' &&
          savedSettings.llmApiKey
        ) {
          savedSettings.llmAnthropicCompatibleApiKey = savedSettings.llmApiKey
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
          if (savedSettings.llmOpenAICompatibleApiKeyEncrypted) {
            try {
              savedSettings.llmOpenAICompatibleApiKey = safeStorage.decryptString(
                Buffer.from(savedSettings.llmOpenAICompatibleApiKeyEncrypted, 'base64')
              )
              delete savedSettings.llmOpenAICompatibleApiKeyEncrypted
              needsSave = true
            } catch {
              savedSettings.llmOpenAICompatibleApiKey = ''
            }
          }
          if (savedSettings.llmAnthropicCompatibleApiKeyEncrypted) {
            try {
              savedSettings.llmAnthropicCompatibleApiKey = safeStorage.decryptString(
                Buffer.from(savedSettings.llmAnthropicCompatibleApiKeyEncrypted, 'base64')
              )
              delete savedSettings.llmAnthropicCompatibleApiKeyEncrypted
              needsSave = true
            } catch {
              savedSettings.llmAnthropicCompatibleApiKey = ''
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
        if (settingsToSave.llmOpenAICompatibleApiKey) {
          ;(settingsToSave as Record<string, unknown>).llmOpenAICompatibleApiKeyEncrypted =
            safeStorage.encryptString(settingsToSave.llmOpenAICompatibleApiKey).toString('base64')
          settingsToSave.llmOpenAICompatibleApiKey = ''
        }
        if (settingsToSave.llmAnthropicCompatibleApiKey) {
          ;(settingsToSave as Record<string, unknown>).llmAnthropicCompatibleApiKeyEncrypted =
            safeStorage
              .encryptString(settingsToSave.llmAnthropicCompatibleApiKey)
              .toString('base64')
          settingsToSave.llmAnthropicCompatibleApiKey = ''
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
    this.applyRuntimeSettings()
    this.pendingMigrationSave = false
    this.saveSettings()
  }

  setSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
    this.settings[key] = value
    this.settings = normalizeSettings(this.settings)
    this.applyRuntimeSettings()
    this.pendingMigrationSave = false
    this.saveSettings()
  }

  resetToDefaults(): void {
    this.settings = normalizeSettings({ ...DEFAULT_SETTINGS })
    this.applyRuntimeSettings()
    this.pendingMigrationSave = false
    this.saveSettings()
  }
}
