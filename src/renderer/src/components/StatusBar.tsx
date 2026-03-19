import { AlertCircle, Camera, Loader2, MicOff, Monitor, Volume2 } from 'lucide-react'
import { useInterview } from '../hooks/useInterview'

export function StatusBar(): React.JSX.Element {
  const {
    isCapturing,
    isSpeaking,
    isGenerating,
    isProcessingScreenshot,
    error,
    isSessionActive,
    startInterview,
    stopInterview,
    captureAndAnalyzeScreenshot
  } = useInterview()

  const getStatusText = (): string => {
    if (error) return 'Error'
    if (isProcessingScreenshot) return 'Analyzing screenshot...'
    if (isGenerating) return 'Generating answer...'
    if (isSpeaking) return 'Listening...'
    if (isCapturing) {
      return 'Listening to interviewer (Speakers/Loopback)'
    }
    return 'Click Start to begin'
  }

  const getStatusColor = (): string => {
    if (error) return 'text-red-400'
    if (isProcessingScreenshot) return 'text-orange-400'
    if (isGenerating) return 'text-purple-400'
    if (isSpeaking) return 'text-green-400'
    if (isCapturing) return 'text-blue-400'
    return 'text-dark-400'
  }

  const handleStart = (): void => {
    startInterview()
  }

  return (
    <div className="border-b border-white/5 px-4 py-3">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div
            className={`relative flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl border ${
              isCapturing
                ? 'border-cyan-400/20 bg-cyan-400/10'
                : 'border-white/5 bg-white/[0.04]'
            } ${isCapturing ? 'animate-pulse' : ''}`}
          >
            {isCapturing ? (
              <Volume2 className={`w-5 h-5 ${isSpeaking ? 'text-green-400' : 'text-blue-400'}`} />
            ) : (
              <MicOff className="w-5 h-5 text-dark-500" />
            )}
            {isSpeaking && (
              <span className="absolute -top-1 -right-1 w-2 h-2 bg-green-400 rounded-full animate-ping" />
            )}
          </div>
          <div className="flex flex-col min-w-0">
            <span className={`truncate text-sm font-medium ${getStatusColor()}`}>
              {getStatusText()}
            </span>
            <span className="text-xs text-dark-500">
              {isSessionActive
                ? 'Session armed for live prompts'
                : 'Start a session to enable capture and answers'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={captureAndAnalyzeScreenshot}
            disabled={!isSessionActive || isProcessingScreenshot || isGenerating}
            className={`
              flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-medium transition-all
              flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed
              ${
                isProcessingScreenshot
                  ? 'border-amber-400/20 bg-amber-400/12 text-amber-300'
                  : 'border-white/5 bg-white/[0.04] text-dark-300 hover:border-white/10 hover:bg-white/[0.08] hover:text-dark-100'
              }
            `}
            title="Capture screenshot and analyze for interview questions"
          >
            {isProcessingScreenshot ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Analyzing</span>
              </>
            ) : (
              <>
                <Camera className="w-4 h-4" />
                <span>Screenshot</span>
              </>
            )}
          </button>

          <button
            onClick={isCapturing ? stopInterview : handleStart}
            disabled={!isSessionActive || isGenerating || isProcessingScreenshot}
            className={`
              flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-sm font-medium transition-all
              flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed
              shadow-lg
              ${
                isCapturing
                  ? 'border-red-400/20 bg-red-500/12 text-red-300 hover:bg-red-500/18'
                  : 'border-cyan-400/25 bg-gradient-to-r from-cyan-400 to-teal-400 text-slate-950 hover:from-cyan-300 hover:to-teal-300 shadow-cyan-950/30'
              }
            `}
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Processing</span>
              </>
            ) : isCapturing ? (
              <>
                <MicOff className="w-4 h-4" />
                <span>Stop</span>
              </>
            ) : (
              <>
                <Monitor className="w-4 h-4" />
                <span>Start</span>
              </>
            )}
          </button>
        </div>
      </div>

      {!isCapturing && (
        <p className="mt-3 text-center text-xs text-dark-500">
          Speakers mode captures the interviewer's voice from system output or loopback
        </p>
      )}

      {error && (
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  )
}
