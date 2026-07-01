"""모델 서빙 통합 테스트 — 실제 vLLM 서버가 떠 있어야 통과(없으면 skip).

세 엔드포인트(LLM/임베딩/리랭커)가 OpenAI 호환 규약대로 응답하는지 검증한다.
각 테스트는 '실제 입력 -> 실제 서버 출력'을 print 로 남겨 로그가 동작 증거가 되게 한다.
실행:
    pytest tests/program_AI -m integration -s

대응 요구사항:
  R-01  LLM   /v1/chat/completions -> 비어있지 않은 텍스트 응답
  R-02  임베딩 /v1/embeddings       -> 고정 차원(>0) 실수 벡터
  R-03  리랭커 /v1/rerank           -> 질의와 관련된 문서가 상위 점수
"""
import pytest
import requests

from conftest import (
    LLM_URL, EMBED_URL, RERANK_URL,
    LLM_MODEL, EMBED_MODEL, RERANK_MODEL,
    require_reachable,
)


@pytest.mark.integration
def test_llm_chat_completion():
    require_reachable(LLM_URL)
    question = "한 문장으로 자기소개 해줘."
    res = requests.post(
        f"{LLM_URL}/v1/chat/completions",
        json={
            "model": LLM_MODEL,
            "messages": [{"role": "user", "content": question}],
            "max_tokens": 512,
        },
        timeout=120,
    )
    res.raise_for_status()
    msg = res.json()["choices"][0]["message"]
    text = (msg.get("content") or msg.get("reasoning") or "").strip()

    print(f"\n[R-01] INPUT(prompt) = {question!r}")
    print(f"[R-01] OUTPUT(LLM)   = {text!r}")

    assert text, "LLM 응답 텍스트가 비어 있으면 안 된다"


@pytest.mark.integration
def test_embedding_returns_fixed_dim_vector():
    require_reachable(EMBED_URL)
    sentence = "벡터 임베딩 테스트 문장입니다."
    res = requests.post(
        f"{EMBED_URL}/v1/embeddings",
        json={"model": EMBED_MODEL, "input": [sentence]},
        timeout=60,
    )
    res.raise_for_status()
    vec = res.json()["data"][0]["embedding"]

    print(f"\n[R-02] INPUT(text) = {sentence!r}")
    print(f"[R-02] OUTPUT      = dim={len(vec)}, head={vec[:4]}")

    assert isinstance(vec, list) and len(vec) > 0
    assert all(isinstance(x, (int, float)) for x in vec[:8])


@pytest.mark.integration
def test_reranker_orders_relevant_document_first():
    require_reachable(RERANK_URL)
    query = "지구에서 달까지의 거리는 얼마인가?"
    documents = [
        "지구에서 달까지의 평균 거리는 약 38만 4천 킬로미터이다.",   # index 0 = 정답
        "오늘 저녁 메뉴로 삼겹살과 된장찌개를 먹었다.",               # index 1 = 무관
        "커피는 원두를 갈아서 뜨거운 물로 추출해 만든다.",             # index 2 = 무관
    ]
    res = requests.post(
        f"{RERANK_URL}/v1/rerank",
        json={"model": RERANK_MODEL, "query": query, "documents": documents},
        timeout=60,
    )
    res.raise_for_status()
    results = res.json()["results"]

    print(f"\n[R-03] INPUT(query) = {query!r}")
    for r in sorted(results, key=lambda x: x["relevance_score"], reverse=True):
        print(f"         score={r['relevance_score']:.4f}  doc[{r['index']}]={documents[r['index']]!r}")

    best = max(results, key=lambda x: x["relevance_score"])
    assert best["index"] == 0, "정답 문서가 가장 높은 점수를 받아야 한다"
