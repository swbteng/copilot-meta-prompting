#!/usr/bin/env python3
"""Retrieve Chroma top-k candidates, rerank them, and emit the final top-n."""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
from pathlib import Path
from typing import Any

import chromadb
import requests
from chromadb.config import Settings

from build_vector_db import (
    DEFAULT_VLLM_API_KEY,
    create_embedding_client,
    generate_embedding,
)


def load_llm_script_defaults() -> dict[str, str]:
    script_path = Path(__file__).resolve().parents[1] / "contests" / "llm_scripts.py"
    if not script_path.exists():
        return {}

    spec = importlib.util.spec_from_file_location("contest_llm_scripts", script_path)
    if spec is None or spec.loader is None:
        return {}

    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return {
        "embed_base_url": str(getattr(module, "EMBED", "")),
        "embed_model": str(getattr(module, "EMBED_MODEL", "")),
        "rerank_base_url": str(getattr(module, "RERANK", "")),
        "rerank_model": str(getattr(module, "RERANK_MODEL", "")),
    }


def openai_base_url(base_url: str) -> str:
    trimmed = base_url.rstrip("/")
    if trimmed.endswith("/v1"):
        return trimmed
    return f"{trimmed}/v1"


LLM_SCRIPT_DEFAULTS = load_llm_script_defaults()
PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CHROMA_DIR = Path(os.getenv("CHROMA_DIR", str(PROJECT_ROOT / "artifacts" / "production_chroma_qwen3_8b")))
DEFAULT_COLLECTION_NAME = os.getenv("CHROMA_COLLECTION_NAME", "production_task_prompt_templates")
DEFAULT_EMBED_MODEL = os.getenv("EMBED_MODEL") or LLM_SCRIPT_DEFAULTS.get("embed_model") or "Qwen/Qwen3-Embedding-8B"
DEFAULT_EMBED_BASE_URL = openai_base_url(
    os.getenv("EMBED_BASE_URL")
    or os.getenv("VLLM_BASE_URL")
    or LLM_SCRIPT_DEFAULTS.get("embed_base_url")
    or "http://127.0.0.1:4001"
)
DEFAULT_EMBED_API_KEY = os.getenv("EMBED_API_KEY") or os.getenv("RUNPOD_API_KEY") or DEFAULT_VLLM_API_KEY
DEFAULT_RERANK_BASE_URL = (
    os.getenv("RERANK_BASE_URL")
    or os.getenv("RERANKER_BASE_URL")
    or os.getenv("VLLM_RERANK_BASE_URL")
    or LLM_SCRIPT_DEFAULTS.get("rerank_base_url")
    or "http://127.0.0.1:4002"
)
DEFAULT_RERANK_API_KEY = os.getenv("RERANK_API_KEY") or os.getenv("RUNPOD_API_KEY") or os.getenv("VLLM_API_KEY", "EMPTY")
DEFAULT_RERANK_MODEL = os.getenv("RERANK_MODEL") or LLM_SCRIPT_DEFAULTS.get("rerank_model") or "Qwen/Qwen3-Reranker-4B"


def rerank_endpoint(base_url: str) -> str:
    trimmed = base_url.rstrip("/")
    if trimmed.endswith("/v1"):
        return f"{trimmed}/rerank"
    return f"{trimmed}/v1/rerank"


def search_chroma(
    query: str,
    chroma_dir: Path,
    collection_name: str,
    embed_model: str,
    embed_base_url: str,
    embed_api_key: str,
    top_k: int,
) -> list[dict[str, Any]]:
    embedding_client = create_embedding_client(embed_base_url, embed_api_key)
    query_embedding = generate_embedding(embedding_client, query, embed_model)
    chroma_client = chromadb.PersistentClient(path=str(chroma_dir), settings=Settings(anonymized_telemetry=False))
    collection = chroma_client.get_collection(collection_name)
    results = collection.query(
        query_embeddings=[query_embedding],
        n_results=top_k,
        include=["documents", "metadatas", "distances"],
    )

    candidates = []
    for idx, record_id in enumerate(results["ids"][0]):
        candidates.append(
            {
                "chroma_rank": idx + 1,
                "id": record_id,
                "chroma_distance": results["distances"][0][idx],
                "metadata": results["metadatas"][0][idx],
                "document": results["documents"][0][idx],
            }
        )
    return candidates


