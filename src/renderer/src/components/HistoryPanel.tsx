import { Check, Clock, Copy, History, Search, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AnswerEntry } from '../store/interviewStore'
import { MarkdownRenderer } from './MarkdownRenderer'

const MAX_HISTORY_LENGTH = 500

interface HistoryPanelProps {
  onClose: () => void
}

export function HistoryPanel({ onClose }: HistoryPanelProps): React.JSX.Element {
  const [history, setHistory] = useState<AnswerEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    loadHistory()
  }, [])

  const loadHistory = async (): Promise<void> => {
    try {
      setLoading(true)
      const savedHistory = await window.api.getHistory()
      setHistory(savedHistory)
    } catch (err) {
      console.error('Failed to load history:', err)
    } finally {
      setLoading(false)
    }
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

  const copyToClipboard = async (text: string, id: string): Promise<void> => {
    try {
      const result = await window.api.writeToClipboard(text)
      if (result.success) {
        setCopiedId(id)
        setTimeout(() => setCopiedId(null), 2000)
      } else {
        console.error('Failed to copy:', result.error)
        // Fallback to browser clipboard API
        try {
          await navigator.clipboard.writeText(text)
          setCopiedId(id)
          setTimeout(() => setCopiedId(null), 2000)
        } catch (fallbackErr) {
          console.error('Fallback clipboard copy failed:', fallbackErr)
        }
      }
    } catch (err) {
      console.error('Failed to copy:', err)
      // Fallback to browser clipboard API
      try {
        await navigator.clipboard.writeText(text)
        setCopiedId(id)
        setTimeout(() => setCopiedId(null), 2000)
      } catch (fallbackErr) {
        console.error('Fallback clipboard copy failed:', fallbackErr)
      }
    }
  }

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

    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-transparent">
      <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-cyan-300" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-dark-300">
            History
          </span>
          {history.length > 0 && (
            <span className="rounded-full border border-white/5 bg-white/[0.04] px-2 py-0.5 text-[11px] text-dark-500">
              {history.length}
            </span>
          )}
          <span className="text-xs text-dark-500">
            Only stores last {MAX_HISTORY_LENGTH} answers on local system.
          </span>
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
              placeholder="Search questions and answers..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-xl border border-white/5 bg-white/[0.04] py-2 pl-10 pr-3 text-sm text-dark-100 placeholder-dark-500 focus:border-cyan-400/15 focus:bg-white/[0.08] focus:outline-none"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 transform rounded p-1 hover:bg-white/[0.08]"
              >
                <X size={12} className="text-dark-500" />
              </button>
            )}
          </div>
        </div>
      )}

      <div
        ref={scrollRef}
        className="custom-scrollbar flex-1 space-y-4 overflow-y-auto px-4 py-4"
      >
        {loading ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-8">
            <div className="flex gap-1 mb-3">
              <span
                className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce"
                style={{ animationDelay: '0ms' }}
              />
              <span
                className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce"
                style={{ animationDelay: '150ms' }}
              />
              <span
                className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce"
                style={{ animationDelay: '300ms' }}
              />
            </div>
            <p className="text-sm text-dark-500">Loading history...</p>
          </div>
        ) : filteredHistory.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-8">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-3xl border border-cyan-400/10 bg-cyan-400/8">
              <History className="h-8 w-8 text-cyan-300/80" />
            </div>
            <p className="text-sm text-dark-500">
              {searchQuery ? 'No results found' : 'No history yet'}
            </p>
            <p className="text-xs text-dark-600 mt-1">
              {searchQuery
                ? 'Try a different search term'
                : 'Your questions and answers will be saved here'}
            </p>
          </div>
        ) : (
          filteredHistory.map((entry) => (
            <div
              key={entry.id}
              className="animate-fade-in overflow-hidden rounded-[22px] border border-white/6 bg-white/[0.035]"
            >
              <div className="border-b border-white/5 bg-white/[0.03] px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <p className="mb-1 text-xs font-medium text-dark-300">Q: {entry.question}</p>
                    <div className="flex items-center gap-1 text-xs text-dark-500">
                      <Clock className="w-3 h-3" />
                      <span>{formatDate(entry.timestamp)}</span>
                    </div>
                  </div>
                  <button
                    onClick={() => deleteEntry(entry.id)}
                    className="rounded-lg p-1 text-dark-500 transition-colors hover:bg-red-500/10 hover:text-red-300"
                    title="Delete entry"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
              <div className="p-4">
                <MarkdownRenderer content={entry.answer} />
                <div className="mt-3 flex justify-end">
                  <button
                    onClick={() => copyToClipboard(entry.answer, entry.id)}
                    className="flex items-center gap-1 rounded-xl border border-white/5 bg-white/[0.04] px-2.5 py-1.5 text-xs text-dark-400 transition-colors hover:border-cyan-400/15 hover:bg-cyan-400/8 hover:text-cyan-300"
                  >
                    {copiedId === entry.id ? (
                      <>
                        <Check className="w-3 h-3" />
                        <span>Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
