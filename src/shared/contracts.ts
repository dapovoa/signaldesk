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

export type AssemblyAiSpeechModel =
  | 'u3-rt-pro'
  | 'universal-streaming-multilingual'
  | 'universal-streaming-english'

export interface AppSettings {
  transcriptionProvider: 'openai' | 'assemblyai'
  transcriptionApiKey: string
  openaiTranscriptionApiKey: string
  whisperModel: string
  assemblyAiSpeechModel: AssemblyAiSpeechModel
  assemblyAiLanguageDetection: boolean
  assemblyAiMinTurnSilence: number
  assemblyAiMaxTurnSilence: number
  assemblyAiKeytermsPrompt: string
  assemblyAiPrompt: string
  llmProvider: 'openai' | 'openai-oauth' | 'openai-compatible' | 'llama.cpp' | 'anthropic-compatible'
  llmAuthMode: 'api-key' | 'oauth-token'
  llmApiKey: string
  llmOpenAICompatibleApiKey: string
  llmAnthropicCompatibleApiKey: string
  llmOauthToken: string
  llmOauthRefreshToken: string
  llmOauthExpiresAt: number
  llmOauthAccountId: string
  llmBaseUrl: string
  llmCustomHeaders: string
  llmModel: string
  llmOpenAIModel: string
  llmOpenAIOAuthModel: string
  llmOpenAICompatibleModel: string
  llmAnthropicCompatibleModel: string
  llmLlamaCppModel: string
  llmModelDir: string
  llmTemperature: number
  llmTopP: number
  llmTopK: number
  historySession: number
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
  answerStyle: string
  jobTitle: string
  companyName: string
  jobDescription: string
  companyContext: string
  candidateKnowledge: string
  updatedAt: number
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
  platform: NodeJS.Platform
  isWayland: boolean
  supportsAlwaysOnTop: boolean
  supportsWindowOpacity: boolean
  warning: string
}
