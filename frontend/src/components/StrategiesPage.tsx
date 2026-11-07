import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getStrategies, deleteStrategy, forkStrategy, scanStrategy, getSectors,
} from '../api'
import type { PineStrategy, StrategyScanRow, ConditionRule } from '../types'
import { ruleText, EditorModal } from './PineScriptPanel'

const IconBtn = 'p-1.5 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.06] transition-colors disabled:opacity-40'
const PlusIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
)
const EditIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /></svg>
)
const TrashIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
)
const ForkIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="6" cy="6" r="2.5" /><circle cx="6" cy="18" r="2.5" /><circle cx="18" cy="9" r="2.5" /><path d="M6 8.5v7M6 12c0-3 4-3 9.5-3" /></svg>
)

function apiError(e: unknown): string {
  const d = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  if (typeof d === 'string') return d
  if (Array.isArray(d)) return d.map(x => (typeof x === 'object' && x && 'msg' in x ? String((x as { msg: unknown }).msg) : String(x))).join(' · ')
  return 'Something went wrong'
}

// ── Universe picker ──────────────────────────────────────────────────────────
type UniverseMode = 'n50' | 'sectors' | 'favs' | 'custom'

function UniversePicker({ mode, setMode, sectors, selected, toggleSelected, custom, setCustom, favs }: {
  mode: UniverseMode
  setMode: (m: UniverseMode) => void
  sectors: { name: string; tickers: string[] }[] | undefined
  selected: Set<string>
  toggleSelected: (name: string) => void
  custom: string
  setCustom: (v: string) => void
  favs: string[]
}) {
  const segBtn = (m: UniverseMode, label: string) =>
    `px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
      mode === m ? 'bg-white/[0.1] text-white' : 'text-zinc-500 hover:text-zinc-300'
    }`
  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex bg-white/[0.04] rounded-lg p-0.5 gap-0.5">
          <button className={segBtn('n50', 'Nifty 50')} onClick={() => setMode('n50')}>Nifty 50</button>
          <button className={segBtn('sectors', 'Sectors')} onClick={() => setMode('sectors')}>Sectors</button>
          <button className={segBtn('favs', 'Favourites')} onClick={() => setMode('favs')}>Favourites</button>
          <button className={segBtn('custom', 'Custom')} onClick={() => setMode('custom')}>Custom</button>
        </div>
        {mode === 'custom' && (
          <input
            className="flex-1 min-w-[200px] bg-zinc-950 border border-white/[0.1] rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-brand-500/60 font-mono"
            placeholder="TCS.NS, INFY.NS, DMART.NS … (max 50)"
            value={custom}
            onChange={e => setCustom(e.target.value)}
          />
        )}
        {mode === 'sectors' && (
          <span className="text-[11px] text-zinc-600">pick one or more sectors below</span>
        )}
        {mode === 'favs' && (
          <span className="text-[11px] text-zinc-600">{favs.length ? `${favs.length} favourites` : 'no favourites yet — star a stock first'}</span>
        )}
      </div>

      {mode === 'sectors' && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {sectors?.map(s => {
            const on = selected.has(s.name)
            return (
              <button
                key={s.name}
                onClick={() => toggleSelected(s.name)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-all ${
                  on
                    ? 'bg-brand-500/10 text-brand-400 border-brand-500/30'
                    : 'bg-white/[0.03] text-zinc-500 border-white/[0.06] hover:text-zinc-300 hover:border-white/[0.12]'
                }`}
              >
                {s.name} <span className="opacity-60 font-normal">{s.tickers.length}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Scan results table ───────────────────────────────────────────────────────
function ScanResults({ rows, onSelect }: { rows: StrategyScanRow[]; onSelect: (t: string) => void }) {
  const [sector, setSector] = useState('all')
  const [onlyMatches, setOnlyMatches] = useState(false)
  const [sortBy, setSortBy] = useState<'match' | 'ticker' | 'rsi'>('match')

  const sectorList = useMemo(() => {
    const names = [...new Set(rows.map(r => r.sector).filter(Boolean))] as string[]
    return names.sort()
  }, [rows])

  const filtered = useMemo(() => {
    let out = sector === 'all' ? [...rows] : rows.filter(r => r.sector === sector)
    if (onlyMatches) out = out.filter(r => r.passed)
    if (sortBy === 'ticker') out.sort((a, b) => a.ticker.localeCompare(b.ticker))
    else if (sortBy === 'rsi') out.sort((a, b) => (a.summary.rsi ?? 999) - (b.summary.rsi ?? 999))
    // 'match' keeps the backend order (matches first, best fit)
    return out
  }, [rows, sector, onlyMatches, sortBy])

  const selCls = 'bg-zinc-950 border border-white/[0.1] rounded-lg px-2 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-brand-500/60'

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] text-zinc-500">
          <span className="text-zinc-200 font-semibold">{rows.filter(r => r.passed).length}</span> of {rows.length} match
        </span>
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <select className={selCls} value={sector} onChange={e => setSector(e.target.value)}>
            <option value="all">All sectors</option>
            {sectorList.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className={selCls} value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)}>
            <option value="match">Sort: best match</option>
            <option value="ticker">Sort: ticker</option>
            <option value="rsi">Sort: RSI</option>
          </select>
          <button
            onClick={() => setOnlyMatches(v => !v)}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
              onlyMatches
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                : 'bg-white/[0.03] text-zinc-500 border-white/[0.06] hover:text-zinc-300'
            }`}
          >
            Matches only
          </button>
        </div>
      </div>

      <div className="hidden sm:grid grid-cols-[7rem_1fr_5.5rem_4rem_5rem_5.5rem] gap-2 px-3 text-[10px] font-semibold text-zinc-600 uppercase tracking-wider">
        <span>Ticker</span><span>Sector</span><span>Rules</span><span>RSI</span><span>vs MA50</span><span>52W mom</span>
      </div>
      <div className="max-h-[30rem] overflow-y-auto space-y-1 pr-0.5">
        {filtered.map(row => (
          <button
            key={row.ticker}
            onClick={() => onSelect(row.ticker)}
            className={`w-full grid grid-cols-[6.5rem_1fr_5rem] sm:grid-cols-[7rem_1fr_5.5rem_4rem_5rem_5.5rem] items-center gap-2 px-3 py-2 text-xs text-left rounded-lg border transition-colors ${
              row.passed
                ? 'bg-emerald-500/[0.07] border-emerald-500/20 hover:border-emerald-500/40'
                : 'bg-white/[0.02] border-white/[0.05] hover:border-white/[0.1]'
            }`}
          >
            <span className="font-mono font-semibold text-zinc-200">{row.ticker.replace('.NS', '').replace('.BO', '')}</span>
            <span className="text-zinc-500 truncate" title={row.sector ?? ''}>{row.sector ?? '—'}</span>
            <span className={`font-bold ${row.passed ? 'text-emerald-400' : 'text-zinc-500'}`}>
              {row.passed ? 'MATCH' : `${row.passed_count}/${row.total}`}
            </span>
            <span className="tabular-nums text-zinc-400 hidden sm:block">{row.summary.rsi ?? '—'}</span>
            <span className="tabular-nums text-zinc-400 hidden sm:block">
              {row.summary.price_vs_ma50 != null ? `${row.summary.price_vs_ma50 > 0 ? '+' : ''}${row.summary.price_vs_ma50}%` : '—'}
            </span>
            <span className={`tabular-nums hidden sm:block ${(row.summary.momentum_52w ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {row.summary.momentum_52w != null ? `${row.summary.momentum_52w > 0 ? '+' : ''}${row.summary.momentum_52w}%` : '—'}
            </span>
          </button>
        ))}
        {filtered.length === 0 && (
          <p className="text-center text-xs text-zinc-600 py-6">No rows for this filter.</p>
        )}
      </div>
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────
export function StrategiesPage({ onSelectTicker, favs }: {
  onSelectTicker: (t: string) => void
  favs: string[]
}) {
  const qc = useQueryClient()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showEditor, setShowEditor] = useState(false)
  const [editTarget, setEditTarget] = useState<PineStrategy | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<PineStrategy | null>(null)
  const [toast, setToast] = useState('')
  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2500) }

  // universe state
  const [mode, setMode] = useState<UniverseMode>('n50')
  const [selectedSectors, setSelectedSectors] = useState<Set<string>>(new Set())
  const [custom, setCustom] = useState('')

  const { data: strategies, isLoading } = useQuery({
    queryKey: ['strategies'],
    queryFn: getStrategies,
    staleTime: 30_000,
  })
  const { data: sectors } = useQuery({
    queryKey: ['sectors'],
    queryFn: getSectors,
    staleTime: 24 * 60 * 60_000,
  })

  // auto-select the first strategy once loaded
  useEffect(() => {
    if (!selectedId && strategies?.length) setSelectedId(strategies[0].id)
  }, [strategies, selectedId])

  const selected = strategies?.find(s => s.id === selectedId) ?? null
  const canScan = !!selected && selected.conditions.length > 0

  const forkMut = useMutation({
    mutationFn: forkStrategy,
    onSuccess: (s) => { qc.invalidateQueries({ queryKey: ['strategies'] }); setSelectedId(s.id); showToast(`Forked as "${s.name}"`) },
    onError: (e) => showToast(apiError(e)),
  })
  const deleteMut = useMutation({
    mutationFn: deleteStrategy,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['strategies'] }); setSelectedId(null); showToast('Strategy deleted') },
    onError: (e) => showToast(apiError(e)),
  })

  const scanMut = useMutation({
    mutationFn: (tickers: string[]) => {
      if (!selected) throw new Error('no strategy selected')
      return scanStrategy(selected.id, tickers)
    },
    onError: (e) => showToast(apiError(e)),
  })

  const runScan = () => {
    let tickers: string[] = []
    if (mode === 'custom') {
      tickers = custom.split(/[,\s]+/).map(t => t.trim().toUpperCase()).filter(Boolean)
    } else if (mode === 'favs') {
      tickers = favs
    } else if (mode === 'sectors') {
      const chosen = sectors?.filter(s => selectedSectors.has(s.name)) ?? []
      tickers = [...new Set(chosen.flatMap(s => s.tickers))]
    }
    if (mode !== 'n50' && tickers.length === 0) return
    scanMut.mutate(tickers.slice(0, 50))
  }

  const scanDisabled =
    scanMut.isPending ||
    !canScan ||
    (mode === 'custom' && !custom.trim()) ||
    (mode === 'sectors' && selectedSectors.size === 0) ||
    (mode === 'favs' && favs.length === 0)

  const toggleSector = (name: string) =>
    setSelectedSectors(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })

  return (
    <div className="space-y-4">
      {/* header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-white">Strategies</h1>
          <p className="text-xs text-zinc-500 mt-1">
            Build rule-based strategies, then scan the market for stocks that match — filter results by sector.
          </p>
        </div>
        <button
          className="px-3 py-1.5 rounded-lg text-xs font-bold bg-brand-600 hover:bg-brand-500 text-white transition-colors inline-flex items-center gap-1"
          onClick={() => { setEditTarget(null); setShowEditor(true) }}
        >
          <PlusIcon /> New strategy
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[20rem_1fr] gap-4 items-start">
        {/* ── left: strategy list ── */}
        <div className="space-y-2">
          {isLoading && [0, 1, 2].map(i => <div key={i} className="h-16 bg-white/[0.04] rounded-xl animate-pulse" />)}
          {!isLoading && !strategies?.length && (
            <div className="panel p-6 text-center">
              <p className="text-xs text-zinc-600">No strategies yet.</p>
              <button className="mt-3 text-xs font-bold text-brand-400 hover:text-brand-300" onClick={() => { setEditTarget(null); setShowEditor(true) }}>
                + Create your first strategy
              </button>
            </div>
          )}
          {strategies?.map(s => (
            <button
              key={s.id}
              onClick={() => setSelectedId(s.id)}
              className={`w-full text-left rounded-xl border p-3.5 transition-colors ${
                s.id === selectedId
                  ? 'bg-brand-500/[0.07] border-brand-500/30'
                  : 'bg-white/[0.03] border-white/[0.06] hover:border-white/[0.12]'
              }`}
            >
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-sm font-semibold ${s.id === selectedId ? 'text-white' : 'text-zinc-200'}`}>{s.name}</span>
                {s.is_builtin && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-300 ring-1 ring-inset ring-purple-500/30 font-semibold">Built-in</span>
                )}
                {s.conditions.length > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-brand-500/10 text-brand-400 ring-1 ring-inset ring-brand-500/25 font-semibold">
                    {s.conditions.length} rule{s.conditions.length > 1 ? 's' : ''}
                  </span>
                )}
              </div>
              {s.description && <p className="text-[11px] text-zinc-500 mt-1 line-clamp-2">{s.description}</p>}
              <div
                className="flex items-center gap-1 mt-2"
                onClick={e => { e.stopPropagation(); setSelectedId(s.id) }}
              >
                <button className={IconBtn + ' hover:text-amber-400'} title="Fork (editable copy)"
                        onClick={e => { e.stopPropagation(); forkMut.mutate(s.id) }}><ForkIcon /></button>
                {!s.is_builtin && (
                  <>
                    <button className={IconBtn} title="Edit"
                            onClick={e => { e.stopPropagation(); setEditTarget(s); setShowEditor(true) }}><EditIcon /></button>
                    <button className={IconBtn + ' hover:text-red-400'} title="Delete"
                            onClick={e => { e.stopPropagation(); setDeleteTarget(s) }}><TrashIcon /></button>
                  </>
                )}
              </div>
            </button>
          ))}
        </div>

        {/* ── right: scan workspace ── */}
        <div className="panel p-4 space-y-4 min-h-[24rem]">
          {!selected ? (
            <div className="flex items-center justify-center h-full py-16">
              <p className="text-xs text-zinc-600">Select a strategy on the left, or create a new one.</p>
            </div>
          ) : (
            <>
              {/* selected strategy summary */}
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-sm font-semibold text-white">{selected.name}</h2>
                  {selected.is_builtin && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-300 ring-1 ring-inset ring-purple-500/30 font-semibold">Built-in</span>
                  )}
                </div>
                {selected.description && <p className="text-xs text-zinc-500 mt-0.5">{selected.description}</p>}
                {selected.conditions.length > 0 ? (
                  <div className="bg-zinc-950/60 border border-white/[0.06] rounded-lg px-3 py-2.5 mt-2.5">
                    <p className="text-xs text-zinc-300 font-medium">
                      {selected.conditions.map((c: ConditionRule) => ruleText(c)).join('  AND  ')}
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-amber-400/80 mt-2.5">
                    Raw Pine script strategy — add rules (fork it, or create a new one) to scan the market.
                  </p>
                )}
              </div>

              {/* universe picker */}
              {canScan && (
                <div className="rounded-xl border border-white/[0.06] bg-zinc-950/60 p-3.5 space-y-3">
                  <UniversePicker
                    mode={mode} setMode={setMode}
                    sectors={sectors}
                    selected={selectedSectors} toggleSelected={toggleSector}
                    custom={custom} setCustom={setCustom}
                    favs={favs}
                  />
                  <div className="flex items-center gap-2">
                    <button
                      className="px-4 py-1.5 rounded-lg text-xs font-bold bg-brand-600 hover:bg-brand-500 text-white transition-colors disabled:opacity-50"
                      disabled={scanDisabled}
                      onClick={runScan}
                    >
                      {scanMut.isPending ? 'Scanning…' : 'Scan market'}
                    </button>
                    {scanMut.isPending && (
                      <span className="text-[11px] text-zinc-500">
                        Fetching 2 years of daily data per ticker in batches — this can take a minute or two.
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* results */}
              {scanMut.isPending && (
                <div className="space-y-2">
                  {[0, 1, 2, 3, 4].map(i => <div key={i} className="h-9 bg-white/[0.04] rounded-lg animate-pulse" />)}
                </div>
              )}
              {scanMut.data && <ScanResults rows={scanMut.data.results} onSelect={onSelectTicker} />}
            </>
          )}
        </div>
      </div>

      {showEditor && <EditorModal initial={editTarget} onClose={() => setShowEditor(false)} />}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={() => setDeleteTarget(null)}>
          <div className="w-full max-w-sm bg-zinc-900 border border-white/[0.08] rounded-2xl p-5" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-white mb-1">Delete strategy?</h3>
            <p className="text-xs text-zinc-500 mb-4">"{deleteTarget.name}" will be removed permanently.</p>
            <div className="flex justify-end gap-2">
              <button className="px-3 py-2 text-xs font-semibold text-zinc-400 hover:text-zinc-200 rounded-lg hover:bg-white/[0.06] transition-colors" onClick={() => setDeleteTarget(null)}>Cancel</button>
              <button className="px-3 py-2 text-xs font-bold bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors"
                      onClick={() => { deleteMut.mutate(deleteTarget.id); setDeleteTarget(null) }}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-5 right-5 z-50 bg-zinc-800 border border-white/[0.1] text-zinc-200 text-xs px-4 py-2.5 rounded-xl shadow-xl">
          {toast}
        </div>
      )}
    </div>
  )
}
