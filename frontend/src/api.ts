import axios from 'axios'
import type {
  SearchSuggestion, QuoteResponse, FundamentalsResponse,
  FinancialsResponse, TechnicalResponse, TrendResponse,
  ScreenerResponse, InsightsResponse,
  ValuationResponse, CashFlowResponse, RecommendationResponse,
  HoldingsResponse, BTSTResponse, ChatRequest, ChatResponse,
  PineStrategy, PineStrategyIn, StrategyEvalResult, StrategyScanResponse, SwingResponse,
  SmartMoneyScanResponse, StockSummaryResponse,
  TokenResponse, AuthUser, SectorInfo, SectorsOverview,
  FnoStatus, FnoAnalysisResponse, FnoSuggestion,
} from './types'

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL}/api` : '/api',
})

// Ping backend on load to wake it up (Render free tier cold start)
if (import.meta.env.VITE_API_URL) {
  axios.get(`${import.meta.env.VITE_API_URL}/health`).catch(() => {})
}

// ── Auth plumbing ─────────────────────────────────────────────────────────────

const TOKEN_KEY = 'ta_token'

export const getToken = () => localStorage.getItem(TOKEN_KEY)
export const setToken = (t: string | null) => {
  if (t) localStorage.setItem(TOKEN_KEY, t)
  else localStorage.removeItem(TOKEN_KEY)
}

// Attach the JWT to every request
api.interceptors.request.use(cfg => {
  const t = getToken()
  if (t) cfg.headers.Authorization = `Bearer ${t}`
  return cfg
})

// A 401 from a protected endpoint means the token expired/was rejected —
// self-clear the session. Auth endpoints themselves never trigger this.
api.interceptors.response.use(
  r => r,
  err => {
    const url: string = err.config?.url ?? ''
    if (err.response?.status === 401 && !url.startsWith('/auth/')) {
      setToken(null)
      window.dispatchEvent(new Event('ta-unauthorized'))
    }
    return Promise.reject(err)
  },
)

export const registerAuth = (email: string, username: string, password: string) =>
  api.post<TokenResponse>('/auth/register', { email, username, password }).then(r => r.data)

export const loginAuth = (login: string, password: string) =>
  api.post<TokenResponse>('/auth/login', { login, password }).then(r => r.data)

export const getMe = () =>
  api.get<AuthUser>('/auth/me').then(r => r.data)

// ── Market data ───────────────────────────────────────────────────────────────

export const getStockSummary = (ticker: string) =>
  api.get<StockSummaryResponse>(`/stock-summary/${ticker}`).then(r => r.data)

export const searchTickers   = (q: string) =>
  api.get<SearchSuggestion[]>('/search', { params: { q } }).then(r => r.data)

export const getQuote        = (ticker: string) =>
  api.get<QuoteResponse>(`/quote/${ticker}`).then(r => r.data)

export const getFundamentals = (ticker: string) =>
  api.get<FundamentalsResponse>(`/fundamentals/${ticker}`).then(r => r.data)

export const getFinancials   = (ticker: string) =>
  api.get<FinancialsResponse>(`/financials/${ticker}`).then(r => r.data)

export const getTechnical    = (ticker: string) =>
  api.get<TechnicalResponse>(`/technical/${ticker}`).then(r => r.data)

export const getTrend        = (ticker: string) =>
  api.get<TrendResponse>(`/trend/${ticker}`).then(r => r.data)

export const getScreener     = (ticker: string) =>
  api.get<ScreenerResponse>(`/screener/${ticker}`).then(r => r.data)

export const getInsights     = (ticker: string) =>
  api.post<InsightsResponse>(`/insights/${ticker}`).then(r => r.data)

export const getValuation    = (ticker: string) =>
  api.get<ValuationResponse>(`/valuation/${ticker}`).then(r => r.data)

export const getCashFlow     = (ticker: string) =>
  api.get<CashFlowResponse>(`/cashflow/${ticker}`).then(r => r.data)

export const getRecommendation = (ticker: string) =>
  api.get<RecommendationResponse>(`/recommendation/${ticker}`).then(r => r.data)

export const getHoldings = (ticker: string) =>
  api.get<HoldingsResponse>(`/holdings/${ticker}`).then(r => r.data)

export const getBTST = (ticker: string) =>
  api.get<BTSTResponse>(`/btst/${ticker}`).then(r => r.data)

export const sendChatMessage = (ticker: string, body: ChatRequest) =>
  api.post<ChatResponse>(`/chat/${ticker}`, body).then(r => r.data)

export const getChartData = (ticker: string, interval: '5m' | '15m' | '30m' | '1d' | '1wk' | '1mo') =>
  api.get<any>(`/chart/${ticker}`, { params: { interval } }).then(r => r.data)

export const getOrbScanner = (interval: '5m' | '15m' | '30m', tickers?: string) =>
  api.get<any>('/orb-scanner', { params: { interval, tickers: tickers ?? '' } }).then(r => r.data)

// ── Pine Script Strategies ────────────────────────────────────────────────────

export const getStrategies = () =>
  api.get<PineStrategy[]>('/strategies').then(r => r.data)

export const createStrategy = (body: PineStrategyIn) =>
  api.post<PineStrategy>('/strategies', body).then(r => r.data)

export const updateStrategy = (id: string, body: PineStrategyIn) =>
  api.put<PineStrategy>(`/strategies/${id}`, body).then(r => r.data)

export const deleteStrategy = (id: string) =>
  api.delete(`/strategies/${id}`)

export const forkStrategy = (id: string) =>
  api.post<PineStrategy>(`/strategies/${id}/fork`).then(r => r.data)

export const evaluateStrategy = (id: string, ticker: string) =>
  api.post<StrategyEvalResult>(`/strategies/${id}/evaluate`, { ticker }).then(r => r.data)

export const scanStrategy = (id: string, tickers: string[]) =>
  api.post<StrategyScanResponse>(`/strategies/${id}/scan`, { tickers }).then(r => r.data)

// ── Sectors dashboard ─────────────────────────────────────────────────────────

export const getSectors = () =>
  api.get<SectorInfo[]>('/sectors').then(r => r.data)

export const getSectorsOverview = () =>
  api.get<SectorsOverview>('/sectors/overview').then(r => r.data)

// ── FnO desk (Kotak Neo) ──────────────────────────────────────────────────────

export const getFnoStatus = () =>
  api.get<FnoStatus>('/fno/status').then(r => r.data)

export const connectFno = (mobile_number: string, ucc: string, totp: string, mpin: string) =>
  api.post('/fno/connect', { mobile_number, ucc, totp, mpin }).then(r => r.data)

export const disconnectFno = () =>
  api.post('/fno/disconnect').then(r => r.data)

export const getFnoExpiries = (underlying: string) =>
  api.get<{ underlying: string; expiries: string[] }>('/fno/expiries', { params: { underlying } }).then(r => r.data)

export const getFnoAnalysis = (underlying: string, expiry?: string) =>
  api.get<FnoAnalysisResponse>('/fno/analysis', {
    params: { underlying, ...(expiry ? { expiry } : {}) },
  }).then(r => r.data)

export const suggestFno = (underlying: string, expiry: string | null, risk_profile: string) =>
  api.post<FnoSuggestion>('/fno/suggest', {
    underlying, expiry, risk_profile,
  }).then(r => r.data)

// ── Swing Trade Analyser ──────────────────────────────────────────────────────

export const getSwing = (ticker: string) =>
  api.get<SwingResponse>(`/swing/${ticker}`).then(r => r.data)

// ── Smart Money Scanner ───────────────────────────────────────────────────────

export const getSmartMoneyScanner = (tickers?: string, minScore?: number) =>
  api.get<SmartMoneyScanResponse>('/smart-money-scanner', {
    params: { tickers: tickers ?? '', min_score: minScore ?? 0 },
  }).then(r => r.data)
