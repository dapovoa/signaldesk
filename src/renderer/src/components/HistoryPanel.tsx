import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  History,
  Search,
  Trash2,
  X
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AnswerEntry } from '../store/interviewStore'
import { MarkdownRenderer } from './MarkdownRenderer'

interface HistoryPanelProps {
  onClose: () => void
}

export function HistoryPanel({ onClose }: HistoryPanelProps): React.JSX.Element {
  const [history, setHistory] = useState<AnswerEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedQuestions, setExpandedQuestions] = useState<Record<string, boolean>>({})
  const [currentSession, setCurrentSession] = useState(1)
  const [existingSessions, setExistingSessions] = useState<number[]>([])
  const [sessionsLoaded, setSessionsLoaded] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    loadExistingSessions()
    loadSession()
  }, [])

  const loadSession = async (): Promise<void> => {
    try {
      const session = await window.api.getHistorySession()
      setCurrentSession(session)
      await loadHistory(session)
    } catch (err) {
      console.error('Failed to load session:', err)
      await loadHistory(1)
    }
  }

  const loadHistory = async (session: number): Promise<void> => {
    try {
      setLoading(true)
      await window.api.setHistorySession(session)
      const savedHistory = await window.api.getHistory()
      setHistory(savedHistory)
      const allExpanded: Record<string, boolean> = {}
      savedHistory.forEach((entry) => {
        allExpanded[entry.id] = false
      })
      setExpandedQuestions(allExpanded)
    } catch (err) {
      console.error('Failed to load history:', err)
    } finally {
      setLoading(false)
    }
  }

  const loadExistingSessions = async (): Promise<void> => {
    try {
      const sessions = await window.api.getHistoryExistingSessions()
      setExistingSessions(sessions)
      setSessionsLoaded(true)
    } catch (err) {
      console.error('Failed to load existing sessions:', err)
      setExistingSessions([1])
      setSessionsLoaded(true)
    }
  }

  const handlePrevSession = async (): Promise<void> => {
    if (existingSessions.length === 0) return
    const minSession = Math.min(...existingSessions)
    if (currentSession <= minSession) return
    const prev = currentSession - 1
    await handleSessionChange(prev)
  }

  const handleNextSession = async (): Promise<void> => {
    if (existingSessions.length === 0) return
    const maxSession = Math.max(...existingSessions)
    if (currentSession >= maxSession) return
    const next = currentSession + 1
    await handleSessionChange(next)
  }

  const handleSessionChange = async (session: number): Promise<void> => {
    setCurrentSession(session)
    await loadHistory(session)
  }

  const filteredHistory = useMemo(() => {
    if (!searchQuery.trim()) {
      return history
    }
    const query = searchQuery.toLowerCase()
    return history.filter(
      (entry) =>
        entry.question.toLowerCase().includes(query) || entry.answer.toLowerCase().includes(query)
    )
  }, [history, searchQuery])

  const deleteEntry = async (id: string): Promise<void> => {
    try {
      await window.api.deleteHistoryEntry(id)
      setHistory((prev) => prev.filter((entry) => entry.id !== id))
    } catch (err) {
      console.error('Failed to delete entry:', err)
    }
  }

  const clearAllHistory = async (): Promise<void> => {
    if (!confirm('Are you sure you want to clear all history? This action cannot be undone.')) {
      return
    }
    try {
      await window.api.clearSavedHistory()
      setHistory([])
    } catch (err) {
      console.error('Failed to clear history:', err)
    }
  }

  const formatDate = (timestamp: number): string => {
    const date = new Date(timestamp)
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const entryDate = new Date(date.getFullYear(), date.getMonth(), date.getDate())

    if (entryDate.getTime() === today.getTime()) {
      return `Today at ${date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit'
      })}`
    }

    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)

    if (entryDate.getTime() === yesterday.getTime()) {
      return `Yesterday at ${date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit'
      })}`
    }

    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: entryDate.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const toggleQuestion = (id: string): void => {
    setExpandedQuestions((prev) => ({
      ...prev,
      [id]: !prev[id]
    }))
  }

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-dark-950/72 backdrop-blur-md">
        <div className="panel-glass-strong flex h-64 w-[90vw] max-w-4xl flex-col items-center justify-center rounded-[28px]">
          <div className="mb-3 flex gap-1">
            <span
              className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-400"
              style={{ animationDelay: '0ms' }}
            />
            <span
              className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-400"
              style={{ animationDelay: '150ms' }}
            />
            <span
              className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-400"
              style={{ animationDelay: '300ms' }}
            />
          </div>
          <p className="text-sm text-dark-400">Loading history...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-dark-950/72 backdrop-blur-md">
      <div className="panel-glass-strong flex h-[85vh] w-[90vw] max-w-4xl flex-col overflow-hidden rounded-[28px]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/5 bg-white/[0.03] px-4 py-3">
          <div className="flex items-center gap-3">
            <History className="h-4 w-4 text-cyan-300" />
            <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-dark-300">
              History
            </span>
            <div className="ml-2 flex items-center gap-1 rounded-xl border border-white/5 bg-white/[0.04] px-1.5 py-1">
              <button
                onClick={() => void handlePrevSession()}
                disabled={!sessionsLoaded}
                className={`rounded-md p-1 transition-colors ${
                  sessionsLoaded && currentSession > Math.min(...existingSessions, 1)
                    ? 'text-dark-500 hover:bg-white/5 hover:text-dark-300'
                    : 'text-dark-700 cursor-not-allowed'
                }`}
              >
                <ChevronLeft size={16} />
              </button>
              {Array.from({ length: 3 }, (_, i) => i + 1).map((s) => {
                const exists = existingSessions.includes(s)
                return (
                  <button
                    key={s}
                    onClick={() => exists && void handleSessionChange(s)}
                    disabled={!sessionsLoaded || !exists}
                    className={`rounded-md px-2 py-0.5 text-xs font-medium transition-colors ${
                      currentSession === s
                        ? 'bg-cyan-400/18 text-cyan-300'
                        : exists
                          ? 'text-dark-500 hover:bg-white/5 hover:text-dark-300'
                          : 'text-dark-700 cursor-not-allowed'
                    }`}
                  >
                    {s}
                  </button>
                )
              })}
              <button
                onClick={() => void handleNextSession()}
                disabled={!sessionsLoaded}
                className={`rounded-md p-1 transition-colors ${
                  sessionsLoaded && currentSession < Math.max(...existingSessions, 1)
                    ? 'text-dark-500 hover:bg-white/5 hover:text-dark-300'
                    : 'text-dark-700 cursor-not-allowed'
                }`}
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {history.length > 0 && (
              <button
                onClick={clearAllHistory}
                className="flex items-center gap-1 rounded-xl border border-white/5 bg-white/[0.04] px-2.5 py-1.5 text-xs text-dark-400 transition-colors hover:border-red-400/15 hover:bg-red-500/10 hover:text-red-300"
                title="Clear all history"
              >
                <Trash2 className="w-3 h-3" />
                <span>Clear All</span>
              </button>
            )}
            <button
              onClick={onClose}
              className="rounded-xl border border-white/5 bg-white/[0.04] p-2 text-dark-400 transition-colors hover:border-white/10 hover:bg-white/[0.08] hover:text-dark-200"
              title="Close history"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Search bar */}
        {history.length > 0 && (
          <div className="border-b border-white/5 px-4 py-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 transform text-dark-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search questions and answers..."
                className="w-full rounded-xl border border-white/5 bg-white/[0.04] py-2 pl-10 pr-10 text-sm text-dark-100 placeholder-dark-500 transition-colors focus:border-cyan-400/15 focus:bg-white/[0.08] focus:outline-none"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 transform rounded p-1 hover:bg-white/[0.08]"
                  type="button"
                >
                  <X size={12} className="text-dark-500" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* History list */}
        <div
          ref={scrollRef}
          className="custom-scrollbar flex-1 space-y-4 overflow-y-auto px-4 py-4"
        >
          {history.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center py-8 text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-3xl border border-cyan-400/10 bg-cyan-400/8">
                <History className="h-8 w-8 text-cyan-300/80" />
              </div>
              <p className="mt-1 text-sm text-dark-400">No history yet</p>
              <p className="mt-1 text-xs text-dark-500">
                Start an interview to see your Q&amp;A pairs here
              </p>
            </div>
          ) : filteredHistory.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center py-8 text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-3xl border border-cyan-400/10 bg-cyan-400/8">
                <Search className="h-8 w-8 text-cyan-300/80" />
              </div>
              <p className="mt-1 text-sm text-dark-400">No results found</p>
              <p className="mt-1 text-xs text-dark-500">Try a different search term</p>
            </div>
          ) : (
            filteredHistory.map((entry) => {
              const isQuestionExpanded = Boolean(expandedQuestions[entry.id])

              return (
                <div
                  key={entry.id}
                  className="overflow-hidden rounded-[24px] border border-white/[0.05] bg-white/[0.035] shadow-[0_16px_48px_rgba(0,0,0,0.16)]"
                >
                  <div className="bg-white/[0.03] px-4 py-3">
                    <div className="relative text-left">
                      <p className="flex min-w-0 flex-1 items-start gap-2 pr-6 text-[14px] font-medium leading-5 text-dark-300">
                        <span className="text-[11px] uppercase tracking-[0.14em] text-dark-500">
                          Q:
                        </span>
                        <span
                          className={`min-w-0 flex-1 text-dark-200 ${isQuestionExpanded ? 'block whitespace-normal' : 'truncate'}`}
                        >
                          {entry.question}
                        </span>
                      </p>
                      <button
                        onClick={() => toggleQuestion(entry.id)}
                        className="absolute right-0 top-0 rounded-md p-1 text-dark-500 transition-colors hover:bg-white/[0.08] hover:text-cyan-300"
                        title={isQuestionExpanded ? 'Collapse question' : 'Expand question'}
                        type="button"
                      >
                        {isQuestionExpanded ? (
                          <ChevronUp className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-1 text-xs text-dark-500">
                        <Clock className="h-3 w-3" />
                        <span>{formatDate(entry.timestamp)}</span>
                      </div>
                      <button
                        onClick={() => void deleteEntry(entry.id)}
                        className="rounded-lg p-1 text-dark-500 transition-colors hover:bg-red-500/10 hover:text-red-300"
                        title="Delete entry"
                        type="button"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                  <div className="p-4">
                    <div className="reading-font max-w-none text-[16px] font-normal leading-7 tracking-[0.01em] text-dark-100">
                      <MarkdownRenderer content={entry.answer} />
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
