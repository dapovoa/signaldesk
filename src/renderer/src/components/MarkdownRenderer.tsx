import React, { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { Check, Copy } from 'lucide-react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'

interface MarkdownRendererProps {
  content: string
}

function CodeBlock({
  language,
  codeString
}: {
  language: string
  codeString: string
}): React.JSX.Element {
  const [copied, setCopied] = useState(false)

  const copyCode = async (): Promise<void> => {
    try {
      const result = await window.api.writeToClipboard(codeString)
      if (!result.success) {
        await navigator.clipboard.writeText(codeString)
      }
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      console.error('Failed to copy code block:', error)
    }
  }

  return (
    <div className="my-3 overflow-hidden rounded-xl border border-white/8 bg-[#0b1220]">
      <div className="flex items-center justify-between border-b border-white/8 bg-white/[0.03] px-3 py-2">
        <span className="text-[11px] uppercase tracking-[0.14em] text-dark-400">
          {language || 'code'}
        </span>
        <button
          onClick={copyCode}
          className="flex items-center gap-1 rounded-lg border border-white/8 bg-white/[0.04] px-2 py-1 text-[11px] text-dark-300 transition-colors hover:border-cyan-400/20 hover:bg-cyan-400/10 hover:text-cyan-200"
          type="button"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3" />
              <span>Copied</span>
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <SyntaxHighlighter
        style={vscDarkPlus}
        language={language}
        PreTag="div"
        className="!m-0 !rounded-none text-[14px] leading-6"
      >
        {codeString}
      </SyntaxHighlighter>
    </div>
  )
}

export function MarkdownRenderer({ content }: MarkdownRendererProps): React.JSX.Element {
  return (
    <div className="markdown-content text-inherit font-normal leading-inherit tracking-inherit">
      <ReactMarkdown
        components={{
          // Headings
          h1: ({ ...props }) => (
            <h1 className="text-xl font-bold text-dark-100 mt-4 mb-2 first:mt-0" {...props} />
          ),
          h2: ({ ...props }) => (
            <h2 className="text-lg font-bold text-dark-100 mt-3 mb-2 first:mt-0" {...props} />
          ),
          h3: ({ ...props }) => (
            <h3 className="text-base font-semibold text-dark-100 mt-3 mb-2 first:mt-0" {...props} />
          ),
          h4: ({ ...props }) => (
            <h4 className="text-sm font-semibold text-dark-200 mt-2 mb-1 first:mt-0" {...props} />
          ),
          h5: ({ ...props }) => (
            <h5 className="text-sm font-medium text-dark-200 mt-2 mb-1 first:mt-0" {...props} />
          ),
          h6: ({ ...props }) => (
            <h6 className="text-xs font-medium text-dark-300 mt-2 mb-1 first:mt-0" {...props} />
          ),
          // Paragraphs
          p: ({ ...props }) => (
            <p className="mb-2 text-inherit font-inherit leading-inherit tracking-inherit text-dark-100 last:mb-0" {...props} />
          ),
          // Lists
          ul: ({ ...props }) => (
            <ul
              className="mb-2 ml-4 list-inside list-disc space-y-1 text-inherit font-inherit leading-inherit tracking-inherit text-dark-100"
              {...props}
            />
          ),
          ol: ({ ...props }) => (
            <ol
              className="mb-2 ml-4 list-inside list-decimal space-y-1 text-inherit font-inherit leading-inherit tracking-inherit text-dark-100"
              {...props}
            />
          ),
          li: ({ ...props }) => (
            <li className="text-inherit font-inherit leading-inherit tracking-inherit text-dark-100" {...props} />
          ),
          // Code blocks
          code: ({ className, children, ...props }) => {
            const match = /language-(\w+)/.exec(className || '')
            const language = match ? match[1] : ''
            const codeString = String(children).replace(/\n$/, '')
            const isInline = !match

            return !isInline && match ? (
              <CodeBlock language={language} codeString={codeString} />
            ) : (
              <code
                className="rounded-md bg-white/[0.06] px-1.5 py-0.5 font-mono text-xs text-cyan-200"
                {...props}
              >
                {children}
              </code>
            )
          },
          // Blockquotes
          blockquote: ({ ...props }) => (
            <blockquote
              className="my-2 border-l-2 border-cyan-400/30 bg-cyan-400/5 py-1 pl-3 text-inherit font-inherit leading-inherit tracking-inherit italic text-dark-200"
              {...props}
            />
          ),
          // Links
          a: ({ ...props }) => (
            <a
              className="text-cyan-300 underline underline-offset-2 hover:text-cyan-200"
              target="_blank"
              rel="noopener noreferrer"
              {...props}
            />
          ),
          // Horizontal rule
          hr: ({ ...props }) => <hr className="my-3 border-dark-700/50" {...props} />,
          // Strong/Bold
          strong: ({ ...props }) => <strong className="font-semibold text-dark-100" {...props} />,
          // Emphasis/Italic
          em: ({ ...props }) => <em className="italic text-dark-200" {...props} />,
          // Tables
          table: ({ ...props }) => (
            <div className="overflow-x-auto my-3">
              <table className="min-w-full border-collapse border border-dark-700/50" {...props} />
            </div>
          ),
          thead: ({ ...props }) => <thead className="bg-dark-700/30" {...props} />,
          tbody: ({ ...props }) => <tbody {...props} />,
          tr: ({ ...props }) => <tr className="border-b border-dark-700/50" {...props} />,
          th: ({ ...props }) => (
            <th
              className="px-3 py-2 text-left text-xs font-semibold text-dark-200 border border-dark-700/50"
              {...props}
            />
          ),
          td: ({ ...props }) => (
            <td
              className="border border-dark-700/50 px-3 py-2 text-inherit font-inherit leading-inherit tracking-inherit text-dark-100"
              {...props}
            />
          )
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
