export interface TranscriptEvent {
  text: string
  isFinal: boolean
  confidence: number
}

export interface DetectedQuestion {
  text: string
  confidence: number
  questionType: 'direct' | 'indirect' | 'scenario' | 'unknown'
}

export interface DetectedQuestionFromImage {
  text: string
  questionType?: 'leetcode' | 'system-design' | 'other'
  confidence?: number
}

export interface AppSettings {
  transcriptionProvider: 'openai' | 'assemblyai'
  transcriptionApiKey: string
  assemblyAiSpeechModel: 'universal-streaming-multilingual' | 'universal-streaming-english'
  assemblyAiLanguageDetection: boolean
  assemblyAiMinTurnSilence: number
  assemblyAiMaxTurnSilence: number
  assemblyAiKeytermsPrompt: string
  assemblyAiPrompt: string
  llmProvider: 'openai' | 'openai-oauth' | 'openai-compatible' | 'llama.cpp'
  llmAuthMode: 'api-key' | 'oauth-token'
  llmApiKey: string
  llmOauthToken: string
  llmOauthRefreshToken: string
  llmOauthExpiresAt: number
  llmOauthAccountId: string
  llmBaseUrl: string
  llmCustomHeaders: string
  llmModel: string
  transcriptionLanguage: 'auto' | 'en' | 'pt'
  alwaysOnTop: boolean
  windowOpacity: number
  pauseThreshold: number
  captureSourceId: string
  captureSourceType: 'window' | 'screen' | 'auto'
}

export interface AvatarProfile {
  id: string
  identityBase: string
  cvSummary: string
  jobTitle: string
  companyName: string
  jobDescription: string
  companyContext: string
  sourceDirectory: string
  embeddingModel: string
  updatedAt: number
}

export interface AvatarIndexStatus {
  available: boolean
  sourceDirectory: string
  embeddingModel: string
  documentCount: number
  chunkCount: number
  lastIndexedAt: number | null
  databasePath: string
  lastError: string | null
}

export interface AvatarReindexProgress {
  totalDocuments: number
  processedDocuments: number
  embeddedChunks: number
  embeddingModel: string
  currentFile: string | null
}

export interface AudioSource {
  id: string
  name: string
  thumbnail: string
}

export interface AudioSourceSelectionResult {
  sources: AudioSource[]
  canceled: boolean
}

export interface AnswerEntry {
  id: string
  question: string
  answer: string
  timestamp: number
  isStreaming: boolean
  truncated?: boolean
}

export interface WindowCapabilities {
  isWayland: boolean
  supportsAlwaysOnTop: boolean
  supportsWindowOpacity: boolean
  warning: string
}
