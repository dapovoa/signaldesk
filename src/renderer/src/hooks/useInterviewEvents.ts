import { useEffect, useRef } from 'react'
import { useInterviewStore } from '../store/interviewStore'

/**
 * This hook sets up IPC event listeners ONCE.
 * It should only be called from App.tsx to prevent duplicate listeners.
 */
export function useInterviewEvents() {
  const {
    addTranscript,
    setCurrentTranscript,
    setSpeaking,
    setCurrentQuestion,
    updateCurrentAnswer,
    markCurrentAnswerTruncated,
    setManualAssistSuggested,
    finalizeAnswer,
    setError,
    setCapturing,
    setSettings,
    setAvatarProfile,
    setAvatarIndexStatus,
    setAvatarReindexProgress
  } = useInterviewStore()

  // Use ref to ensure listeners are only set up once
  const listenersSetUp = useRef(false)

  // Load settings on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const [savedSettings, avatarProfile, avatarIndexStatus] = await Promise.all([
          window.api.getSettings(),
          window.api.getAvatarProfile(),
          window.api.getAvatarIndexStatus()
        ])
        setSettings(savedSettings)
        setAvatarProfile(avatarProfile)
        setAvatarIndexStatus(avatarIndexStatus)
      } catch (err) {
        console.error('Failed to load app state:', err)
      }
    }
    loadSettings()
  }, [setAvatarIndexStatus, setAvatarProfile, setSettings])

  // Set up event listeners ONCE
  useEffect(() => {
    // Prevent setting up listeners multiple times
    if (listenersSetUp.current) {
      return
    }
    listenersSetUp.current = true

    console.log('Setting up IPC event listeners (once)')

    const unsubTranscript = window.api.onTranscript((event) => {
      if (event.isFinal) {
        addTranscript({
          id: Date.now().toString(),
          text: event.text,
          timestamp: Date.now(),
          isFinal: true
        })
        setCurrentTranscript('')
      } else {
        setCurrentTranscript(event.text)
      }
    })

    const unsubSpeechStarted = window.api.onSpeechStarted(() => {
      setSpeaking(true)
      setManualAssistSuggested(false)
    })

    const unsubUtteranceEnd = window.api.onUtteranceEnd(() => {
      setSpeaking(false)
    })

    const unsubQuestionDetected = window.api.onQuestionDetected((question) => {
      setManualAssistSuggested(false)
      setCurrentQuestion(question.text)
    })

    const unsubQuestionNotDetectedByModel = window.api.onQuestionNotDetectedByModel(() => {
      const state = useInterviewStore.getState()
      const lastTranscriptAt = state.transcripts[state.transcripts.length - 1]?.timestamp ?? 0
      const lastAnswerAt = state.answers[state.answers.length - 1]?.timestamp ?? 0

      if (
        state.isCapturing &&
        !state.isGenerating &&
        !state.currentQuestion.trim() &&
        !state.currentAnswer.trim() &&
        lastTranscriptAt > lastAnswerAt
      ) {
        setManualAssistSuggested(true)
      }
    })

    const unsubAnswerStream = window.api.onAnswerStream((chunk) => {
      setManualAssistSuggested(false)
      updateCurrentAnswer(chunk)
    })

    const unsubAnswerComplete = window.api.onAnswerComplete((answer) => {
      setManualAssistSuggested(false)
      finalizeAnswer(answer)
    })

    const unsubAnswerTruncated = window.api.onAnswerTruncated(() => {
      markCurrentAnswerTruncated()
    })

    const unsubCaptureError = window.api.onCaptureError((errorMsg) => {
      setManualAssistSuggested(false)
      setError(errorMsg)
      setCapturing(false)
    })

    const unsubAnswerError = window.api.onAnswerError((errorMsg) => {
      setError(`Answer generation failed: ${errorMsg}`)
      finalizeAnswer()
    })

    const unsubQuestionDetectedFromImage = window.api.onQuestionDetectedFromImage((question) => {
      console.log('Question detected from screenshot:', question.text)
      setCurrentQuestion(question.text)
    })

    const unsubScreenshotNoQuestion = window.api.onScreenshotNoQuestion((data) => {
      console.log('No question detected in screenshot:', data.message)
      setError(data.message)
    })

    const unsubAvatarReindexProgress = window.api.onAvatarReindexProgress((progress) => {
      setAvatarReindexProgress(progress)
    })

    return () => {
      console.log('Cleaning up IPC event listeners')
      unsubTranscript()
      unsubSpeechStarted()
      unsubUtteranceEnd()
      unsubQuestionDetected()
      unsubQuestionNotDetectedByModel()
      unsubAnswerStream()
      unsubAnswerComplete()
      unsubAnswerTruncated()
      unsubCaptureError()
      unsubAnswerError()
      unsubQuestionDetectedFromImage()
      unsubScreenshotNoQuestion()
      unsubAvatarReindexProgress()
      listenersSetUp.current = false
    }
  }, [
    addTranscript,
    setCurrentTranscript,
    setSpeaking,
    setCurrentQuestion,
    updateCurrentAnswer,
    markCurrentAnswerTruncated,
    setManualAssistSuggested,
    finalizeAnswer,
    setError,
    setCapturing,
    setAvatarReindexProgress
  ])
}
