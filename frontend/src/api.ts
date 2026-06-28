import axios from 'axios'
import type {
  SearchSuggestion, QuoteResponse, FundamentalsResponse,
  FinancialsResponse, TechnicalResponse, TrendResponse,
  ScreenerResponse, InsightsResponse,
  ValuationResponse, CashFlowResponse, RecommendationResponse,
  HoldingsResponse, BTSTResponse, ChatRequest, ChatResponse,
} from './types'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL}/api` : '/api',
})

// Ping backend on load to wake it up (Render free tier cold start)
if (import.meta.env.VITE_API_URL) {
  axios.get(`${import.meta.env.VITE_API_URL}/health`).catch(() => {})
}

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

export const getValuation      = (ticker: string) =>
  api.get<ValuationResponse>(`/valuation/${ticker}`).then(r => r.data)

export const getCashFlow       = (ticker: string) =>
  api.get<CashFlowResponse>(`/cashflow/${ticker}`).then(r => r.data)

export const getRecommendation = (ticker: string) =>
  api.get<RecommendationResponse>(`/recommendation/${ticker}`).then(r => r.data)

export const getHoldings = (ticker: string) =>
  api.get<HoldingsResponse>(`/holdings/${ticker}`).then(r => r.data)

export const getBTST = (ticker: string) =>
  api.get<BTSTResponse>(`/btst/${ticker}`).then(r => r.data)

export const sendChatMessage = (ticker: string, body: ChatRequest) =>
  api.post<ChatResponse>(`/chat/${ticker}`, body).then(r => r.data)

export const getChartData = (ticker: string, interval: '1d' | '1wk' | '1mo') =>
  api.get<any>(`/chart/${ticker}`, { params: { interval } }).then(r => r.data)
