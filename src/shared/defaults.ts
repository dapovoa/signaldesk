import type { AppSettings, AssemblyAiSpeechModel, AvatarProfile } from './contracts'

export const AUDIO_SAMPLE_RATE = 16000

export const ASSEMBLYAI_SPEECH_MODEL_DEFAULT: AssemblyAiSpeechModel = 'u3-rt-pro'

export const getAssemblyAiTurnSilenceDefaults = (
  speechModel: AssemblyAiSpeechModel
): { minTurnSilence: number; maxTurnSilence: number } => {
  if (speechModel === 'u3-rt-pro') {
    return { minTurnSilence: 100, maxTurnSilence: 1000 }
  }
  return { minTurnSilence: 400, maxTurnSilence: 1280 }
}

export const getAssemblyAiLanguageDetectionDefault = (
  speechModel: AssemblyAiSpeechModel
): boolean => {
  return speechModel === 'universal-streaming-multilingual'
}

export const DEFAULT_SETTINGS: AppSettings = {
  transcriptionProvider: 'assemblyai',
  transcriptionApiKey: '',
  openaiTranscriptionApiKey: '',
  groqTranscriptionApiKey: '',
  groqTranscriptionModel: '',
  whisperModel: '',
  assemblyAiSpeechModel: ASSEMBLYAI_SPEECH_MODEL_DEFAULT,
  assemblyAiLanguageDetection: false,
  assemblyAiMinTurnSilence: 100,
  assemblyAiMaxTurnSilence: 1000,
  assemblyAiKeytermsPrompt: '',
  assemblyAiPrompt: '',
  llmProvider: 'openai',
  llmAuthMode: 'api-key',
  llmApiKey: '',
  llmOpenAICompatibleApiKey: '',
  llmAnthropicCompatibleApiKey: '',
  llmOauthToken: '',
  llmOauthRefreshToken: '',
  llmOauthExpiresAt: 0,
  llmOauthAccountId: '',
  llmBaseUrl: '',
  llmModel: '',
  llmOpenAIModel: '',
  llmOpenAIOAuthModel: '',
  llmOpenAICompatibleModel: '',
  llmAnthropicCompatibleModel: '',
  llmLlamaCppModel: '',
  llmModelDir: '',
  llmTemperature: 1.0,
  llmTopP: 0.95,
  llmTopK: 64,
  llmRepeatPenalty: null,
  historySession: 1,
  transcriptionLanguage: 'auto',
  alwaysOnTop: true,
  windowOpacity: 1.0,
  pauseThreshold: 1500,
  captureSourceId: '',
  captureSourceType: 'auto'
}

export const DEFAULT_AVATAR_PROFILE: AvatarProfile = {
  id: 'default',
  identityBase: '',
  answerStyle: '',
  jobTitle: '',
  companyName: '',
  jobDescription: '',
  companyContext: '',
  candidateKnowledge: '',
  updatedAt: 0
}

export const OPENAI_TRANSCRIPTION_MODEL_DEFAULT = 'whisper-1'

export const getDefaultTranscriptionModel = (provider: AppSettings['transcriptionProvider']): string => {
  switch (provider) {
    case 'openai':
      return OPENAI_TRANSCRIPTION_MODEL_DEFAULT
    case 'groq':
      return ''
    case 'assemblyai':
      return ''
    default:
      return ''
  }
}
