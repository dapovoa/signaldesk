import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

export const DEFAULT_LLM_BASE_URL =
  process.env.SIGNALDESK_LLM_BASE_URL?.trim() || 'http://127.0.0.1:8081/v1'

const EMBEDDING_MODEL_PATTERN = /(minilm|embed|embedding|bge|gte|e5)/i

const unique = (values: string[]): string[] => [...new Set(values.filter(Boolean))]

type LlamaBinaryName = 'llama-server' | 'llama-cli'

const getDefaultModelsDirectory = (): string =>
  path.join(app.getPath('userData'), 'models')

export const getDefaultLlamaBinDirectory = (): string =>
  path.join(app.getPath('userData'), 'llama', 'bin')

export const ensureModelsDirectory = (dir?: string): string => {
  const resolvedDir = dir?.trim() || getDefaultModelsDirectory()
  if (!fs.existsSync(resolvedDir)) {
    fs.mkdirSync(resolvedDir, { recursive: true })
  }
  return resolvedDir
}

export const ensureLlamaBinDirectory = (dir?: string): string => {
  const resolvedDir = dir?.trim() || getDefaultLlamaBinDirectory()
  if (!fs.existsSync(resolvedDir)) {
    fs.mkdirSync(resolvedDir, { recursive: true })
  }
  return resolvedDir
}

export const resolveEmbeddingModelDirectory = (userDir?: string): string => {
  const configuredDirectory =
    userDir?.trim() || process.env.SIGNALDESK_EMBED_MODEL_DIR?.trim() || ''
  const candidates = unique([
    configuredDirectory,
    getDefaultModelsDirectory()
  ])

  return pickFirstExisting(candidates)
}

export const resolveEmbeddingModelPath = (model: string, userDir?: string): string =>
  path.join(resolveEmbeddingModelDirectory(userDir), model)

const pickFirstExisting = (candidates: string[]): string => {
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }
  return candidates[0] || ''
}

export const listEmbeddingModels = (userDir?: string): Array<{ id: string; name: string }> => {
  const directory = resolveEmbeddingModelDirectory(userDir)
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

const isExecutableFile = (candidate: string): boolean => {
  if (!candidate) {
    return false
  }

  try {
    fs.accessSync(candidate, fs.constants.X_OK)
    return fs.statSync(candidate).isFile()
  } catch {
    return false
  }
}

const getLlamaBinaryOverride = (binaryName: LlamaBinaryName): string =>
  binaryName === 'llama-server'
    ? process.env.SIGNALDESK_LLAMA_SERVER?.trim() || ''
    : process.env.SIGNALDESK_LLAMA_CLI?.trim() || ''
const getLlamaProjectRoots = (): string[] => {
  const candidates = [process.cwd(), process.resourcesPath || '']

  try {
    candidates.push(app.getAppPath())
  } catch {
    // Ignore while app metadata is unavailable.
  }

  return unique(
    candidates.map((candidate) => {
      try {
        return path.resolve(candidate)
      } catch {
        return ''
      }
    })
  )
}

const getBundledLlamaDirectories = (): string[] =>
  unique(
    getLlamaProjectRoots().flatMap((root) => [
      path.join(root, 'vendor', 'llama', 'bin'),
      path.join(root, 'vendor', 'llama'),
      path.join(root, 'resources', 'vendor', 'llama', 'bin'),
      path.join(root, 'resources', 'vendor', 'llama'),
      path.join(root, 'app.asar.unpacked', 'vendor', 'llama', 'bin'),
      path.join(root, 'app.asar.unpacked', 'vendor', 'llama')
    ])
  )

const getConfiguredLlamaBinDirectory = (configuredDir?: string): string =>
  configuredDir?.trim() || process.env.SIGNALDESK_LLAMA_BIN_DIR?.trim() || ''

const collectLlamaBinaryCandidates = (
  binaryName: LlamaBinaryName,
  configuredDir?: string
): string[] => {
  const override = getLlamaBinaryOverride(binaryName)
  const overrideDir = getConfiguredLlamaBinDirectory(configuredDir)
  const pathDirs = (process.env.PATH || '')
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean)

  return unique([
    override,
    overrideDir ? path.join(overrideDir, binaryName) : '',
    ...getBundledLlamaDirectories().map((dir) => path.join(dir, binaryName)),
    ...pathDirs.map((dir) => path.join(dir, binaryName))
  ])
}

const resolveLlamaBinary = (binaryName: LlamaBinaryName, configuredDir?: string): string => {
  for (const candidate of collectLlamaBinaryCandidates(binaryName, configuredDir)) {
    if (isExecutableFile(candidate)) {
      return candidate
    }
  }

  return ''
}

const getMissingBinaryEnvVar = (binaryName: LlamaBinaryName): string =>
  binaryName === 'llama-server' ? 'SIGNALDESK_LLAMA_SERVER' : 'SIGNALDESK_LLAMA_CLI'

const formatLookupTail = (candidates: string[]): string => {
  const visibleCandidates = candidates.slice(0, 12)
  const remainder = candidates.length - visibleCandidates.length
  const lines = visibleCandidates.map((candidate) => `- ${candidate}`)

  if (remainder > 0) {
    lines.push(`- ... plus ${remainder} more PATH candidates`)
  }

  return lines.join('\n')
}

export const buildLlamaBinaryNotFoundError = (
  binaryName: LlamaBinaryName,
  configuredDir?: string
): string => {
  const envVar = getMissingBinaryEnvVar(binaryName)
  const resolvedBinDir = getConfiguredLlamaBinDirectory(configuredDir)
  const candidates = collectLlamaBinaryCandidates(binaryName, configuredDir)
  const configuredPrefix = resolvedBinDir ? `Configured llama.cpp bin dir: ${resolvedBinDir}\n` : ''

  return `${binaryName} binary not found.\n${configuredPrefix}Choose a llama.cpp binaries folder in Settings, set ${envVar} or SIGNALDESK_LLAMA_BIN_DIR, install ${binaryName} in PATH, or bundle it under resources/vendor/llama/bin.\nChecked:\n${formatLookupTail(candidates)}`
}

export const resolveLlamaServerBinary = (configuredDir?: string): string =>
  resolveLlamaBinary('llama-server', configuredDir)
export const resolveLlamaCliBinary = (configuredDir?: string): string =>
  resolveLlamaBinary('llama-cli', configuredDir)
