import type { AppSettings } from './contracts'

type LlmProviderSelection = Pick<AppSettings, 'llmProvider' | 'llmAuthMode'>
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

export const getDefaultLlmModel = (_settings: LlmProviderSelection): string => ''

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

export const normalizeLlmSettings = (settings: AppSettings): AppSettings => {
  let llmAuthMode = settings.llmAuthMode
  const llmOpenAIModel = settings.llmOpenAIModel.trim()
  const llmOpenAIOAuthModel = settings.llmOpenAIOAuthModel.trim()
  const llmOpenAICompatibleModel = settings.llmOpenAICompatibleModel.trim()
  const llmAnthropicCompatibleModel = settings.llmAnthropicCompatibleModel.trim()
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
