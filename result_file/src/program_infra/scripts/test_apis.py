#!/usr/bin/env python
"""3개 vLLM 서버(API)를 호출해보는 테스트 스크립트.

실행: .venv/bin/python scripts/test_apis.py
호스트/포트는 환경변수 HOST, LLM_PORT, RERANK_PORT, EMBED_PORT로 덮어쓸 수 있음.
"""
import os
import requests

HOST = os.environ.get("HOST", "127.0.0.1")
LLM = f"http://{HOST}:{os.environ.get('LLM_PORT', '4000')}"
EMBED = f"http://{HOST}:{os.environ.get('EMBED_PORT', '4001')}"
RERANK = f"http://{HOST}:{os.environ.get('RERANK_PORT', '4002')}"

LLM_MODEL = "cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit"
EMBED_MODEL = "Qwen/Qwen3-Embedding-8B"
RERANK_MODEL = "Qwen/Qwen3-Reranker-4B"


def test_llm():
    r = requests.post(f"{LLM}/v1/chat/completions", json={
        "model": LLM_MODEL,
        "messages": [{"role": "user", "content": "한 문장으로 자기소개 해줘."}],
        "max_tokens": 512,
    }, timeout=120)
    r.raise_for_status()
    msg = r.json()["choices"][0]["message"]
    # 추론 모델: 최종 답변은 content, 생각 과정은 reasoning 필드로 분리됨
    text = (msg.get("content") or msg.get("reasoning") or "").strip()
    print("[LLM]", text)


def test_embedding():
    r = requests.post(f"{EMBED}/v1/embeddings", json={
        "model": EMBED_MODEL,
        "input": ["벡터 임베딩 테스트 문장입니다."],
    }, timeout=60)
    r.raise_for_status()
    vec = r.json()["data"][0]["embedding"]
    print(f"[EMBED] dim={len(vec)} head={vec[:4]}")


def test_reranker():
    r = requests.post(f"{RERANK}/v1/rerank", json={
        "model": RERANK_MODEL,
        "query": "수도가 서울인 나라는?",
        "documents": [
            "대한민국의 수도는 서울이다.",
            "바나나는 노란색 과일이다.",
            "일본의 수도는 도쿄이다.",
        ],
    }, timeout=60)
    r.raise_for_status()
    ranked = sorted(r.json()["results"], key=lambda x: x["relevance_score"], reverse=True)
    print("[RERANK] 점수순:")
    for x in ranked:
        print(f"   {x['relevance_score']:.4f}  doc[{x['index']}]")


if __name__ == "__main__":
    for name, fn in [("LLM", test_llm), ("EMBEDDING", test_embedding), ("RERANKER", test_reranker)]:
        try:
            fn()
        except Exception as e:
            print(f"[{name}] 실패: {e}")
