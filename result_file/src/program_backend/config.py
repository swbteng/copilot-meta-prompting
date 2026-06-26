"""Endpoint 설정 - 모든 값은 .env / 프로세스 환경변수에서만 읽는다(코드에 하드코딩 금지).

연결값(LLM/임베딩/리랭커 URL·모델·키)은 코드 기본값을 두지 않는다. .env 를 채우면 그대로 반영되고,
빈 값이면 비어 있는 채로 두어 요청 시 명확한 에러로 알린다(= 서버에서 .env 만 채우면 동작이 바뀐다).
운영 파라미터(타임아웃/top_k 등)와 번들 데이터 경로(Chroma)만 빈 값일 때 코드 기본값으로 폴백한다.

우선순위: 프로세스 환경변수 > .env 파일 > (운영/번들 파라미터에 한해) 코드 기본값.
"""

from __future__ import annotations

import os
from pathlib import Path


def load_env_file(path: Path) -> None:
    """KEY=VALUE 한 줄씩 읽어 환경변수로 주입(이미 있으면 건드리지 않음). program_db 스크립트와 동일 방식."""
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key:
            os.environ.setdefault(key, value)


THIS_DIR = Path(__file__).resolve().parent
SRC_DIR = THIS_DIR.parent                       # result_file/src
PROGRAM_DB_DIR = SRC_DIR / "program_db"         # RAG 코드/아티팩트 재사용 위치(백엔드로 함께 배포)

# .env 로드: 현재 작업 디렉터리와 endpoint 폴더 둘 다 시도
for _env_path in (Path.cwd() / ".env", THIS_DIR / ".env"):
    load_env_file(_env_path)


def _env(key: str, default: str = "") -> str:
    """환경변수 읽기. 미설정이거나 빈 문자열이면 default. (.env 에 빈 값으로 두면 default 가 쓰인다)"""
    value = os.environ.get(key)
    return value if value else default


def _ensure_v1(url: str) -> str:
    """OpenAI 호환 클라이언트(임베딩)는 base_url 끝에 /v1 이 있어야 한다. 비어 있으면 그대로 둔다."""
    if not url:
        return ""
    trimmed = url.rstrip("/")
    return trimmed if trimmed.endswith("/v1") else f"{trimmed}/v1"


# --- LLM (텍스트 생성: 정제/최종 프롬프트 생성). 연결값은 .env 필수, 코드 기본값 없음 ---
LLM_BASE_URL = _env("LLM_BASE_URL").rstrip("/")
LLM_MODEL = _env("LLM_MODEL")
LLM_API_KEY = _env("LLM_API_KEY") or _env("RUNPOD_API_KEY")
LLM_TIMEOUT = int(_env("LLM_TIMEOUT", "180"))
LLM_MAX_TOKENS = int(_env("LLM_MAX_TOKENS", "8192"))

# --- 임베딩 (벡터 검색용 쿼리 임베딩). base_url 끝 /v1 자동 보정 ---
EMBED_BASE_URL = _ensure_v1(_env("EMBED_BASE_URL"))
EMBED_MODEL = _env("EMBED_MODEL")
EMBED_API_KEY = _env("EMBED_API_KEY") or _env("RUNPOD_API_KEY")

# --- 리랭커 (검색 후보 재점수화). base_url 끝에 /v1 을 붙이지 않는다(rerank_endpoint가 처리) ---
RERANK_BASE_URL = _env("RERANK_BASE_URL").rstrip("/")
RERANK_MODEL = _env("RERANK_MODEL")
RERANK_API_KEY = _env("RERANK_API_KEY") or _env("RUNPOD_API_KEY")
RERANK_TIMEOUT = int(_env("RERANK_TIMEOUT", "120"))

# --- Chroma (program_db에 커밋된 production DB). 번들 데이터라 빈 값이면 코드 기본 경로로 폴백 ---
CHROMA_DIR = _env("CHROMA_DIR", str(PROGRAM_DB_DIR / "artifacts" / "production_chroma_qwen3_8b"))
CHROMA_COLLECTION_NAME = _env("CHROMA_COLLECTION_NAME", "production_task_prompt_templates")

# --- 검색/리랭킹 기본 파라미터 (요청에서 덮어쓸 수 있음) ---
CHROMA_TOP_K = int(_env("CHROMA_TOP_K", "20"))     # Chroma에서 가져올 후보 수
RERANK_TOP_N = int(_env("RERANK_TOP_N", "3"))      # 리랭킹 후 최종 템플릿 수
