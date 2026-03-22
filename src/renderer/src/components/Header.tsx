import { History, Minus, Pin, PinOff, Play, Settings, Square, UserCircle2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSessionTimer } from '../hooks/useSessionTimer'
import { useInterviewStore } from '../store/interviewStore'

export function Header(): React.JSX.Element {
  const {
    settings,
    setShowSettings,
    setShowAvatar,
    showHistory,
    setShowHistory,
    isSessionActive,
    startSession,
    endSession
  } = useInterviewStore()
  const [isAlwaysOnTop, setIsAlwaysOnTop] = useState(settings.alwaysOnTop)
  const [supportsAlwaysOnTop, setSupportsAlwaysOnTop] = useState(true)
  const [windowWarning, setWindowWarning] = useState('')

  // Initialize session timer hook
  useSessionTimer()

  useEffect(() => {
    setTimeout(() => {
      setIsAlwaysOnTop(settings.alwaysOnTop)
    }, 100)
  }, [settings.alwaysOnTop])

  useEffect(() => {
    const loadWindowCapabilities = async (): Promise<void> => {
      try {
        const capabilities = await window.api.getWindowCapabilities()
        setSupportsAlwaysOnTop(capabilities.supportsAlwaysOnTop)
        setWindowWarning(capabilities.warning)
      } catch (error) {
        console.error('Failed to load window capabilities:', error)
      }
    }

    loadWindowCapabilities()
  }, [])

  const handleMinimize = (): void => {
    window.api.minimizeWindow()
  }

  const handleClose = (): void => {
    window.api.closeWindow()
  }

  const toggleAlwaysOnTop = async (): Promise<void> => {
    const newValue = !isAlwaysOnTop
    await window.api.setAlwaysOnTop(newValue)
    setIsAlwaysOnTop(newValue)
  }

  const handleSessionToggle = (): void => {
    if (isSessionActive) {
      endSession()
    } else {
      startSession()
    }
  }

  return (
    <header className="app-drag flex items-center justify-between border-b border-white/5 px-4 py-3 select-none">
      <div className="app-no-drag flex items-center gap-3">
        <button
          onClick={handleSessionToggle}
          className={`
            flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-medium transition-all
            ${
              isSessionActive
                ? 'border-red-400/20 bg-red-500/12 text-red-300 hover:bg-red-500/18'
                : 'border-cyan-400/20 bg-gradient-to-r from-cyan-500/90 to-teal-500/90 text-slate-950 hover:from-cyan-400 hover:to-teal-400'
            }
          `}
          title={isSessionActive ? 'End Session' : 'Start Session'}
        >
          {isSessionActive ? (
            <>
              <Square size={13} />
              <span className="text-xs font-medium">End Session</span>
            </>
          ) : (
            <>
              <Play size={13} />
              <span className="text-xs font-medium">Start Session</span>
            </>
          )}
        </button>
      </div>

      <div className="app-no-drag flex items-center gap-2">
        <button
          onClick={() => setShowHistory(!showHistory)}
          className={`rounded-xl border p-2 transition-colors ${
            showHistory
              ? 'border-cyan-400/20 bg-cyan-400/10 text-cyan-300'
              : 'border-white/5 bg-white/[0.04] text-dark-400 hover:border-cyan-400/15 hover:bg-cyan-400/8 hover:text-cyan-300'
          }`}
          title={showHistory ? 'Show current session' : 'Show history'}
        >
          <History size={14} />
        </button>

        <button
          onClick={supportsAlwaysOnTop ? toggleAlwaysOnTop : undefined}
          disabled={!supportsAlwaysOnTop}
          className={`rounded-xl border p-2 transition-colors ${
            supportsAlwaysOnTop
              ? `${isAlwaysOnTop ? 'border-cyan-400/20 bg-cyan-400/10 text-cyan-300' : 'border-white/5 bg-white/[0.04] text-dark-400 hover:border-cyan-400/15 hover:bg-cyan-400/8'}`
              : 'border-white/5 bg-white/[0.03] text-dark-600 opacity-50 cursor-not-allowed'
          }`}
          title={
            supportsAlwaysOnTop
              ? isAlwaysOnTop
                ? 'Unpin window'
                : 'Keep window on top'
              : windowWarning || 'Always on top is unavailable on this desktop session'
          }
        >
          {isAlwaysOnTop ? <Pin size={14} /> : <PinOff size={14} />}
        </button>

        <button
          onClick={() => setShowAvatar(true)}
          className="rounded-xl border border-white/5 bg-white/[0.04] p-2 text-dark-400 transition-colors hover:border-white/10 hover:bg-white/[0.08] hover:text-dark-200"
          title="Avatar"
        >
          <UserCircle2 size={14} />
        </button>

        <button
          onClick={() => setShowSettings(true)}
          className="rounded-xl border border-white/5 bg-white/[0.04] p-2 text-dark-400 transition-colors hover:border-white/10 hover:bg-white/[0.08] hover:text-dark-200"
          title="Settings"
        >
          <Settings size={14} />
        </button>

        <button
          onClick={handleMinimize}
          className="rounded-xl border border-white/5 bg-white/[0.04] p-2 text-dark-400 transition-colors hover:border-white/10 hover:bg-white/[0.08] hover:text-dark-200"
          title="Minimize"
        >
          <Minus size={14} />
        </button>

        <button
          onClick={handleClose}
          className="rounded-xl border border-white/5 bg-white/[0.04] p-2 text-dark-400 transition-colors hover:border-red-400/20 hover:bg-red-500/12 hover:text-red-300"
          title="Close"
        >
          <X size={14} />
        </button>
      </div>
    </header>
  )
}
