import type { AppSettings } from './contracts'

export const OPENAI_OAUTH_MODEL_OPTIONS = [
  'gpt-5.4',
  'gpt-5.4-mini',
  'gpt-5.3-codex',
  'gpt-5.2-codex',
  'gpt-5.2',
  'gpt-5.1-codex-max',
  'gpt-5.1-codex-mini'
] as const

type LlmProviderSelection = Pick<AppSettings, 'llmProvider' | 'llmAuthMode'>
type LlmModelSelection = Pick<AppSettings, 'llmProvider' | 'llmAuthMode' | 'llmBaseUrl'>
type LlmModelState = Pick<
  AppSettings,
  | 'llmProvider'
  | 'llmAuthMode'
  | 'llmModel'
  | 'llmOpenAIModel'
  | 'llmOpenAIOAuthModel'
  | 'llmOpenAICompatibleModel'
  | 'llmAnthropicCompatibleModel'
  | 'llmLlamaCppModel'
>
type LlmCredentialSelection = LlmProviderSelection &
  Pick<
    AppSettings,
    'llmApiKey' | 'llmOpenAICompatibleApiKey' | 'llmAnthropicCompatibleApiKey' | 'llmOauthToken'
  >

export type LlmModelStorageKey =
  | 'llmOpenAIModel'
  | 'llmOpenAIOAuthModel'
  | 'llmOpenAICompatibleModel'
  | 'llmAnthropicCompatibleModel'
  | 'llmLlamaCppModel'

export const usesOAuthCredential = ({ llmProvider, llmAuthMode }: LlmProviderSelection): boolean =>
  llmProvider === 'openai-oauth' || (llmProvider === 'openai' && llmAuthMode === 'oauth-token')

const isOpenAIOAuthModel = (value: string): boolean =>
  OPENAI_OAUTH_MODEL_OPTIONS.includes(value as (typeof OPENAI_OAUTH_MODEL_OPTIONS)[number])

export const getActiveLlmModelStorageKey = ({
  llmProvider,
  llmAuthMode
}: LlmProviderSelection): LlmModelStorageKey => {
  if (llmProvider === 'openai-compatible') {
    return 'llmOpenAICompatibleModel'
  }

  if (llmProvider === 'anthropic-compatible') {
    return 'llmAnthropicCompatibleModel'
  }

  if (llmProvider === 'llama.cpp') {
    return 'llmLlamaCppModel'
  }

  if (usesOAuthCredential({ llmProvider, llmAuthMode })) {
    return 'llmOpenAIOAuthModel'
  }

  return 'llmOpenAIModel'
}

export const getDefaultLlmModel = (settings: LlmModelSelection): string => {
  const suggestedModels = getSuggestedLlmModels(settings)
  if (suggestedModels.length > 0) {
    return suggestedModels[0]
  }

  if (settings.llmProvider === 'openai') {
    return 'gpt-4o-mini'
  }

  if (settings.llmProvider === 'anthropic-compatible') {
    return 'MiniMax-M2.7'
  }

  return ''
}

export const inferLlmModelStorageKey = (
  model: string,
  selection: LlmProviderSelection
): LlmModelStorageKey => {
  const trimmedModel = model.trim()
  if (!trimmedModel) {
    return getActiveLlmModelStorageKey(selection)
  }

  if (trimmedModel.toLowerCase().endsWith('.gguf')) {
    return 'llmLlamaCppModel'
  }

  if (isOpenAIOAuthModel(trimmedModel)) {
    return 'llmOpenAIOAuthModel'
  }

  if (/^MiniMax-/i.test(trimmedModel)) {
    return 'llmAnthropicCompatibleModel'
  }

  if (/^(deepseek-|qwen|glm-)/i.test(trimmedModel)) {
    return 'llmOpenAICompatibleModel'
  }

  return getActiveLlmModelStorageKey(selection)
}

export const getActiveLlmModel = (settings: LlmModelState): string =>
  settings[getActiveLlmModelStorageKey(settings)].trim()

