import { MessageSquare } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useInterview } from '../hooks/useInterview'
import { useInterviewStore } from '../store/interviewStore'

export function TranscriptPanel(): React.JSX.Element {
  const { transcripts, currentTranscript, isCapturing, isSpeaking } = useInterview()
  const { isTranscriptHidden } = useInterviewStore()
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isTranscriptHidden) {
      return
    }

    const frameId = window.requestAnimationFrame(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight
      }
    })

    return () => window.cancelAnimationFrame(frameId)
  }, [transcripts, currentTranscript, isTranscriptHidden])

  const hasContent = transcripts.length > 0 || currentTranscript

  if (isTranscriptHidden) {
    return <></>
  }

  return (
    <div className="flex h-52 flex-col border-b border-white/5 bg-black/10">
      <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-cyan-300" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-dark-300">
            Transcript
          </span>
          {transcripts.length > 0 && (
            <span className="rounded-full border border-white/5 bg-white/[0.04] px-2 py-0.5 text-[11px] text-dark-500">
              {transcripts.length}
            </span>
          )}
        </div>
        {isSpeaking && (
          <div className="flex items-center gap-1.5 rounded-full border border-emerald-400/15 bg-emerald-400/10 px-2 py-1">
            <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
            <span className="text-[11px] text-green-300">Speaking</span>
          </div>
        )}
      </div>

      <div
        ref={scrollRef}
        className="custom-scrollbar flex-1 space-y-2 overflow-y-auto px-4 py-3 scroll-smooth"
      >
        {!isCapturing && !hasContent ? (
          <p className="text-sm italic text-dark-500">
            Start listening to see real-time transcription...
          </p>
        ) : hasContent ? (
          <>
            {transcripts.map((transcript, index) => (
              <div key={transcript.id} className="flex gap-2 py-1 text-[14px]">
                <span className="min-w-[22px] pt-0.5 font-mono text-[11px] text-dark-500">
                  {index + 1}.
                </span>
                <p className="reading-font flex-1 leading-5 text-dark-200">{transcript.text}</p>
              </div>
            ))}

            {currentTranscript && (
              <div className="flex gap-2 py-1 text-[14px]">
                <span className="min-w-[22px] pt-0.5 font-mono text-[11px] text-cyan-300">
                  {transcripts.length + 1}.
                </span>
                <p className="reading-font flex-1 leading-5 text-dark-200">
                  {currentTranscript}
                  <span className="inline-block w-0.5 h-4 bg-blue-400 ml-1 animate-pulse align-middle" />
                </p>
              </div>
            )}
          </>
        ) : (
          <p className="text-sm italic text-dark-500">Waiting for speech...</p>
        )}
      </div>
    </div>
  )
}
