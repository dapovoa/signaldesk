import { create } from 'zustand'
import type {
  AnswerEntry,
  AppSettings,
  AvatarIndexStatus,
  AvatarProfile,
  AvatarReindexProgress
} from '../../../shared/contracts'
export type {
  AnswerEntry,
  AppSettings,
  AvatarIndexStatus,
  AvatarProfile,
  AvatarReindexProgress
} from '../../../shared/contracts'

export interface TranscriptEntry {
  id: string
  text: string
  timestamp: number
  isFinal: boolean
}

interface InterviewState {
  // Status
  isCapturing: boolean
  isConnected: boolean
  isSpeaking: boolean
  isGenerating: boolean
  isProcessingScreenshot: boolean

  // Transcripts
  transcripts: TranscriptEntry[]
  currentTranscript: string

  // Answers
  answers: AnswerEntry[]
  currentAnswer: string
  currentQuestion: string
  currentAnswerTruncated: boolean
  manualAssistSuggested: boolean

  // Settings
  settings: AppSettings
  showSettings: boolean
  avatarProfile: AvatarProfile
  avatarIndexStatus: AvatarIndexStatus | null
  avatarReindexProgress: AvatarReindexProgress | null
  showAvatar: boolean

  // History view
  showHistory: boolean
  isTranscriptHidden: boolean

  // Session timer
  isSessionActive: boolean
  sessionStartTime: number | null
  sessionElapsedTime: number // in milliseconds

  // Errors
  error: string | null

  // Actions
  setCapturing: (isCapturing: boolean) => void
  setConnected: (isConnected: boolean) => void
  setSpeaking: (isSpeaking: boolean) => void
  setGenerating: (isGenerating: boolean) => void
  setProcessingScreenshot: (processing: boolean) => void

  addTranscript: (entry: TranscriptEntry) => void
  setCurrentTranscript: (text: string) => void
  clearTranscripts: () => void

  addAnswer: (entry: AnswerEntry) => void
  updateCurrentAnswer: (chunk: string) => void
  markCurrentAnswerTruncated: () => void
  setCurrentQuestion: (question: string) => void
  setManualAssistSuggested: (value: boolean) => void
  finalizeAnswer: (finalAnswer?: string) => void | Promise<void>
  clearAnswers: () => void

  setSettings: (settings: AppSettings) => void
  updateSettings: (updates: Partial<AppSettings>) => void
  setShowSettings: (show: boolean) => void
  setAvatarProfile: (profile: AvatarProfile) => void
  updateAvatarProfile: (updates: Partial<AvatarProfile>) => void
  setAvatarIndexStatus: (status: AvatarIndexStatus | null) => void
  setAvatarReindexProgress: (progress: AvatarReindexProgress | null) => void
  setShowAvatar: (show: boolean) => void

  setShowHistory: (show: boolean) => void
  setTranscriptHidden: (hidden: boolean) => void

  // Session timer actions
  startSession: () => void
  endSession: () => void
  updateSessionTime: (elapsedTime: number) => void

  setError: (error: string | null) => void
  clearAll: () => void
}

const DEFAULT_SETTINGS: AppSettings = {
  transcriptionProvider: 'assemblyai',
  transcriptionApiKey: '',
  assemblyAiSpeechModel: 'universal-streaming-multilingual',
  assemblyAiLanguageDetection: true,
  assemblyAiMinTurnSilence: 160,
  assemblyAiMaxTurnSilence: 1280,
  assemblyAiKeytermsPrompt: '',
  assemblyAiPrompt: '',
  llmProvider: 'openai',
  llmAuthMode: 'api-key',
  llmApiKey: '',
  llmOauthToken: '',
  llmOauthRefreshToken: '',
  llmOauthExpiresAt: 0,
  llmOauthAccountId: '',
  llmBaseUrl: '',
  llmCustomHeaders: '',
  llmModel: 'gpt-4o-mini',
  llamaBinDir: '',
  transcriptionLanguage: 'auto',
  alwaysOnTop: true,
  windowOpacity: 1.0,
  pauseThreshold: 1500,
  captureSourceId: '',
  captureSourceType: 'auto'
}

const DEFAULT_IDENTITY_BASE = ``

const DEFAULT_AVATAR_PROFILE: AvatarProfile = {
  id: 'default',
  identityBase: DEFAULT_IDENTITY_BASE,
  cvSummary: '',
  jobTitle: '',
  companyName: '',
  jobDescription: '',
  companyContext: '',
  sourceDirectory: '',
  embeddingModel: '',
  embeddingModelDir: '',
  updatedAt: 0
}

