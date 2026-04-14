import { electronAPI } from '@electron-toolkit/preload'
import { contextBridge, ipcRenderer } from 'electron'
import type {
  AnswerEntry,
  AppSettings,
  AudioSourceSelectionResult,
  AvatarProfile,
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
  AvatarProfile,
  DetectedQuestion,
  DetectedQuestionFromImage,
  TranscriptEvent,
  WindowCapabilities
} from '../shared/contracts'

const api = {
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('get-settings'),
  updateSettings: (updates: Partial<AppSettings>): Promise<AppSettings> =>
    ipcRenderer.invoke('update-settings', updates),
  getWindowCapabilities: (): Promise<WindowCapabilities> =>
    ipcRenderer.invoke('get-window-capabilities'),
  fetchLlmModels: (payload: {
    apiKey?: string
    oauthToken?: string
    provider?: 'openai' | 'openai-oauth' | 'openai-compatible' | 'llama.cpp' | 'anthropic-compatible'
    authMode?: 'api-key' | 'oauth-token'
    baseURL?: string
    customHeaders?: string
    llmModelDir?: string
  }): Promise<{ success: boolean; models: Array<{ id: string; name: string }>; error?: string }> =>
    ipcRenderer.invoke('fetch-llm-models', payload),
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
  }): Promise<{
    success: boolean
    message: string
    modelCount?: number
    models?: string[]
    hasPreferredModel?: boolean
  }> => ipcRenderer.invoke('test-provider-connection', payload),
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
  }): Promise<{ success: boolean; message: string }> =>
    ipcRenderer.invoke('test-transcription-connection', payload),
  connectOpenAIOAuth: (): Promise<{ success: boolean; settings?: AppSettings; error?: string }> =>
    ipcRenderer.invoke('connect-openai-oauth'),
  disconnectOpenAIOAuth: (): Promise<{
    success: boolean
    settings?: AppSettings
    error?: string
  }> => ipcRenderer.invoke('disconnect-openai-oauth'),
  getAvatarProfile: (): Promise<AvatarProfile> => ipcRenderer.invoke('get-avatar-profile'),
  updateAvatarProfile: (updates: Partial<AvatarProfile>): Promise<AvatarProfile> =>
    ipcRenderer.invoke('update-avatar-profile', updates),
  openLlmModelsFolder: (): Promise<{ success: boolean; path: string; error?: string }> =>
    ipcRenderer.invoke('open-llm-models-folder'),
  startCapture: (): Promise<{ success: boolean }> => ipcRenderer.invoke('start-capture'),
  stopCapture: (): Promise<{ success: boolean }> => ipcRenderer.invoke('stop-capture'),
  sendAudioData: (audioData: ArrayBuffer): void => ipcRenderer.send('audio-data', audioData),
  getAudioSources: (): Promise<AudioSourceSelectionResult> =>
    ipcRenderer.invoke('get-audio-sources'),
  setAlwaysOnTop: (value: boolean): Promise<boolean> =>
    ipcRenderer.invoke('set-always-on-top', value),
  setWindowOpacity: (value: number): Promise<number> =>
    ipcRenderer.invoke('set-window-opacity', value),
  minimizeWindow: (): Promise<void> => ipcRenderer.invoke('minimize-window'),
  closeWindow: (): Promise<void> => ipcRenderer.invoke('close-window'),
  clearHistory: (): Promise<{ success: boolean }> => ipcRenderer.invoke('clear-history'),
  generateAnswerManually: (questionText: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('generate-answer-manually', questionText),
  getHistory: (): Promise<AnswerEntry[]> => ipcRenderer.invoke('get-history'),
  saveHistoryEntry: (entry: AnswerEntry): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('save-history-entry', entry),
  saveHistoryEntries: (entries: AnswerEntry[]): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('save-history-entries', entries),
  clearSavedHistory: (): Promise<{ success: boolean }> => ipcRenderer.invoke('clear-saved-history'),
  deleteHistoryEntry: (id: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('delete-history-entry', id),
  writeToClipboard: (text: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('write-to-clipboard', text),
  captureScreenshot: (): Promise<{ success: boolean; imageData?: string; error?: string }> =>
    ipcRenderer.invoke('capture-screenshot'),
  analyzeScreenshot: (
    imageData: string
  ): Promise<{
    success: boolean
    isQuestion?: boolean
    questionText?: string
    questionType?: 'leetcode' | 'system-design' | 'other'
    error?: string
    message?: string
  }> => ipcRenderer.invoke('analyze-screenshot', imageData),
  callSessionApi: (payload: {
    sessionDuration: number
    timestamp: number
    [key: string]: unknown
  }): Promise<{ success: boolean; data?: unknown; error?: string; skipped?: boolean }> =>
    ipcRenderer.invoke('call-session-api', payload),
  onTranscript: (callback: (event: TranscriptEvent) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: TranscriptEvent): void =>
      callback(data)
    ipcRenderer.on('transcript', handler)
    return () => ipcRenderer.removeListener('transcript', handler)
  },

  onUtteranceEnd: (callback: () => void): (() => void) => {
    const handler = (): void => callback()
    ipcRenderer.on('utterance-end', handler)
    return () => ipcRenderer.removeListener('utterance-end', handler)
  },

  onSpeechStarted: (callback: () => void): (() => void) => {
    const handler = (): void => callback()
    ipcRenderer.on('speech-started', handler)
    return () => ipcRenderer.removeListener('speech-started', handler)
  },

  onQuestionDetected: (callback: (question: DetectedQuestion) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: DetectedQuestion): void =>
      callback(data)
    ipcRenderer.on('question-detected', handler)
    return () => ipcRenderer.removeListener('question-detected', handler)
  },

  onQuestionNotDetectedByModel: (callback: (data: { text: string }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { text: string }): void =>
      callback(data)
    ipcRenderer.on('question-not-detected-by-model', handler)
    return () => ipcRenderer.removeListener('question-not-detected-by-model', handler)
  },

  onAnswerStream: (callback: (chunk: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, chunk: string): void => callback(chunk)
    ipcRenderer.on('answer-stream', handler)
    return () => ipcRenderer.removeListener('answer-stream', handler)
  },

  onAnswerComplete: (callback: (answer: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, answer: string): void => callback(answer)
    ipcRenderer.on('answer-complete', handler)
    return () => ipcRenderer.removeListener('answer-complete', handler)
  },

  onAnswerTruncated: (callback: () => void): (() => void) => {
    const handler = (): void => callback()
    ipcRenderer.on('answer-truncated', handler)
    return () => ipcRenderer.removeListener('answer-truncated', handler)
  },

  onCaptureError: (callback: (error: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, error: string): void => callback(error)
    ipcRenderer.on('capture-error', handler)
    return () => ipcRenderer.removeListener('capture-error', handler)
  },

  onAnswerError: (callback: (error: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, error: string): void => callback(error)
    ipcRenderer.on('answer-error', handler)
    return () => ipcRenderer.removeListener('answer-error', handler)
  },

  onScreenshotCaptured: (callback: (data: { imageData: string }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { imageData: string }): void =>
      callback(data)
    ipcRenderer.on('screenshot-captured', handler)
    return () => ipcRenderer.removeListener('screenshot-captured', handler)
  },

  onQuestionDetectedFromImage: (
    callback: (question: DetectedQuestionFromImage) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      question: DetectedQuestionFromImage
    ): void => callback(question)
    ipcRenderer.on('question-detected-from-image', handler)
    return () => ipcRenderer.removeListener('question-detected-from-image', handler)
  },

  onScreenshotNoQuestion: (callback: (data: { message: string }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { message: string }): void =>
      callback(data)
    ipcRenderer.on('screenshot-no-question', handler)
    return () => ipcRenderer.removeListener('screenshot-no-question', handler)
  },

  onGenerationStart: (callback: () => void): (() => void) => {
    const handler = (): void => callback()
    ipcRenderer.on('generation-start', handler)
    return () => ipcRenderer.removeListener('generation-start', handler)
  },

  onGenerationEnd: (callback: () => void): (() => void) => {
    const handler = (): void => callback()
    ipcRenderer.on('generation-end', handler)
    return () => ipcRenderer.removeListener('generation-end', handler)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
