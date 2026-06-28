"""자족 RAG 검색/리랭킹 — program_db 에서 backend 로 흡수(build_vector_db 의존 제거).

- search_chroma: 쿼리를 임베딩해 Chroma 에서 top-k 후보를 가져온다.
- rerank_candidates: 리랭커로 후보를 재점수화해 정렬한다.

모든 연결 인자(base_url/model/key/chroma_dir 등)는 호출 측(pipeline)이 config 에서 넘긴다.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import chromadb
import requests
from chromadb.config import Settings
from openai import OpenAI


def create_embedding_client(base_url: str, api_key: str) -> OpenAI:
    return OpenAI(base_url=base_url, api_key=api_key)


def generate_embedding(client: OpenAI, text: str, model_name: str) -> list[float]:
    response = client.embeddings.create(model=model_name, input=[text])
    return response.data[0].embedding


def _rerank_endpoint(base_url: str) -> str:
    trimmed = base_url.rstrip("/")
    return f"{trimmed}/rerank" if trimmed.endswith("/v1") else f"{trimmed}/v1/rerank"


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
        _rerank_endpoint(rerank_base_url),
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
