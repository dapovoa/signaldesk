import { useCallback, useRef, useState } from 'react'
import { AudioCaptureService } from '../services/audioCapture'

interface UseAudioCaptureReturn {
  isCapturing: boolean
  error: string | null
  audioSource: 'system'
  startCapture: (sourceId?: string) => Promise<boolean>
  stopCapture: () => Promise<void>
}

export function useAudioCapture(): UseAudioCaptureReturn {
  const [isCapturing, setIsCapturing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const audioServiceRef = useRef<AudioCaptureService | null>(null)

  const cleanErrorMessage = (err: unknown, fallback: string): string => {
    const raw = err instanceof Error ? err.message : String(err || fallback)

    if (raw.includes("Error invoking remote method 'get-audio-sources'")) {
      return raw.replace(/^Error invoking remote method 'get-audio-sources':\s*/, '')
    }

    if (raw.includes("Error invoking remote method 'start-capture'")) {
      return raw.replace(/^Error invoking remote method 'start-capture':\s*/, '')
    }

    if (raw.includes("Error invoking remote method 'stop-capture'")) {
      return raw.replace(/^Error invoking remote method 'stop-capture':\s*/, '')
    }

    return raw
  }

  const isCaptureCancellation = (message: string): boolean => {
    const lower = message.toLowerCase()

    return (
      lower.includes('audio source selection canceled') ||
      lower.includes('audio source selection cancelled') ||
      lower.includes('permission dismissed') ||
      lower.includes('user canceled') ||
      lower.includes('user cancelled') ||
      lower.includes('selection canceled') ||
      lower.includes('selection cancelled')
    )
  }

  const getSpeakerMonitorDeviceId = useCallback(async (): Promise<string | undefined> => {
    const monitorPatterns = ['monitor', 'loopback', 'stereo mix', 'what u hear', 'output']
    const micPatterns = ['mic', 'microphone', 'headset', 'webcam']

    const findBest = (devices: MediaDeviceInfo[]): MediaDeviceInfo | undefined => {
      const audioInputs = devices.filter((d) => d.kind === 'audioinput')

      const monitor = audioInputs.find((d) => {
        const label = d.label.toLowerCase()
        return monitorPatterns.some((p) => label.includes(p)) && !micPatterns.some((p) => label.includes(p))
      })

      return monitor
    }

    let devices = await navigator.mediaDevices.enumerateDevices()
    let selected = findBest(devices)
    if (selected) return selected.deviceId

    // On Linux/Chromium labels may be hidden before permission is granted.
    const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    tempStream.getTracks().forEach((t) => t.stop())

    devices = await navigator.mediaDevices.enumerateDevices()
    selected = findBest(devices)
    return selected?.deviceId
  }, [])

  const startCapture = useCallback(
    async (sourceId?: string): Promise<boolean> => {
      try {
        setError(null)

        // Start backend capture service first
        await window.api.startCapture()

        // Create and start audio capture
        audioServiceRef.current = new AudioCaptureService({
          sampleRate: 16000,
          channelCount: 1
        })

        // Preferred path: capture from speaker monitor/loopback device.
        const monitorDeviceId = sourceId || (await getSpeakerMonitorDeviceId())
        if (monitorDeviceId) {
          await audioServiceRef.current.startSpeakerMonitorCapture(monitorDeviceId)
        } else {
          // Fallback path for systems where loopback monitor isn't exposed.
          const sourceSelection = await window.api.getAudioSources()
          if (sourceSelection.canceled) {
            return false
          }

          const sources = sourceSelection.sources
          if (sources.length === 0) {
            throw new Error(
              'No speaker monitor device found. Configure a monitor/loopback audio input in PipeWire/PulseAudio.'
            )
          }

          const screenSource = sources.find(
            (s) =>
              s.name.toLowerCase().includes('entire screen') ||
              s.name.toLowerCase().includes('screen 1') ||
              s.name.toLowerCase() === 'screen'
          )
          const targetSourceId = screenSource ? screenSource.id : sources[0].id
          await audioServiceRef.current.startSystemAudioCapture(targetSourceId)
        }

        setIsCapturing(true)
        return true
      } catch (err) {
        const message = cleanErrorMessage(err, 'Failed to start capture')
        const canceled = isCaptureCancellation(message)

        if (canceled) {
          setError(null)
        } else {
          setError(message)
          console.error('Audio capture error:', err)
        }

        // Clean up on error
        if (audioServiceRef.current) {
          await audioServiceRef.current.stop()
          audioServiceRef.current = null
        }
        setIsCapturing(false)

        try {
          await window.api.stopCapture()
        } catch {
          // Ignore stop errors
        }

        return false
      }
    },
    [getSpeakerMonitorDeviceId]
  )

  const stopCapture = useCallback(async () => {
    try {
      // Stop audio capture
      if (audioServiceRef.current) {
        await audioServiceRef.current.stop()
        audioServiceRef.current = null
      }

      // Stop backend service
      await window.api.stopCapture()

      setIsCapturing(false)
      setError(null)
    } catch (err) {
      const message = cleanErrorMessage(err, 'Failed to stop capture')
      setError(message)
      console.error('Stop capture error:', err)
    }
  }, [])

  return {
    isCapturing,
    error,
    startCapture,
    stopCapture,
    audioSource: 'system'
  }
}