export const useInterviewStore = create<InterviewState>((set, get) => ({
  // Initial state
  isCapturing: false,
  isConnected: false,
  isSpeaking: false,
  isGenerating: false,
  isProcessingScreenshot: false,

  transcripts: [],
  currentTranscript: '',

  answers: [],
  currentAnswer: '',
  currentQuestion: '',
  currentAnswerTruncated: false,
  manualAssistSuggested: false,

  settings: DEFAULT_SETTINGS,
  showSettings: false,
  avatarProfile: DEFAULT_AVATAR_PROFILE,
  avatarIndexStatus: null,
  avatarReindexProgress: null,
  showAvatar: false,
  showHistory: false,
  isTranscriptHidden: false,

  isSessionActive: false,
  sessionStartTime: null,
  sessionElapsedTime: 0,

  error: null,

  // Actions
  setCapturing: (isCapturing) => set({ isCapturing }),
  setConnected: (isConnected) => set({ isConnected }),
  setSpeaking: (isSpeaking) => set({ isSpeaking }),
  setGenerating: (isGenerating) => set({ isGenerating }),
  setProcessingScreenshot: (processing) => set({ isProcessingScreenshot: processing }),

  addTranscript: (entry) =>
    set((state) => ({
      transcripts: [...state.transcripts.slice(-50), entry] // Keep last 50 entries
    })),

  setCurrentTranscript: (text) => set({ currentTranscript: text }),

  clearTranscripts: () => set({ transcripts: [], currentTranscript: '' }),

  addAnswer: (entry) =>
    set((state) => ({
      answers: [...state.answers, entry],
      currentAnswer: '',
      currentQuestion: entry.question,
      currentAnswerTruncated: Boolean(entry.truncated),
      manualAssistSuggested: false
    })),

  updateCurrentAnswer: (chunk) =>
    set((state) => ({
      currentAnswer: state.currentAnswer + chunk,
      isGenerating: true,
      manualAssistSuggested: false
    })),

  markCurrentAnswerTruncated: () => set({ currentAnswerTruncated: true }),

  setCurrentQuestion: (question) =>
    set({ currentQuestion: question, currentAnswerTruncated: false, manualAssistSuggested: false }),

  setManualAssistSuggested: (value) => set({ manualAssistSuggested: value }),

  finalizeAnswer: async (finalAnswer) => {
    const state = get()
    const answerText = (finalAnswer ?? state.currentAnswer).trim()

    if (answerText && state.currentQuestion) {
      const entry: AnswerEntry = {
        id: Date.now().toString(),
        question: state.currentQuestion,
        answer: answerText,
        timestamp: Date.now(),
        isStreaming: false,
        truncated: state.currentAnswerTruncated
      }
      set((state) => ({
        answers: [...state.answers.slice(-20), entry], // Keep last 20 answers
        currentAnswer: '',
        currentQuestion: '',
        currentAnswerTruncated: false,
        manualAssistSuggested: false,
        isGenerating: false
      }))
      // Save to history
      try {
        await window.api.saveHistoryEntry(entry)
      } catch (err) {
        console.error('Failed to save history entry:', err)
      }
    } else {
      set({ isGenerating: false, currentAnswerTruncated: false })
    }
  },

  clearAnswers: () =>
    set({
      answers: [],
      currentAnswer: '',
      currentQuestion: '',
      currentAnswerTruncated: false,
      manualAssistSuggested: false
    }),

  setSettings: (settings) => set({ settings }),

  updateSettings: (updates) =>
    set((state) => ({
      settings: { ...state.settings, ...updates }
    })),

  setShowSettings: (show) => set({ showSettings: show }),
  setAvatarProfile: (avatarProfile) => set({ avatarProfile }),
  updateAvatarProfile: (updates) =>
    set((state) => ({
      avatarProfile: { ...state.avatarProfile, ...updates }
    })),
  setAvatarIndexStatus: (avatarIndexStatus) => set({ avatarIndexStatus }),
  setAvatarReindexProgress: (avatarReindexProgress) => set({ avatarReindexProgress }),
  setShowAvatar: (show) => set({ showAvatar: show }),

  setShowHistory: (show) => set({ showHistory: show }),
  setTranscriptHidden: (hidden) => set({ isTranscriptHidden: hidden }),

  startSession: () =>
    set({
      isSessionActive: true,
      sessionStartTime: Date.now(),
      sessionElapsedTime: 0
    }),

  endSession: () =>
    set((state) => ({
      isSessionActive: false,
      // Keep sessionStartTime and sessionElapsedTime frozen
      sessionStartTime: state.sessionStartTime,
      sessionElapsedTime: state.sessionElapsedTime
    })),

  updateSessionTime: (elapsedTime) =>
    set((state) => {
      if (state.isSessionActive) {
        return { sessionElapsedTime: elapsedTime }
      }
      return state
    }),

  setError: (error) => set({ error }),

  clearAll: () =>
    set({
      transcripts: [],
      currentTranscript: '',
      answers: [],
      currentAnswer: '',
      currentQuestion: '',
      currentAnswerTruncated: false,
      manualAssistSuggested: false,
      error: null
    })
}))
