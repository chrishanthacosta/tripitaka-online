"""Standalone app exposing only the AI chat endpoint (no database needed).

Used alongside the static site build: nginx serves site/ and proxies
/api/ai/ to this process.

    DEEPSEEK_API_KEY=sk-... uvicorn api.ai_app:app --host 127.0.0.1 --port 8091
"""
from fastapi import FastAPI

from api.ai import router

app = FastAPI(title="Tripitaka AI", docs_url=None, redoc_url=None, openapi_url=None)
app.include_router(router)
