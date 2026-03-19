import OpenAI from 'openai'

export interface OpenAICompatibleConfig {
  apiKey: string
  baseURL?: string
  customHeaders?: string
}

export const parseCustomHeaders = (
  rawHeaders?: string
): Record<string, string> | undefined => {
  if (!rawHeaders?.trim()) return undefined

  const parsed: Record<string, string> = {}
  const entries = rawHeaders
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)

  for (const entry of entries) {
    const separator = entry.indexOf(':')
    if (separator <= 0) continue

    const key = entry.slice(0, separator).trim()
    const value = entry.slice(separator + 1).trim()
    if (!key || !value) continue

    parsed[key] = value
  }

  return Object.keys(parsed).length > 0 ? parsed : undefined
}

export const createOpenAIClient = (config: OpenAICompatibleConfig): OpenAI => {
  return new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL?.trim() || undefined,
    defaultHeaders: parseCustomHeaders(config.customHeaders)
  })
}
