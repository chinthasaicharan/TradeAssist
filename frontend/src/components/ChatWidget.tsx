import { useState, useRef, useEffect, useCallback } from 'react'
import { sendChatMessage } from '../api'
import type { ChatMessage } from '../types'

interface Props {
  ticker: string
}

// Suggested questions shown when chat is empty
const SUGGESTIONS = [
  'What is the current price?',
  'Is it overbought or oversold?',
  'What are the key support and resistance levels?',
  'What do institutional holdings look like?',
  'Explain the P/E and valuation',
  'Should I buy or sell?',
  'What is the RSI and MACD saying?',
  'What is the 52-week performance?',
  'What are the recent news headlines?',
  'Summarise the growth metrics',
]

function MarkdownText({ text }: { text: string }) {
  // Simple inline markdown: **bold**, bullet points
  const lines = text.split('\n')
  return (
    <div className="space-y-1">
      {lines.map((line, i) => {
        const trimmed = line.trimStart()
        const isBullet = trimmed.startsWith('- ') || trimmed.startsWith('* ')
        const content = isBullet ? trimmed.slice(2) : line

        // Bold: **text**
        const parts = content.split(/(\*\*[^*]+\*\*)/g)
        const rendered = parts.map((p, j) =>
          p.startsWith('**') && p.endsWith('**')
            ? <strong key={j} className="text-white font-semibold">{p.slice(2, -2)}</strong>
            : <span key={j}>{p}</span>
        )

        if (isBullet) {
          return (
            <div key={i} className="flex gap-2">
              <span className="text-brand-400 shrink-0 mt-0.5">•</span>
              <span>{rendered}</span>
            </div>
          )
        }
        if (!line.trim()) return <div key={i} className="h-1" />
        return <div key={i}>{rendered}</div>
      })}
    </div>
  )
}

export function ChatWidget({ ticker }: Props) {
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef  = useRef<HTMLInputElement>(null)

  // Reset conversation when ticker changes
  useEffect(() => {
    setMessages([])
    setError(null)
  }, [ticker])

  // Scroll to bottom on new message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  // Focus input when opened
  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 80)
  }, [isOpen])

  const send = useCallback(async (question: string) => {
    if (!question.trim() || loading || !ticker) return
    setError(null)

    const userMsg: ChatMessage = { role: 'user', content: question }
    const nextMessages = [...messages, userMsg]
    setMessages(nextMessages)
    setInput('')
    setLoading(true)

    try {
      const resp = await sendChatMessage(ticker, {
        question,
        messages: messages.slice(-8),   // send last 8 turns for context
      })
      setMessages(prev => [...prev, { role: 'assistant', content: resp.answer }])
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        || 'Something went wrong. Please try again.'
      setError(msg)
      setMessages(prev => prev.slice(0, -1))   // remove the user msg on error
    } finally {
      setLoading(false)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [messages, loading, ticker])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    send(input)
  }

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send(input)
    }
  }

  if (!ticker) return null

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setIsOpen(o => !o)}
        aria-label={isOpen ? 'Close chat' : 'Open stock chat assistant'}
        className={`
          fixed bottom-6 right-6 z-50
          w-14 h-14 rounded-full shadow-2xl
          flex items-center justify-center
          transition-all duration-200
          ${isOpen
            ? 'bg-gray-700 hover:bg-gray-600 rotate-45'
            : 'bg-brand-600 hover:bg-brand-500'}
        `}
      >
        {isOpen
          ? <span className="text-white text-2xl font-light leading-none">×</span>
          : <span className="text-xl">💬</span>
        }
      </button>

      {/* Chat drawer */}
      {isOpen && (
        <div
          role="dialog"
          aria-label={`Chat about ${ticker}`}
          className="
            fixed bottom-24 right-6 z-50
            w-[min(400px,calc(100vw-2rem))]
            h-[min(560px,calc(100vh-8rem))]
            bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl
            flex flex-col overflow-hidden
          "
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-lg">🤖</span>
              <div>
                <p className="text-sm font-semibold text-white">TradeAssist AI</p>
                <p className="text-xs text-brand-400 font-mono">{ticker}</p>
              </div>
            </div>
            <button
              onClick={() => { setMessages([]); setError(null) }}
              className="text-xs text-gray-500 hover:text-gray-300 transition px-2 py-1 rounded"
              title="Clear conversation"
            >
              Clear
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 text-sm">
            {messages.length === 0 && (
              <div className="space-y-3">
                <p className="text-gray-400 text-xs text-center">
                  Ask me anything about <span className="text-brand-400 font-mono font-semibold">{ticker}</span>
                </p>
                <div className="grid grid-cols-1 gap-1.5">
                  {SUGGESTIONS.map(s => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      className="
                        text-left text-xs px-3 py-2 rounded-lg
                        bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white
                        border border-gray-700 hover:border-gray-600
                        transition-all duration-150
                      "
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`
                    max-w-[85%] rounded-xl px-3 py-2 text-xs leading-relaxed
                    ${m.role === 'user'
                      ? 'bg-brand-700 text-white rounded-br-sm'
                      : 'bg-gray-800 text-gray-200 rounded-bl-sm'}
                  `}
                >
                  {m.role === 'assistant'
                    ? <MarkdownText text={m.content} />
                    : <span>{m.content}</span>
                  }
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="bg-gray-800 rounded-xl rounded-bl-sm px-4 py-3">
                  <div className="flex gap-1 items-center">
                    <span className="w-1.5 h-1.5 bg-brand-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 bg-brand-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 bg-brand-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}

            {error && (
              <div className="text-xs text-red-400 bg-red-900/30 border border-red-800 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <form onSubmit={handleSubmit} className="border-t border-gray-800 p-3 flex gap-2 shrink-0">
            <input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder={`Ask about ${ticker}…`}
              disabled={loading}
              maxLength={500}
              className="
                flex-1 bg-gray-800 border border-gray-700 rounded-lg
                px-3 py-2 text-xs text-white placeholder-gray-500
                focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500
                disabled:opacity-50 transition
              "
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              aria-label="Send message"
              className="
                w-9 h-9 rounded-lg bg-brand-600 hover:bg-brand-500
                flex items-center justify-center shrink-0
                disabled:opacity-40 disabled:cursor-not-allowed
                transition-colors
              "
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-white">
                <path d="M3.105 2.289a.75.75 0 00-.826.95l1.414 4.925A1.5 1.5 0 005.135 9.25h6.115a.75.75 0 010 1.5H5.135a1.5 1.5 0 00-1.442 1.086l-1.414 4.926a.75.75 0 00.826.95 28.896 28.896 0 0015.293-7.154.75.75 0 000-1.115A28.897 28.897 0 003.105 2.289z" />
              </svg>
            </button>
          </form>

          <p className="text-center text-gray-600 text-[10px] pb-2">
            AI analysis — not financial advice
          </p>
        </div>
      )}
    </>
  )
}
