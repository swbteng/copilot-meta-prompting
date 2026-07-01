"""pytest 공통 설정 — program_AI(모델 서빙) 통합 테스트.

program_AI 의 산출물은 '서빙되는 3개 vLLM 엔드포인트'다. 따라서 테스트는 모두
실제 서버가 떠 있어야 하는 통합 테스트이며, 없으면 skip 한다(실패 아님).

연결 주소/모델은 환경변수로 덮어쓸 수 있다(기본값은 serve_*.sh 의 로컬 포트):
    AI_HOST(기본 127.0.0.1), LLM_PORT(4000), EMBED_PORT(4001), RERANK_PORT(4002)
    LLM_MODEL / EMBED_MODEL / RERANK_MODEL
"""
from __future__ import annotations

import os

import pytest

HOST = os.environ.get("AI_HOST", "127.0.0.1")
LLM_URL = f"http://{HOST}:{os.environ.get('LLM_PORT', '4000')}"
EMBED_URL = f"http://{HOST}:{os.environ.get('EMBED_PORT', '4001')}"
RERANK_URL = f"http://{HOST}:{os.environ.get('RERANK_PORT', '4002')}"

LLM_MODEL = os.environ.get("LLM_MODEL", "cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit")
EMBED_MODEL = os.environ.get("EMBED_MODEL", "Qwen/Qwen3-Embedding-8B")
RERANK_MODEL = os.environ.get("RERANK_MODEL", "Qwen/Qwen3-Reranker-4B")


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line(
        "markers",
        "integration: 실제 vLLM 모델 서버가 떠 있어야 통과하는 통합 테스트 (없으면 skip).",
    )


def require_reachable(base_url: str) -> None:
    """base_url 이 응답하지 않으면 skip(서버 미기동 시 수트가 깨지지 않게)."""
    import requests

    try:
        requests.get(f"{base_url}/v1/models", timeout=3)
    except Exception as exc:
        pytest.skip(f"모델 서버에 접속할 수 없음({base_url}): {exc} — 통합 테스트 skip")