export const setActiveLlmModel = (settings: AppSettings, value: string): AppSettings => {
  const trimmedValue = value.trim()
  const key = getActiveLlmModelStorageKey(settings)
  return {
    ...settings,
    [key]: trimmedValue,
    llmModel: trimmedValue
  }
}

export const resolveManualLlmCredential = ({
  llmProvider,
  llmApiKey,
  llmOpenAICompatibleApiKey,
  llmAnthropicCompatibleApiKey
}: Pick<
  AppSettings,
  'llmProvider' | 'llmApiKey' | 'llmOpenAICompatibleApiKey' | 'llmAnthropicCompatibleApiKey'
>): string => {
  if (llmProvider === 'openai-compatible') {
    return llmOpenAICompatibleApiKey.trim()
  }

  if (llmProvider === 'anthropic-compatible') {
    return llmAnthropicCompatibleApiKey.trim()
  }

  return llmApiKey.trim()
}

export const resolveLlmCredential = ({
  llmProvider,
  llmAuthMode,
  llmApiKey,
  llmOpenAICompatibleApiKey,
  llmAnthropicCompatibleApiKey,
  llmOauthToken
}: LlmCredentialSelection): string =>
  usesOAuthCredential({ llmProvider, llmAuthMode })
    ? llmOauthToken.trim()
    : resolveManualLlmCredential({
        llmProvider,
        llmApiKey,
        llmOpenAICompatibleApiKey,
        llmAnthropicCompatibleApiKey
      })

export const getSuggestedLlmModels = ({
  llmProvider,
  llmAuthMode,
  llmBaseUrl
}: LlmModelSelection): string[] => {
  if (usesOAuthCredential({ llmProvider, llmAuthMode })) {
    return [...OPENAI_OAUTH_MODEL_OPTIONS]
  }

  if (llmProvider === 'llama.cpp') {
    return []
  }

  if (llmProvider === 'anthropic-compatible') {
    return ['MiniMax-M2.7', 'MiniMax-M2.7-highspeed', 'MiniMax-M2.5', 'MiniMax-M2.5-highspeed']
  }

  if (llmProvider !== 'openai-compatible') {
    return []
  }

  const baseURL = llmBaseUrl.toLowerCase()
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

export const normalizeLlmSettings = (settings: AppSettings): AppSettings => {
  let llmAuthMode = settings.llmAuthMode
  const llmOpenAIModel = settings.llmOpenAIModel.trim() || 'gpt-4o-mini'
  const llmOpenAIOAuthModel = isOpenAIOAuthModel(settings.llmOpenAIOAuthModel.trim())
    ? settings.llmOpenAIOAuthModel.trim()
    : OPENAI_OAUTH_MODEL_OPTIONS[0]
  const llmOpenAICompatibleModel = settings.llmOpenAICompatibleModel.trim()
  const llmAnthropicCompatibleModel =
    settings.llmAnthropicCompatibleModel.trim() || 'MiniMax-M2.7'
  const llmLlamaCppModel = settings.llmLlamaCppModel.trim()

  if (settings.llmProvider === 'openai-oauth') {
    llmAuthMode = 'oauth-token'
  } else if (settings.llmProvider === 'llama.cpp') {
    llmAuthMode = 'api-key'
  } else if (settings.llmProvider === 'anthropic-compatible') {
    llmAuthMode = 'api-key'
  } else if (settings.llmProvider === 'openai-compatible') {
    llmAuthMode = 'api-key'
  }

  const nextSettings: AppSettings = {
    ...settings,
    llmApiKey: settings.llmApiKey.trim(),
    llmOpenAICompatibleApiKey: settings.llmOpenAICompatibleApiKey.trim(),
    llmAnthropicCompatibleApiKey: settings.llmAnthropicCompatibleApiKey.trim(),
    llmOauthToken: settings.llmOauthToken.trim(),
    llmOpenAIModel,
    llmOpenAIOAuthModel,
    llmOpenAICompatibleModel,
    llmAnthropicCompatibleModel,
    llmLlamaCppModel,
    llmAuthMode
  }

  return {
    ...nextSettings,
    llmModel: getActiveLlmModel(nextSettings)
  }
}
