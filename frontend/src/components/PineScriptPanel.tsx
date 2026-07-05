import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getStrategies, createStrategy, updateStrategy,
  deleteStrategy, forkStrategy,
} from '../api'
import type { PineStrategy } from '../types'

// ── Icons ─────────────────────────────────────────────────────────────────────
const IconPlus  = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/></svg>
const IconCopy  = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
const IconEdit  = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-5m-1.414-9.414a2 2 0 1 1 2.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
const IconTrash = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6m4-6v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
const IconTV    = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2"/><polyline points="8 21 12 17 16 21"/></svg>
const IconClose = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
const IconSave  = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M8 7H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3m-1-4-3 3m0 0-3-3m3 3V4"/></svg>

// ── Strategy Editor Modal ─────────────────────────────────────────────────────
interface EditorModalProps {
  initial?: PineStrategy | null
  onClose: () => void
  onSaved: () => void
}

function EditorModal({ initial, onClose, onSaved }: EditorModalProps) {
  const qc = useQueryClient()
  const [name, setName]        = useState(initial?.name        ?? '')
  const [desc, setDesc]        = useState(initial?.description ?? '')
  const [script, setScript]    = useState(initial?.script      ?? '//@version=6\nstrategy("My Strategy", overlay=true)\n\n// Write your Pine Script here\n')
  const [error, setError]      = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-focus editor
  useEffect(() => { textareaRef.current?.focus() }, [])

  const saveMut = useMutation({
    mutationFn: () => initial && !initial.is_builtin
      ? updateStrategy(initial.id, { name, description: desc, script })
      : createStrategy({ name, description: desc, script }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['strategies'] }); onSaved() },
    onError: (e: any) => setError(e?.response?.data?.detail ?? 'Failed to save'),
  })

  const handleSave = () => {
    setError('')
    if (!name.trim())   { setError('Strategy name is required'); return }
    if (!script.trim()) { setError('Script cannot be empty');    return }
    saveMut.mutate()
  }

  // Tab key inserts 4 spaces in the editor
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault()
      const ta  = textareaRef.current!
      const s   = ta.selectionStart
      const end = ta.selectionEnd
      const val = ta.value
      const next = val.substring(0, s) + '    ' + val.substring(end)
      setScript(next)
      requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = s + 4 })
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-4xl bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700 shrink-0">
          <h2 className="text-white font-bold text-base">
            {initial && !initial.is_builtin ? 'Edit Strategy' : 'New Strategy'}
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
            <IconClose />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Name + Description */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1 font-semibold uppercase tracking-wide">Strategy Name *</label>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. My Momentum Strategy"
                className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1 font-semibold uppercase tracking-wide">Description</label>
              <input
                value={desc}
                onChange={e => setDesc(e.target.value)}
                placeholder="Brief description (optional)"
                className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-500"
              />
            </div>
          </div>

          {/* Pine Script Editor */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-gray-400 font-semibold uppercase tracking-wide">Pine Script v6 *</label>
              <span className="text-xs text-gray-600 font-mono">{script.split('\n').length} lines</span>
            </div>
            <textarea
              ref={textareaRef}
              value={script}
              onChange={e => setScript(e.target.value)}
              onKeyDown={handleKeyDown}
              spellCheck={false}
              rows={22}
              className="w-full bg-gray-950 border border-gray-700 rounded-lg px-4 py-3 text-sm text-emerald-300 font-mono placeholder-gray-600 focus:outline-none focus:border-purple-500 resize-y leading-relaxed"
              style={{ fontFamily: "'Fira Code', 'Cascadia Code', 'Consolas', monospace", tabSize: 4 }}
            />
          </div>

          {error && (
            <p className="text-sm text-red-400 bg-red-950 border border-red-800 rounded-lg px-3 py-2">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-gray-700 shrink-0">
          <p className="text-xs text-gray-600">
            Tab inserts 4 spaces · Pine Script v6 syntax
          </p>
          <div className="flex gap-2">
            <button onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 transition-colors">
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saveMut.isPending}
              className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold bg-purple-700 hover:bg-purple-600 text-white transition-colors disabled:opacity-50">
              <IconSave />
              {saveMut.isPending ? 'Saving…' : 'Save Strategy'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── TradingView launcher ──────────────────────────────────────────────────────
function openInTradingView(script: string, ticker: string) {
  // Copy to clipboard then open TradingView Pine Editor
  navigator.clipboard.writeText(script).catch(() => {})
  const sym = ticker.replace('.NS', '').replace('.BO', '')
  // TradingView deep-link to Pine Editor with symbol pre-selected
  const url = `https://www.tradingview.com/pine-editor/?symbol=NSE%3A${encodeURIComponent(sym)}`
  window.open(url, '_blank', 'noopener,noreferrer')
}

// ── Strategy Card ─────────────────────────────────────────────────────────────
interface CardProps {
  strategy: PineStrategy
  ticker: string
  onEdit: (s: PineStrategy) => void
  onFork: (s: PineStrategy) => void
  onDelete: (s: PineStrategy) => void
}

function StrategyCard({ strategy, ticker, onEdit, onFork, onDelete }: CardProps) {
  const [copied, setCopied] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const copyScript = () => {
    navigator.clipboard.writeText(strategy.script).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
      {/* Card Header */}
      <div className="px-4 py-3 flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold text-white truncate">{strategy.name}</span>
            {strategy.is_builtin && (
              <span className="px-1.5 py-0.5 rounded text-xs font-semibold bg-purple-900 text-purple-300 border border-purple-700 shrink-0">
                Built-in
              </span>
            )}
          </div>
          {strategy.description && (
            <p className="text-xs text-gray-400 mt-1 line-clamp-2">{strategy.description}</p>
          )}
          <p className="text-xs text-gray-600 mt-1 font-mono">
            {strategy.script.split('\n').length} lines · Pine Script v6
          </p>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => openInTradingView(strategy.script, ticker)}
            title="Open in TradingView (script copied to clipboard)"
            className="p-1.5 rounded-lg text-gray-400 hover:text-blue-400 hover:bg-blue-950 transition-colors"
          >
            <IconTV />
          </button>
          <button
            onClick={copyScript}
            title={copied ? 'Copied!' : 'Copy script'}
            className={`p-1.5 rounded-lg transition-colors ${copied ? 'text-emerald-400 bg-emerald-950' : 'text-gray-400 hover:text-emerald-400 hover:bg-emerald-950'}`}
          >
            <IconCopy />
          </button>
          <button
            onClick={() => onFork(strategy)}
            title="Fork (create editable copy)"
            className="p-1.5 rounded-lg text-gray-400 hover:text-amber-400 hover:bg-amber-950 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <circle cx="12" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/>
              <path d="M18 9v1a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V9"/>
              <line x1="12" y1="12" x2="12" y2="15"/>
            </svg>
          </button>
          {!strategy.is_builtin && (
            <>
              <button
                onClick={() => onEdit(strategy)}
                title="Edit strategy"
                className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
              >
                <IconEdit />
              </button>
              <button
                onClick={() => onDelete(strategy)}
                title="Delete strategy"
                className="p-1.5 rounded-lg text-gray-400 hover:text-red-400 hover:bg-red-950 transition-colors"
              >
                <IconTrash />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Preview toggle */}
      <div className="border-t border-gray-700">
        <button
          onClick={() => setExpanded(v => !v)}
          className="w-full px-4 py-2 text-left text-xs text-gray-500 hover:text-gray-300 hover:bg-gray-750 transition-colors flex items-center justify-between"
        >
          <span>{expanded ? 'Hide script preview' : 'Show script preview'}</span>
          <span className={`transition-transform ${expanded ? 'rotate-180' : ''}`}>▼</span>
        </button>
        {expanded && (
          <div className="relative">
            <pre className="px-4 py-3 text-xs text-emerald-300 font-mono bg-gray-950 overflow-x-auto leading-relaxed max-h-64 overflow-y-auto"
              style={{ fontFamily: "'Fira Code', 'Cascadia Code', 'Consolas', monospace" }}>
              {strategy.script}
            </pre>
            <button
              onClick={copyScript}
              className="absolute top-2 right-2 px-2 py-1 rounded text-xs bg-gray-800 border border-gray-600 text-gray-400 hover:text-white transition-colors"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main Panel ────────────────────────────────────────────────────────────────
interface Props { ticker: string; onClose?: () => void }

export function PineScriptPanel({ ticker, onClose }: Props) {
  const qc = useQueryClient()
  const [showEditor, setShowEditor]     = useState(false)
  const [editTarget, setEditTarget]     = useState<PineStrategy | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<PineStrategy | null>(null)
  const [toast, setToast]               = useState('')

  const { data: strategies = [], isLoading } = useQuery({
    queryKey: ['strategies'],
    queryFn:  getStrategies,
    staleTime: 30_000,
  })

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  const forkMut = useMutation({
    mutationFn: (id: string) => forkStrategy(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['strategies'] }); showToast('Strategy forked — you can now edit it.') },
    onError: () => showToast('Failed to fork strategy'),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteStrategy(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['strategies'] }); setDeleteTarget(null); showToast('Strategy deleted.') },
    onError: () => showToast('Failed to delete strategy'),
  })

  const handleEdit = (s: PineStrategy) => { setEditTarget(s); setShowEditor(true) }
  const handleNew  = () => { setEditTarget(null); setShowEditor(true) }
  const handleFork = (s: PineStrategy) => forkMut.mutate(s.id)
  const handleDelete = (s: PineStrategy) => setDeleteTarget(s)
  const handleSaved = () => { setShowEditor(false); setEditTarget(null); showToast('Strategy saved!') }

  return (
    <>
      {/* Panel */}
      <div className="panel space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <p className="panel-title mb-0">Pine Script Strategies</p>
            <span className="text-xs font-mono font-bold text-purple-400">{ticker}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleNew}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-purple-700 hover:bg-purple-600 text-white transition-colors"
            >
              <IconPlus /> New Strategy
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-gray-700 transition-colors"
              title="Close"
            >
              <IconClose />
            </button>
          </div>
        </div>

        {/* Info banner */}
        <div className="bg-blue-950 border border-blue-800 rounded-lg px-4 py-3 text-xs text-blue-300 space-y-1">
          <p className="font-semibold text-blue-200">How to apply to TradingView charts</p>
          <p>1. Click the <span className="text-blue-100 font-bold">TV icon</span> on any strategy — the script is copied to your clipboard and TradingView opens.</p>
          <p>2. In TradingView Pine Editor, paste the script and click <span className="text-blue-100 font-bold">Add to chart</span>.</p>
          <p>3. Use the <span className="text-blue-100 font-bold">Fork</span> icon to create an editable copy of built-in strategies.</p>
        </div>

        {/* Strategy list */}
        {isLoading ? (
          <div className="space-y-3">
            {[1,2].map(i => <div key={i} className="h-20 bg-gray-800 rounded-xl animate-pulse" />)}
          </div>
        ) : strategies.length === 0 ? (
          <div className="text-center py-10">
            <p className="text-gray-500 text-sm">No strategies yet.</p>
            <p className="text-gray-600 text-xs mt-1">Click <strong className="text-gray-400">+ New Strategy</strong> to create your first one.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {strategies.map(s => (
              <StrategyCard
                key={s.id}
                strategy={s}
                ticker={ticker}
                onEdit={handleEdit}
                onFork={handleFork}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>

      {/* Editor modal */}
      {showEditor && (
        <EditorModal
          initial={editTarget}
          onClose={() => { setShowEditor(false); setEditTarget(null) }}
          onSaved={handleSaved}
        />
      )}

      {/* Delete confirm modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-sm bg-gray-900 border border-gray-700 rounded-2xl p-6 shadow-2xl space-y-4">
            <h3 className="text-white font-bold">Delete strategy?</h3>
            <p className="text-sm text-gray-400">
              "<span className="text-white">{deleteTarget.name}</span>" will be permanently deleted.
            </p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-white border border-gray-700 transition-colors">
                Cancel
              </button>
              <button
                onClick={() => deleteMut.mutate(deleteTarget.id)}
                disabled={deleteMut.isPending}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-red-700 hover:bg-red-600 text-white transition-colors disabled:opacity-50">
                {deleteMut.isPending ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-gray-800 border border-gray-600 text-white text-sm rounded-xl px-4 py-3 shadow-xl animate-in fade-in slide-in-from-bottom-2">
          {toast}
        </div>
      )}
    </>
  )
}
