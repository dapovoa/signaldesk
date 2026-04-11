import { ElectronAPI } from '@electron-toolkit/preload'
import type {
  AnswerEntry,
  AppSettings,
  AudioSourceSelectionResult,
  AvatarIndexStatus,
  AvatarProfile,
  AvatarReindexProgress,
  DetectedQuestion,
  DetectedQuestionFromImage,
  TranscriptEvent,
  WindowCapabilities
} from '../shared/contracts'
export type {
  AnswerEntry,
  AppSettings,
  AudioSource,
  AudioSourceSelectionResult,
  AvatarIndexStatus,
  AvatarProfile,
  AvatarReindexProgress,
  DetectedQuestion,
  DetectedQuestionFromImage,
  TranscriptEvent,
  WindowCapabilities
} from '../shared/contracts'

export interface Api {
  getSettings: () => Promise<AppSettings>
  updateSettings: (updates: Partial<AppSettings>) => Promise<AppSettings>
  getWindowCapabilities: () => Promise<WindowCapabilities>
  fetchLlmModels: (payload: {
    apiKey?: string
    oauthToken?: string
    provider?: 'openai' | 'openai-oauth' | 'openai-compatible' | 'llama.cpp' | 'anthropic-compatible'
    authMode?: 'api-key' | 'oauth-token'
    baseURL?: string
    customHeaders?: string
    llmModelDir?: string
  }) => Promise<{ success: boolean; models: Array<{ id: string; name: string }>; error?: string }>
  fetchEmbeddingModels: (userDir?: string) => Promise<{
    success: boolean
    models: Array<{ id: string; name: string }>
    directory: string
    error?: string
  }>
  testProviderConnection: (payload: {
    apiKey?: string
    oauthToken?: string
    provider?: 'openai' | 'openai-oauth' | 'openai-compatible' | 'llama.cpp' | 'anthropic-compatible'
    authMode?: 'api-key' | 'oauth-token'
    baseURL?: string
    customHeaders?: string
    model?: string
    llmModelDir?: string
    testKind?: 'connect' | 'llm'
  }) => Promise<{
    success: boolean
    message: string
    modelCount?: number
    models?: string[]
    hasPreferredModel?: boolean
  }>
  testTranscriptionConnection: (payload: {
    provider?: 'openai' | 'assemblyai'
    apiKey?: string
    language?: 'auto' | 'en' | 'pt'
    assemblyAiSpeechModel?: 'u3-rt-pro' | 'universal-streaming-multilingual' | 'universal-streaming-english'
    assemblyAiLanguageDetection?: boolean
    assemblyAiMinTurnSilence?: number
    assemblyAiMaxTurnSilence?: number
    assemblyAiKeytermsPrompt?: string
    assemblyAiPrompt?: string
  }) => Promise<{ success: boolean; message: string }>
  connectOpenAIOAuth: () => Promise<{ success: boolean; settings?: AppSettings; error?: string }>
  disconnectOpenAIOAuth: () => Promise<{ success: boolean; settings?: AppSettings; error?: string }>
  getAvatarProfile: () => Promise<AvatarProfile>
  updateAvatarProfile: (updates: Partial<AvatarProfile>) => Promise<AvatarProfile>
  openAvatarMemoryFolder: () => Promise<{ success: boolean; path: string; error?: string }>
  getAvatarIndexStatus: () => Promise<AvatarIndexStatus>
  reindexAvatarSources: () => Promise<AvatarIndexStatus>
  testEmbeddingModel: (model: string, userDir?: string) => Promise<{ valid: boolean; error?: string }>
  selectEmbeddingModelDir: (directory?: string) => Promise<{ success: boolean; directory: string }>
  selectLlmModelDir: (directory?: string) => Promise<{ success: boolean; directory: string }>
  startCapture: () => Promise<{ success: boolean }>
  stopCapture: () => Promise<{ success: boolean }>
  sendAudioData: (audioData: ArrayBuffer) => void
  getAudioSources: () => Promise<AudioSourceSelectionResult>
  setAlwaysOnTop: (value: boolean) => Promise<boolean>
  setWindowOpacity: (value: number) => Promise<number>
  minimizeWindow: () => Promise<void>
  closeWindow: () => Promise<void>
  clearHistory: () => Promise<{ success: boolean }>
  generateAnswerManually: (questionText: string) => Promise<{ success: boolean }>
  getHistory: () => Promise<AnswerEntry[]>
  saveHistoryEntry: (entry: AnswerEntry) => Promise<{ success: boolean }>
  saveHistoryEntries: (entries: AnswerEntry[]) => Promise<{ success: boolean }>
  clearSavedHistory: () => Promise<{ success: boolean }>
  deleteHistoryEntry: (id: string) => Promise<{ success: boolean }>
  writeToClipboard: (text: string) => Promise<{ success: boolean; error?: string }>
  captureScreenshot: () => Promise<{ success: boolean; imageData?: string; error?: string }>
  analyzeScreenshot: (imageData: string) => Promise<{
    success: boolean
    isQuestion?: boolean
    questionText?: string
    questionType?: 'leetcode' | 'system-design' | 'other'
    error?: string
    message?: string
  }>
  callSessionApi: (payload: {
    sessionDuration: number
    timestamp: number
    [key: string]: unknown
  }) => Promise<{ success: boolean; data?: unknown; error?: string; skipped?: boolean }>
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
  onGenerationStart: (callback: () => void) => () => void
  onGenerationEnd: (callback: () => void) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: Api
  }
}
