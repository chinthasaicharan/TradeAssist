@echo off
echo Starting TradeAssist Backend...
cd /d %~dp0backend
if not exist .venv (
    echo Creating virtual environment...
    python -m venv .venv
)
call .venv\Scripts\activate
if not exist .env (
    copy .env.example .env
    echo Created .env file - edit OPENAI_API_KEY to enable AI insights
)
pip install -r requirements.txt -q
echo Backend starting on http://localhost:8000
uvicorn main:app --reload --port 8000
