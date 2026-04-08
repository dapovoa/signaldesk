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
type LlmModelSelection = Pick<AppSettings, 'llmProvider' | 'llmBaseUrl'>
type LlmCredentialSelection = LlmProviderSelection &
  Pick<AppSettings, 'llmApiKey' | 'llmOauthToken'>

export const usesOAuthCredential = ({ llmProvider, llmAuthMode }: LlmProviderSelection): boolean =>
  llmProvider === 'openai-oauth' || (llmProvider === 'openai' && llmAuthMode === 'oauth-token')

export const resolveLlmCredential = ({
  llmProvider,
  llmAuthMode,
  llmApiKey,
  llmOauthToken
}: LlmCredentialSelection): string =>
  usesOAuthCredential({ llmProvider, llmAuthMode }) ? llmOauthToken.trim() : llmApiKey.trim()

export const getSuggestedLlmModels = ({ llmProvider, llmBaseUrl }: LlmModelSelection): string[] => {
  if (llmProvider === 'openai-oauth') {
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

export const getDefaultLlmModel = (settings: LlmModelSelection): string => {
  const suggestedModels = getSuggestedLlmModels(settings)
  if (suggestedModels.length > 0) {
    return suggestedModels[0]
  }

  if (settings.llmProvider === 'openai') {
    return 'gpt-4o-mini'
  }

  if (settings.llmProvider === 'llama.cpp') {
    return ''
  }

  if (settings.llmProvider === 'anthropic-compatible') {
    return 'MiniMax-M2.7'
  }

  return ''
}

const isOpenAIOAuthModel = (value: string): boolean =>
  OPENAI_OAUTH_MODEL_OPTIONS.includes(value as (typeof OPENAI_OAUTH_MODEL_OPTIONS)[number])

export const normalizeLlmSettings = (settings: AppSettings): AppSettings => {
  let llmModel = settings.llmModel
  let llmAuthMode = settings.llmAuthMode

  if (settings.llmProvider === 'openai-oauth') {
    llmAuthMode = 'oauth-token'
    if (!isOpenAIOAuthModel(llmModel)) {
      llmModel = OPENAI_OAUTH_MODEL_OPTIONS[0]
    }
  } else if (settings.llmProvider === 'llama.cpp') {
    llmAuthMode = 'api-key'
    if (llmModel && (isOpenAIOAuthModel(llmModel) || llmModel === 'gpt-4o-mini')) {
      llmModel = ''
    }
  } else if (settings.llmProvider === 'anthropic-compatible') {
    llmAuthMode = 'api-key'
    if (llmModel && (isOpenAIOAuthModel(llmModel) || llmModel === 'gpt-4o-mini')) {
      llmModel = 'MiniMax-M2.7'
    }
    if (!llmModel) {
      llmModel = 'MiniMax-M2.7'
    }
  } else if (settings.llmProvider === 'openai-compatible') {
    llmAuthMode = 'api-key'
    if (llmModel && isOpenAIOAuthModel(llmModel)) {
      llmModel = getDefaultLlmModel(settings)
    }
  } else if (
    settings.llmProvider === 'openai' &&
    (!llmModel ||
      llmModel.startsWith('deepseek-') ||
      llmModel.startsWith('qwen') ||
      llmModel.startsWith('MiniMax-') ||
      llmModel.startsWith('glm-'))
  ) {
    llmModel = getDefaultLlmModel(settings)
  }

  return {
    ...settings,
    llmAuthMode,
    llmModel
  }
}