def rerank_candidates(
    query: str,
    candidates: list[dict[str, Any]],
    rerank_base_url: str,
    rerank_api_key: str,
    rerank_model: str,
    timeout: int,
) -> list[dict[str, Any]]:
    headers = {}
    if rerank_api_key and rerank_api_key != "EMPTY":
        headers["Authorization"] = f"Bearer {rerank_api_key}"

    response = requests.post(
        rerank_endpoint(rerank_base_url),
        json={
            "model": rerank_model,
            "query": query,
            "documents": [candidate["document"] for candidate in candidates],
        },
        headers=headers,
        timeout=timeout,
    )
    response.raise_for_status()
    payload = response.json()
    rerank_results = payload.get("results") or payload.get("data")
    if not isinstance(rerank_results, list):
        raise ValueError(f"Unexpected reranker response: {json.dumps(payload, ensure_ascii=False)[:1000]}")

    scored_candidates = []
    for result in rerank_results:
        index = result.get("index")
        if index is None or not 0 <= index < len(candidates):
            continue
        score = result.get("relevance_score", result.get("score"))
        if score is None:
            continue
        scored = dict(candidates[index])
        scored["rerank_score"] = score
        scored_candidates.append(scored)

    if not scored_candidates:
        raise ValueError(f"Reranker returned no usable scores: {json.dumps(payload, ensure_ascii=False)[:1000]}")
    return sorted(scored_candidates, key=lambda item: item["rerank_score"], reverse=True)


def trim_document(candidate: dict[str, Any], preview_chars: int | None) -> dict[str, Any]:
    if preview_chars is None:
        return candidate

    trimmed = dict(candidate)
    document = trimmed.pop("document")
    trimmed["document_preview"] = document[:preview_chars]
    return trimmed


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("query")
    parser.add_argument("--chroma-dir", type=Path, default=DEFAULT_CHROMA_DIR)
    parser.add_argument("--collection-name", default=DEFAULT_COLLECTION_NAME)
    parser.add_argument("--embed-model", default=DEFAULT_EMBED_MODEL)
    parser.add_argument("--embed-base-url", default=DEFAULT_EMBED_BASE_URL)
    parser.add_argument("--embed-api-key", default=DEFAULT_EMBED_API_KEY)
    parser.add_argument("--rerank-model", default=DEFAULT_RERANK_MODEL)
    parser.add_argument("--rerank-base-url", default=DEFAULT_RERANK_BASE_URL)
    parser.add_argument("--rerank-api-key", default=DEFAULT_RERANK_API_KEY)
    parser.add_argument("--chroma-top-k", type=int, default=20)
    parser.add_argument("--top-n", type=int, default=3)
    parser.add_argument("--timeout", type=int, default=120)
    parser.add_argument("--preview-chars", type=int, default=1200)
    parser.add_argument("--include-full-documents", action="store_true")
    args = parser.parse_args()

    candidates = search_chroma(
        query=args.query,
        chroma_dir=args.chroma_dir,
        collection_name=args.collection_name,
        embed_model=args.embed_model,
        embed_base_url=args.embed_base_url,
        embed_api_key=args.embed_api_key,
        top_k=args.chroma_top_k,
    )
    ranked = rerank_candidates(
        query=args.query,
        candidates=candidates,
        rerank_base_url=args.rerank_base_url,
        rerank_api_key=args.rerank_api_key,
        rerank_model=args.rerank_model,
        timeout=args.timeout,
    )

    preview_chars = None if args.include_full_documents else args.preview_chars
    output = {
        "query": args.query,
        "chroma_top_k": args.chroma_top_k,
        "top_n": args.top_n,
        "embed_model": args.embed_model,
        "rerank_model": args.rerank_model,
        "results": [
            {"rerank_rank": idx + 1, **trim_document(candidate, preview_chars)}
            for idx, candidate in enumerate(ranked[: args.top_n])
        ],
    }
    print(json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
