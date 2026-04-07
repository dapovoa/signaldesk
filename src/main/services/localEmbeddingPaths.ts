import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

export const DEFAULT_EMBEDDING_MODEL =
  process.env.SIGNALDESK_EMBED_MODEL || 'all-MiniLM-L6-v2.F16.gguf'
export const DEFAULT_LLM_BASE_URL =
  process.env.SIGNALDESK_LLM_BASE_URL || 'http://127.0.0.1:8081/v1'

const EMBEDDING_MODEL_PATTERN = /(minilm|embed|embedding|bge|gte|e5)/i

const unique = (values: string[]): string[] => [...new Set(values.filter(Boolean))]

const getProjectRoots = (): string[] =>
  unique([process.env.SIGNALDESK_PROJECT_ROOT?.trim() || '', process.cwd(), app.getAppPath()])

const pickFirstExisting = (candidates: string[]): string => {
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }

  return candidates[0] || ''
}

export const resolveEmbeddingModelDirectory = (): string => {
  const configuredDirectory = process.env.SIGNALDESK_EMBED_MODEL_DIR?.trim() || ''
  const candidates = unique([
    configuredDirectory,
    ...getProjectRoots().map((root) => path.resolve(root, 'models'))
  ])

  return pickFirstExisting(candidates)
}

export const resolveEmbeddingModelPath = (model: string): string =>
  path.join(resolveEmbeddingModelDirectory(), model)

export const listEmbeddingModels = (): Array<{ id: string; name: string }> => {
  const directory = resolveEmbeddingModelDirectory()
  if (!directory || !fs.existsSync(directory)) {
    return []
  }

  const allModels = fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.gguf'))
    .map((entry) => ({
      id: entry.name,
      name: entry.name
    }))
    .sort((left, right) => left.id.localeCompare(right.id))

  const embeddingModels = allModels.filter((model) => EMBEDDING_MODEL_PATTERN.test(model.id))
  return embeddingModels.length > 0 ? embeddingModels : allModels
}

export const listLlmModels = (): Array<{ id: string; name: string }> => {
  const directory = resolveEmbeddingModelDirectory()
  if (!directory || !fs.existsSync(directory)) {
    return []
  }

  const allModels = fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.gguf'))
    .map((entry) => ({
      id: entry.name,
      name: entry.name
    }))
    .sort((left, right) => left.id.localeCompare(right.id))

  const llmModels = allModels.filter((model) => !EMBEDDING_MODEL_PATTERN.test(model.id))
  return llmModels.length > 0 ? llmModels : allModels
}

export const resolveLlamaDirectory = (): string => {
  const configuredDirectory = process.env.SIGNALDESK_LLAMA_DIR?.trim() || ''
  const candidates = unique([
    configuredDirectory,
    ...getProjectRoots().map((root) => path.resolve(root, 'vendor', 'llama'))
  ])

  return pickFirstExisting(candidates)
}

export const resolveLlamaServerBinary = (): string => {
  const llamaDirectory = resolveLlamaDirectory()
  const binaryNames =
    process.platform === 'win32' ? ['llama-server.exe', 'llama-server'] : ['llama-server']
  const candidates = binaryNames.map((binaryName) => path.join(llamaDirectory, binaryName))

  return pickFirstExisting(candidates)
}
