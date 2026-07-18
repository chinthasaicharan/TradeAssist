# TradeAssist — Product Overview

TradeAssist is a full-stack Indian stock analysis dashboard targeting NSE/BSE equities. It helps retail traders and investors research stocks through a single-page UI that aggregates market data, technical analysis, and AI-generated insights.

## Core Capabilities

- **Quote & Fundamentals** — Live price, P/E, EPS, market cap, 52-week range, sector/industry
- **Financials** — Annual and quarterly revenue, profit, and cash flow charts
- **Technical Analysis** — Support/resistance, RSI, MACD, Bollinger Bands, Supertrend, Fibonacci, MA crossovers
- **AI Insights** — GPT-4o-mini SWOT analysis with rule-based fallback (no API key required)
- **Recommendation Engine** — Composite buy/sell/hold signal with confidence score
- **BTST Scanner** — Buy-Today-Sell-Tomorrow overnight trade signals
- **Swing Trade Analyser** — Multi-factor swing trade verdict with entry/target/stop-loss
- **ORB Scanner** — Opening Range Breakout scan across a watchlist
- **Holdings** — Institutional and mutual fund holder breakdown
- **Screener** — Similar stocks by sector with similarity scoring
- **Pine Script Strategies** — Save, fork, and manage user-owned TradingView Pine Script strategies
- **AI Chat** — Ticker-scoped chat assistant for stock Q&A
- **Paper Trades** — Local paper trading tracker

## Target Users

Retail traders and investors focused on Indian equities (NSE/BSE). Ticker format is `SYMBOL.NS` (NSE) or `SYMBOL.BO` (BSE).

## Deployment

- Frontend: Vercel (static)
- Backend: Render (free tier — cold starts expected; backend pings itself on load)
- Data: yfinance (free, no key) + OpenAI GPT-4o-mini (optional)
