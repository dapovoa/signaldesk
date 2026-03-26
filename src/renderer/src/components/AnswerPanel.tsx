import { ChevronDown, ChevronUp, Loader2, Sparkles, Trash2, Wand2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useInterview } from '../hooks/useInterview'
import { MarkdownRenderer } from './MarkdownRenderer'

export function AnswerPanel(): React.JSX.Element {
  const {
    isCapturing,
    answers,
    currentAnswer,
    currentQuestion,
    currentAnswerTruncated,
    manualAssistSuggested,
    isGenerating,
    clearHistory,
    generateAnswerManually
  } = useInterview()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [expandedQuestions, setExpandedQuestions] = useState<Record<string, boolean>>({})

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0
    }
  }, [answers, currentAnswer])

  const reversedAnswers = useMemo(() => [...answers].reverse(), [answers])

  const hasContent = answers.length > 0 || currentAnswer
  const shouldPulseManualGenerate = isCapturing && !isGenerating && manualAssistSuggested
  const willGenerateAnswer = currentQuestion.trim().length > 0 || isGenerating

  const toggleQuestionExpanded = (id: string): void => {
    setExpandedQuestions((prev) => ({
      ...prev,
      [id]: !prev[id]
    }))
  }

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
          <div
            className={`inline-flex items-center justify-center rounded-full p-1 transition-colors ${
              willGenerateAnswer ? 'text-cyan-300' : 'text-dark-500'
            }`}
            title={willGenerateAnswer ? 'Answer recognized and preparing response' : 'Waiting for a detected question'}
          >
            <Loader2 className={`h-4 w-4 ${willGenerateAnswer ? 'animate-spin' : ''}`} />
          </div>
          <button
            onClick={generateAnswerManually}
            disabled={isGenerating}
            className={`inline-flex items-center justify-center rounded-full p-1 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              shouldPulseManualGenerate
                ? 'text-green-400'
                : 'text-dark-500 hover:text-dark-300'
            }`}
            title="Generate answer from the current transcript"
            type="button"
          >
            <Wand2 className={`h-4 w-4 ${shouldPulseManualGenerate ? 'animate-pulse' : ''}`} />
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
            {/* Current streaming answer */}
            {(currentAnswer || isGenerating) && (
              <div className="animate-fade-in overflow-hidden rounded-[24px] border border-cyan-400/10 bg-gradient-to-br from-cyan-400/10 to-teal-400/6 shadow-[0_20px_56px_rgba(14,165,233,0.08)]">
                {currentQuestion && (
                  <div className="bg-cyan-400/6 px-4 py-3">
                    <div className="flex items-start gap-2">
                      <p className="flex min-w-0 flex-1 items-start gap-2 text-[13px] font-medium leading-5 text-cyan-50">
                        <span className="text-[10px] uppercase tracking-[0.14em] text-cyan-300/80">
                          Q:
                        </span>
                        <span
                          className={`min-w-0 flex-1 ${expandedQuestions.current ? 'block' : 'truncate'}`}
                        >
                          {currentQuestion}
                        </span>
                      </p>
                      <button
                        onClick={() => toggleQuestionExpanded('current')}
                        className="mt-0.5 rounded-md p-1 text-cyan-300/70 transition-colors hover:bg-white/[0.08] hover:text-cyan-200"
                        title={expandedQuestions.current ? 'Collapse question' : 'Expand question'}
                        type="button"
                      >
                        {expandedQuestions.current ? (
                          <ChevronUp className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                )}
                <div className="p-4">
                  {currentAnswerTruncated && (
                    <p className="mb-3 rounded-lg border border-amber-400/15 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                      Output cut short by the model token limit.
                    </p>
                  )}
                  {currentAnswer ? (
                    <p className="whitespace-pre-wrap text-[18px] leading-8 text-dark-100">
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

            {reversedAnswers.map((answer) => {
              const isQuestionExpanded = Boolean(expandedQuestions[answer.id])

              return (
                <div
                  key={answer.id}
                  className="animate-fade-in overflow-hidden rounded-[24px] border border-white/[0.05] bg-white/[0.035] shadow-[0_16px_48px_rgba(0,0,0,0.16)]"
                >
                  <div className="bg-white/[0.03] px-4 py-3">
                    <div className="flex items-start gap-2">
                      <p className="flex min-w-0 flex-1 items-start gap-2 text-[13px] font-medium leading-5 text-dark-300">
                        <span className="text-[10px] uppercase tracking-[0.14em] text-dark-500">
                          Q:
                        </span>
                        <span
                          className={`min-w-0 flex-1 ${isQuestionExpanded ? 'block' : 'truncate'}`}
                        >
                          {answer.question}
                        </span>
                      </p>
                      <button
                        onClick={() => toggleQuestionExpanded(answer.id)}
                        className="mt-0.5 rounded-md p-1 text-dark-500 transition-colors hover:bg-white/[0.08] hover:text-cyan-300"
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
                  </div>
                  <div className="p-4">
                    {answer.truncated && (
                      <p className="mb-3 rounded-lg border border-amber-400/15 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                        Output cut short by the model token limit.
                      </p>
                    )}
                    <div className="max-w-none text-[18px] leading-8 text-dark-100">
                      <MarkdownRenderer content={answer.answer} />
                    </div>
                  </div>
                </div>
              )
            })}
          </>
        )}
      </div>
    </div>
  )
}
