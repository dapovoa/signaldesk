import { Check, Copy, Sparkles, Trash2, Wand2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useInterview } from '../hooks/useInterview'
import { MarkdownRenderer } from './MarkdownRenderer'

export function AnswerPanel(): React.JSX.Element {
  const {
    isCapturing,
    answers,
    currentAnswer,
    currentQuestion,
    currentAnswerTruncated,
    isGenerating,
    clearHistory,
    generateAnswerManually
  } = useInterview()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [answers, currentAnswer])

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

  const hasContent = answers.length > 0 || currentAnswer
  const shouldPulseManualGenerate =
    isCapturing && !isGenerating && !currentQuestion.trim() && !currentAnswer

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-transparent">
      <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-cyan-300" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-dark-300">
            Answers
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={generateAnswerManually}
            disabled={isGenerating}
            className={`group relative flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-cyan-200 transition-colors hover:border-cyan-300/25 hover:bg-cyan-400/12 hover:text-cyan-100 disabled:cursor-not-allowed disabled:opacity-60 ${
              shouldPulseManualGenerate
                ? 'animate-pulse border-cyan-300/35 bg-cyan-400/18 shadow-[0_0_0_4px_rgba(34,211,238,0.14)]'
                : 'border-cyan-400/15 bg-cyan-400/8'
            }`}
            title={
              shouldPulseManualGenerate
                ? 'No question detected yet. Generate from current transcript.'
                : 'Generate answer from the current transcript'
            }
          >
            <span
              className={`relative inline-flex h-5 w-5 items-center justify-center rounded-full ${
                shouldPulseManualGenerate ? 'bg-cyan-300/20' : 'bg-transparent'
              }`}
            >
              {shouldPulseManualGenerate && (
                <span className="absolute inset-0 rounded-full border border-cyan-300/40 animate-ping" />
              )}
              <Wand2 className="relative z-10 w-4 h-4" />
            </span>
            <span className="text-[11px] font-semibold uppercase tracking-[0.16em]">
              {shouldPulseManualGenerate ? 'Generate Now' : 'Assist'}
            </span>
          </button>
          {hasContent && (
            <button
              onClick={clearHistory}
              className="flex items-center gap-1 rounded-xl border border-white/5 bg-white/[0.04] px-2.5 py-1.5 text-xs text-dark-400 transition-colors hover:border-red-400/15 hover:bg-red-500/10 hover:text-red-300"
              title="Clear all answers"
            >
              <Trash2 className="w-3 h-3" />
              <span>Clear</span>
            </button>
          )}
        </div>
      </div>

      <div
        ref={scrollRef}
        className="custom-scrollbar flex-1 space-y-4 overflow-y-auto px-4 py-4"
      >
        {!hasContent ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-8">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-3xl border border-cyan-400/10 bg-cyan-400/8">
              <Sparkles className="h-8 w-8 text-cyan-300/80" />
            </div>
            <p className="text-sm text-dark-400">
              Answers will appear here when questions are detected
            </p>
            <p className="mt-1 text-xs text-dark-500">
              The AI will listen and respond to interview questions
            </p>
          </div>
        ) : (
          <>
            {answers.map((answer) => (
              <div
                key={answer.id}
                className="animate-fade-in overflow-hidden rounded-[22px] bg-white/[0.035]"
              >
                <div className="bg-white/[0.03] px-4 py-3">
                  <p className="flex items-center gap-2 text-sm font-medium leading-6 text-dark-300">
                    <span className="text-[11px] uppercase tracking-[0.12em] text-dark-500">
                      Q:
                    </span>
                    <span className="min-w-0 flex-1 truncate">{answer.question}</span>
                  </p>
                </div>
                <div className="p-4">
                  {answer.truncated && (
                    <p className="mb-3 rounded-lg border border-amber-400/15 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                      Output cut short by the model token limit.
                    </p>
                  )}
                  <MarkdownRenderer content={answer.answer} />
                  <div className="mt-3 flex justify-end">
                    <button
                      onClick={() => copyToClipboard(answer.answer, answer.id)}
                      className="flex items-center gap-1 rounded-xl border border-white/5 bg-white/[0.04] px-2.5 py-1.5 text-xs text-dark-400 transition-colors hover:border-cyan-400/15 hover:bg-cyan-400/8 hover:text-cyan-300"
                    >
                      {copiedId === answer.id ? (
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
            ))}

            {/* Current streaming answer */}
            {(currentAnswer || isGenerating) && (
              <div className="animate-fade-in overflow-hidden rounded-[22px] bg-gradient-to-br from-cyan-400/10 to-teal-400/6">
                {currentQuestion && (
                  <div className="bg-cyan-400/6 px-4 py-3">
                    <p className="flex items-center gap-2 text-sm font-medium leading-6 text-cyan-50">
                      <span className="text-[11px] uppercase tracking-[0.12em] text-cyan-300/80">
                        Q:
                      </span>
                      <span className="min-w-0 flex-1 truncate">{currentQuestion}</span>
                    </p>
                  </div>
                )}
                <div className="p-4">
                  {currentAnswerTruncated && (
                    <p className="mb-3 rounded-lg border border-amber-400/15 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                      Output cut short by the model token limit.
                    </p>
                  )}
                  {currentAnswer ? (
                    <p className="whitespace-pre-wrap text-[15px] leading-6 text-dark-100">
                      {currentAnswer}
                      <span className="ml-1 inline-block h-4 w-0.5 animate-pulse bg-cyan-300" />
                    </p>
                  ) : (
                    <div className="flex items-center gap-2 text-sm text-cyan-300">
                      <div className="flex gap-1">
                        <span
                          className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-300"
                          style={{ animationDelay: '0ms' }}
                        />
                        <span
                          className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-300"
                          style={{ animationDelay: '150ms' }}
                        />
                        <span
                          className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-300"
                          style={{ animationDelay: '300ms' }}
                        />
                      </div>
                      <span>Generating answer...</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
