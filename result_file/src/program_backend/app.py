"""Copilot 메타 프롬프팅 Endpoint - FastAPI 서버.

엔드포인트
  GET  /health    상태 확인 (RunPod/로드밸런서 헬스체크용)
  POST /refine     전체 파이프라인. {"prompt": ...} -> {"refined": ..., 중간 산출물}
  POST /rewrite    (1) LLM 정제만.    {"prompt": ...} -> {"translated_input", "rewritten_prompt"}
  POST /search     (2) 벡터 검색만.   {"query": ...}  -> {"results": [...]}
  POST /rerank     (3) 검색+리랭킹.   {"query": ...}  -> {"results": [...]}
  POST /generate   (4) 최종 생성만.   {"translated_input", "rewritten_prompt", "templates": [...]} -> {"adapted_prompt"}

/refine 응답의 "refined" 키는 VSCode 확장/프록시 계약(refiner.js, refine_copilot.py)에 맞춘 것이다.
"""

from __future__ import annotations

from typing import Any, Optional

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

import config
import pipeline

app = FastAPI(title="Copilot Meta-Prompting Endpoint", version="1.0.0")

# 확장/외부 클라이언트가 다른 origin에서 직접 호출할 수 있어 CORS를 허용한다(R-IN-02).
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================ 요청 스키마 ============================
class RefineIn(BaseModel):
    prompt: str = Field(..., description="사용자 원본 프롬프트")
    chroma_top_k: Optional[int] = None
    top_n: Optional[int] = None


class RewriteIn(BaseModel):
    prompt: str


class SearchIn(BaseModel):
    query: str
    top_k: Optional[int] = None


class RerankIn(BaseModel):
    query: str
    chroma_top_k: Optional[int] = None
    top_n: Optional[int] = None


class GenerateIn(BaseModel):
    translated_input: str
    rewritten_prompt: str
    templates: list[str]


class VizQueryIn(BaseModel):
    query: str
    top_k: Optional[int] = None


# ============================ 라우트 ============================
@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/refine")
def refine(body: RefineIn) -> dict[str, Any]:
    """전체 파이프라인: 정제 -> 검색 -> 리랭킹 -> 생성."""
    try:
        return pipeline.run_full(body.prompt, chroma_top_k=body.chroma_top_k, top_n=body.top_n)
    except Exception as exc:  # 단계 어디서 실패해도 확장이 fallback할 수 있게 500으로 변환
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/rewrite")
def rewrite(body: RewriteIn) -> dict[str, Any]:
    try:
        return pipeline.rewrite(body.prompt)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/search")
def search(body: SearchIn) -> dict[str, Any]:
    try:
        return {"query": body.query, "results": pipeline.search(body.query, top_k=body.top_k)}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/rerank")
def rerank(body: RerankIn) -> dict[str, Any]:
    try:
        results = pipeline.rerank(body.query, chroma_top_k=body.chroma_top_k, top_n=body.top_n)
        return {"query": body.query, "results": results}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/generate")
def generate(body: GenerateIn) -> dict[str, Any]:
    try:
        return pipeline.generate(body.translated_input, body.rewritten_prompt, body.templates)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/viz/map")
def viz_map() -> dict[str, Any]:
    """(탭 2) 미리 계산된 벡터 DB 2D 지도(점/군집). 임베딩 서비스 없이도 동작."""
    try:
        return pipeline.viz_map()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/viz/query")
def viz_query(body: VizQueryIn) -> dict[str, Any]:
    """(탭 2) 정제 없이 입력을 바로 임베딩·검색하고 지도 위 좌표까지 반환."""
    try:
        return pipeline.viz_query(body.query, top_k=body.top_k)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/viz/template/{template_id}")
def viz_template(template_id: str) -> dict[str, Any]:
    """(탭 2) 지도 노드 클릭 시 원본 템플릿 본문을 반환."""
    try:
        return pipeline.viz_template(template_id)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


_STATIC_DIR = Path(__file__).resolve().parent / "static"
app.mount("/static", StaticFiles(directory=str(_STATIC_DIR)), name="static")


@app.get("/")
def index() -> FileResponse:
    """루트(GET /): 파이프라인 시각화 데모 페이지."""
    return FileResponse(str(_STATIC_DIR / "index.html"))
