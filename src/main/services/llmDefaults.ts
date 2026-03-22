export interface LlmModelConfig {
  baseURL?: string
  model?: string
}

export const DEFAULT_OUTPUT_TOKENS = 1024
export const DEFAULT_REASONER_OUTPUT_TOKENS = 2048

export const isDeepSeekModelConfig = (config: LlmModelConfig): boolean =>
  config.baseURL?.toLowerCase().includes('deepseek') === true ||
  config.model?.toLowerCase().startsWith('deepseek-') === true

export const getDefaultOutputTokens = (config: LlmModelConfig): number =>
  config.model?.toLowerCase() === 'deepseek-reasoner'
    ? DEFAULT_REASONER_OUTPUT_TOKENS
    : DEFAULT_OUTPUT_TOKENS
