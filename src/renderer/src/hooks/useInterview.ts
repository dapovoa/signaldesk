import { useCallback } from 'react'
import { useInterviewStore } from '../store/interviewStore'
import { useAudioCapture } from './useAudioCapture'

type InterviewStateSnapshot = ReturnType<typeof useInterviewStore.getState>
type AudioCaptureSnapshot = ReturnType<typeof useAudioCapture>

interface UseInterviewResult {
  isCapturing: boolean
  isGenerating: boolean
  isSpeaking: boolean
  isProcessingScreenshot: boolean
  transcripts: InterviewStateSnapshot['transcripts']
  currentTranscript: string
  answers: InterviewStateSnapshot['answers']
  currentAnswer: string
  currentQuestion: string
  currentAnswerTruncated: boolean
  manualAssistSuggested: boolean
  settings: InterviewStateSnapshot['settings']
  error: string | null
  audioSource: AudioCaptureSnapshot['audioSource']
  isSessionActive: boolean
  startInterview: () => Promise<void>
  stopInterview: () => Promise<void>
  clearHistory: () => Promise<void>
  captureAndAnalyzeScreenshot: () => Promise<void>
  generateAnswerManually: () => Promise<void>
}

export function useInterview(): UseInterviewResult {
  const {
    isCapturing: storeCapturing,
    isGenerating,
    isSpeaking,
    isProcessingScreenshot,
    transcripts,
    currentTranscript,
    answers,
    currentAnswer,
    currentQuestion,
    currentAnswerTruncated,
    manualAssistSuggested,
    settings,
    error,
    isSessionActive,
    setCapturing,
    setError,
    setManualAssistSuggested,
    setProcessingScreenshot,
    clearAll
  } = useInterviewStore()

  const {
    isCapturing: audioCapturing,
    error: audioError,
    audioSource,
    startCapture: startAudioCapture,
    stopCapture: stopAudioCapture
  } = useAudioCapture()

  const startInterview = useCallback(async () => {
    setError(null)
    try {
      const started = await startAudioCapture()
      if (!started) {
        setCapturing(false)
        return
      }

      clearAll()
      setCapturing(true)
    } catch (err) {
      setCapturing(false)
      throw err
    }
  }, [startAudioCapture, setError, clearAll, setCapturing])

  const stopInterview = useCallback(async () => {
    await stopAudioCapture()
    setCapturing(false)
  }, [stopAudioCapture, setCapturing])

  const clearHistory = useCallback(async () => {
    try {
      await window.api.clearHistory()
      clearAll()
    } catch (err) {
      console.error('Failed to clear history:', err)
    }
  }, [clearAll])

  const generateAnswerManually = useCallback(async () => {
    const state = useInterviewStore.getState()
    const transcriptText = [
      ...state.transcripts.slice(-4).map((entry) => entry.text.trim()),
      state.currentTranscript.trim()
    ]
      .filter(Boolean)
      .join(' ')
      .trim()

    if (!transcriptText) {
      setError('No question detected yet')
      return
    }

    try {
      setError(null)
      setManualAssistSuggested(false)
      await window.api.generateAnswerManually(transcriptText)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to generate answer'
      setError(errorMessage)
      console.error('Manual answer generation error:', err)
    }
  }, [setError, setManualAssistSuggested])

  const captureAndAnalyzeScreenshot = useCallback(async () => {
    try {
      setError(null)
      setProcessingScreenshot(true)

      const captureResult = await window.api.captureScreenshot()

      if (!captureResult.success || !captureResult.imageData) {
        if (captureResult.error === 'Screenshot canceled') {
          return
        }
        throw new Error(captureResult.error || 'Failed to capture screenshot')
      }

      const analysisResult = await window.api.analyzeScreenshot(captureResult.imageData)

      if (!analysisResult.success) {
        throw new Error(analysisResult.error || 'Failed to analyze screenshot')
      }

      if (!analysisResult.isQuestion) {
        setError(analysisResult.message || 'No interview question detected in the screenshot')
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to process screenshot'
      if (errorMessage === 'Screenshot canceled') {
        return
      }
      setError(errorMessage)
      console.error('Screenshot capture/analysis error:', err)
    } finally {
      setProcessingScreenshot(false)
    }
  }, [setError, setProcessingScreenshot])

  return {
    isCapturing: storeCapturing || audioCapturing,
    isGenerating,
    isSpeaking,
    isProcessingScreenshot,
    transcripts,
    currentTranscript,
    answers,
    currentAnswer,
    currentQuestion,
    currentAnswerTruncated,
    manualAssistSuggested,
    settings,
    error: error || audioError,
    audioSource,
    isSessionActive,
    startInterview,
    stopInterview,
    clearHistory,
    captureAndAnalyzeScreenshot,
    generateAnswerManually
  }
}
