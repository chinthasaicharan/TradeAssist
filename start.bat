@echo off
title TradeAssist
color 0A

echo.
echo  =========================================
echo    TradeAssist - Starting All Services
echo  =========================================
echo.

REM ── Backend ───────────────────────────────────────────────────────────────
echo [1/2] Starting Backend on http://localhost:8000 ...
cd /d %~dp0backend

if not exist .venv (
    echo       Creating Python virtual environment...
    python -m venv .venv
)

call .venv\Scripts\activate

if not exist .env (
    copy .env.example .env >nul
    echo       Created .env from example - set OPENAI_API_KEY to enable AI insights
)

echo       Installing/verifying Python dependencies...
pip install -r requirements.txt -q

REM Launch backend in a new window so it stays visible
start "TradeAssist Backend" cmd /k "title TradeAssist Backend && color 0B && cd /d %~dp0backend && call .venv\Scripts\activate && echo Backend running on http://localhost:8000 && uvicorn main:app --reload --port 8000"

REM Short pause to let the backend window initialise
timeout /t 2 /nobreak >nul

REM ── Frontend ──────────────────────────────────────────────────────────────
echo [2/2] Starting Frontend on http://localhost:5173 ...
cd /d %~dp0frontend

if not exist node_modules (
    echo       Installing Node dependencies...
    npm install
)

REM Launch frontend in a new window
start "TradeAssist Frontend" cmd /k "title TradeAssist Frontend && color 0E && cd /d %~dp0frontend && echo Frontend running on http://localhost:5173 && npm run dev"

REM ── Done ──────────────────────────────────────────────────────────────────
echo.
echo  =========================================
echo    Both services are starting up!
echo  -----------------------------------------
echo    Backend  ->  http://localhost:8000
echo    Frontend ->  http://localhost:5173
echo  =========================================
echo.
echo  Close the individual terminal windows to stop each service.
echo  Press any key to close this launcher...
echo.
pause >nul
