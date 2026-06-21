import { useState } from 'react'
import { getInsights } from '../api'
import type { SWOTInsights } from '../types'

interface Props { ticker: string }

const SWOT_CONFIG = [
  {
    key: 'strengths' as const,
    label: 'Strengths',
    icon: '💪',
    bg: 'bg-emerald-950',
    border: 'border-emerald-800',
    text: 'text-emerald-300',
    badge: 'bg-emerald-900 text-emerald-400',
  },
  {
    key: 'weaknesses' as const,
    label: 'Weaknesses',
    icon: '⚠️',
    bg: 'bg-red-950',
    border: 'border-red-800',
    text: 'text-red-300',
    badge: 'bg-red-900 text-red-400',
  },
  {
    key: 'opportunities' as const,
    label: 'Opportunities',
    icon: '🚀',
    bg: 'bg-blue-950',
    border: 'border-blue-800',
    text: 'text-blue-300',
    badge: 'bg-blue-900 text-blue-400',
  },
  {
    key: 'threats' as const,
    label: 'Threats',
    icon: '🔴',
    bg: 'bg-orange-950',
    border: 'border-orange-800',
    text: 'text-orange-300',
    badge: 'bg-orange-900 text-orange-400',
  },
]

export function AIInsightsPanel({ ticker }: Props) {
  const [data, setData] = useState<{ ticker: string; insights: SWOTInsights } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const analyze = async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await getInsights(ticker)
      setData(result)
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Failed to generate insights')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="panel space-y-4">
      <div className="flex items-center justify-between">
        <p className="panel-title">AI Insights · SWOT Analysis</p>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-600 hidden sm:block">Gemini 2.5 Flash</span>
          <button
          onClick={analyze}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700
                     disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold transition"
          aria-label="Generate AI SWOT analysis"
        >
          {loading ? (
            <>
              <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Analyzing…
            </>
          ) : (
            <>✨ {data ? 'Re-analyze' : 'Generate SWOT'}</>
          )}
        </button>
        </div>
      </div>

      {!data && !loading && !error && (
        <div className="text-center py-10 text-gray-500 text-sm">
          <p className="text-4xl mb-3">🤖</p>
          <p>Click <strong className="text-gray-300">Generate SWOT</strong> to get AI-powered analysis</p>
          <p className="text-xs mt-1 text-gray-600">Analyzes fundamentals, technicals & recent news</p>
        </div>
      )}

      {error && (
        <div className="bg-red-950 border border-red-800 rounded-lg p-3 text-red-400 text-sm">
          {error}
        </div>
      )}

      {loading && (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="animate-pulse h-24 bg-gray-800 rounded-xl" />
          ))}
        </div>
      )}

      {data && !loading && (
        <>
          {/* Summary */}
          <div className="bg-gray-800 rounded-xl p-4 text-sm text-gray-300 leading-relaxed border-l-4 border-brand-500">
            <p className="text-xs font-semibold text-brand-400 mb-1">EXECUTIVE SUMMARY</p>
            {data.insights.summary}
          </div>

          {/* 2x2 SWOT Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {SWOT_CONFIG.map(cfg => (
              <div
                key={cfg.key}
                className={`${cfg.bg} border ${cfg.border} rounded-xl p-4 space-y-2`}
              >
                <p className={`text-xs font-bold uppercase tracking-wider ${cfg.text}`}>
                  {cfg.icon} {cfg.label}
                </p>
                <ul className="space-y-1.5">
                  {data.insights[cfg.key].map((item, i) => (
                    <li key={i} className="flex gap-2 text-xs text-gray-300">
                      <span className={`mt-0.5 w-1.5 h-1.5 rounded-full shrink-0 ${cfg.badge}`} />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <p className="text-right text-xs text-gray-600">
            Generated {new Date(data.insights.generated_at).toLocaleString()}
          </p>
        </>
      )}
    </div>
  )
}
