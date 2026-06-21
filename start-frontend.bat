@echo off
echo Starting TradeAssist Frontend...
cd /d %~dp0frontend
if not exist node_modules (
    echo Installing dependencies...
    npm install
)
echo Frontend starting on http://localhost:5173
npm run dev
