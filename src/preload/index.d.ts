import { ElectronAPI } from '@electron-toolkit/preload'

export interface TranscriptEvent {
  text: string
  isFinal: boolean
  confidence: number
}

export interface DetectedQuestion {
  text: string
  confidence: number
  questionType: 'direct' | 'indirect' | 'rhetorical' | 'unknown'
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
  llmProvider: 'openai' | 'openai-oauth' | 'openai-compatible'
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
  autoStart: boolean
}

export interface AvatarProfile {
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

export interface Api {
  // Settings
  getSettings: () => Promise<AppSettings>
  updateSettings: (updates: Partial<AppSettings>) => Promise<AppSettings>
  hasApiKeys: () => Promise<boolean>
  getWindowCapabilities: () => Promise<WindowCapabilities>
  fetchOpenAIModels: (
    payload: {
      apiKey?: string
      oauthToken?: string
      provider?: 'openai' | 'openai-oauth' | 'openai-compatible'
      authMode?: 'api-key' | 'oauth-token'
      baseURL?: string
      customHeaders?: string
    }
  ) => Promise<{ success: boolean; models: Array<{ id: string; name: string }>; error?: string }>
  fetchOllamaEmbeddingModels: (payload?: {
    baseURL?: string
  }) => Promise<{ success: boolean; models: Array<{ id: string; name: string }>; error?: string }>
  testProviderConnection: (payload: {
    apiKey?: string
    oauthToken?: string
    provider?: 'openai' | 'openai-oauth' | 'openai-compatible'
    authMode?: 'api-key' | 'oauth-token'
    baseURL?: string
    customHeaders?: string
    model?: string
  }) => Promise<{ success: boolean; message: string; modelCount?: number; hasPreferredModel?: boolean }>
  testTranscriptionConnection: (payload: {
    provider?: 'openai' | 'assemblyai'
    apiKey?: string
    language?: 'auto' | 'en' | 'pt'
    assemblyAiSpeechModel?: 'universal-streaming-multilingual' | 'universal-streaming-english'
    assemblyAiLanguageDetection?: boolean
    assemblyAiMinTurnSilence?: number
    assemblyAiMaxTurnSilence?: number
    assemblyAiKeytermsPrompt?: string
    assemblyAiPrompt?: string
  }) => Promise<{ success: boolean; message: string }>
  connectOpenAIOAuth: () => Promise<{ success: boolean; settings?: AppSettings; error?: string }>
  disconnectOpenAIOAuth: () => Promise<{ success: boolean; settings?: AppSettings; error?: string }>

  // Avatar
  getAvatarProfile: () => Promise<AvatarProfile>
  updateAvatarProfile: (updates: Partial<AvatarProfile>) => Promise<AvatarProfile>
  openAvatarMemoryFolder: () => Promise<{ success: boolean; path: string; error?: string }>
  getAvatarIndexStatus: () => Promise<AvatarIndexStatus>
  reindexAvatarSources: () => Promise<AvatarIndexStatus>

  // Audio capture
  startCapture: () => Promise<{ success: boolean }>
  stopCapture: () => Promise<{ success: boolean }>
  getCaptureStatus: () => Promise<boolean>
  sendAudioData: (audioData: ArrayBuffer) => void
  getAudioSources: () => Promise<AudioSource[]>

  // Window controls
  setAlwaysOnTop: (value: boolean) => Promise<boolean>
  setWindowOpacity: (value: number) => Promise<number>
  minimizeWindow: () => Promise<void>
  closeWindow: () => Promise<void>

  // Conversation
  clearHistory: () => Promise<{ success: boolean }>
  generateAnswerManually: (questionText: string) => Promise<{ success: boolean }>

  // History
  getHistory: () => Promise<AnswerEntry[]>
  saveHistoryEntry: (entry: AnswerEntry) => Promise<{ success: boolean }>
  saveHistoryEntries: (entries: AnswerEntry[]) => Promise<{ success: boolean }>
  clearSavedHistory: () => Promise<{ success: boolean }>
  deleteHistoryEntry: (id: string) => Promise<{ success: boolean }>

  // Clipboard
  writeToClipboard: (text: string) => Promise<{ success: boolean; error?: string }>

  // Screenshot
  captureScreenshot: () => Promise<{ success: boolean; imageData?: string; error?: string }>
  analyzeScreenshot: (imageData: string) => Promise<{
    success: boolean
    isQuestion?: boolean
    questionText?: string
    questionType?: 'leetcode' | 'system-design' | 'other'
    error?: string
    message?: string
  }>

  // Session API
  callSessionApi: (payload: {
    sessionDuration: number
    timestamp: number
    [key: string]: unknown
  }) => Promise<{ success: boolean; data?: unknown; error?: string }>

  // Event listeners
  onTranscript: (callback: (event: TranscriptEvent) => void) => () => void
  onUtteranceEnd: (callback: () => void) => () => void
  onSpeechStarted: (callback: () => void) => () => void
  onQuestionDetected: (callback: (question: DetectedQuestion) => void) => () => void
  onQuestionNotDetectedByModel: (callback: (data: { text: string }) => void) => () => void
  onAnswerStream: (callback: (chunk: string) => void) => () => void
  onAnswerComplete: (callback: (answer: string) => void) => () => void
  onAnswerTruncated: (callback: () => void) => () => void
  onCaptureError: (callback: (error: string) => void) => () => void
  onAnswerError: (callback: (error: string) => void) => () => void
  onScreenshotCaptured: (callback: (data: { imageData: string }) => void) => () => void
  onQuestionDetectedFromImage: (
    callback: (question: DetectedQuestionFromImage) => void
  ) => () => void
  onScreenshotNoQuestion: (callback: (data: { message: string }) => void) => () => void
  onAvatarReindexProgress: (callback: (progress: AvatarReindexProgress) => void) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: Api
  }
}
