"""검색/리랭킹 순수 로직 단위 테스트 (외부 서버 불필요).

리랭커 HTTP 호출(`retrieval.requests.post`)을 가짜로 대체해, 응답을
점수 내림차순으로 정렬하고 각 후보에 rerank_score 를 붙이는 로직을 검증한다.
각 테스트는 '입력 -> 출력'을 print 로 남긴다.

대응 요구사항:
  R-08  (3단계 리랭킹) rerank_score 내림차순 정렬 + 각 항목에 점수 부착,
        그리고 pipeline.rerank 의 top_n 절단.
"""
import pytest

import retrieval
import pipeline


class _FakeResponse:
    """requests.post 가 돌려주는 응답 객체를 흉내 낸 가짜."""

    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        pass  # 200 OK 라고 가정

    def json(self):
        return self._payload


def test_rerank_candidates_sorts_desc_and_attaches_score(monkeypatch):
    """리랭커 점수가 높은 순으로 재정렬되고, rerank_score 가 붙는다."""
    candidates = [
        {"id": "a", "document": "문서 A"},
        {"id": "b", "document": "문서 B"},
        {"id": "c", "document": "문서 C"},
    ]
    # 리랭커가 b(0.9) > c(0.5) > a(0.1) 로 평가했다고 가정
    fake_payload = {
        "results": [
            {"index": 0, "relevance_score": 0.1},
            {"index": 1, "relevance_score": 0.9},
            {"index": 2, "relevance_score": 0.5},
        ]
    }
    monkeypatch.setattr(
        retrieval.requests, "post", lambda *a, **k: _FakeResponse(fake_payload)
    )

    ranked = retrieval.rerank_candidates(
        query="질의",
        candidates=candidates,
        rerank_base_url="http://fake",
        rerank_api_key="EMPTY",
        rerank_model="fake-model",
        timeout=5,
    )

    print(f"\n[R-08] INPUT(candidates) = {[c['id'] for c in candidates]}")
    print(f"[R-08] INPUT(점수)        = a=0.1, b=0.9, c=0.5")
    print(f"[R-08] OUTPUT(정렬)       = {[(r['id'], r['rerank_score']) for r in ranked]}")

    # 정렬 순서: b, c, a
    assert [item["id"] for item in ranked] == ["b", "c", "a"]
    # 각 항목에 점수가 붙고, 내림차순이다
    scores = [item["rerank_score"] for item in ranked]
    assert scores == sorted(scores, reverse=True)
    assert ranked[0]["rerank_score"] == 0.9


def test_rerank_candidates_raises_when_no_usable_scores(monkeypatch):
    """점수를 하나도 못 쓰면 명확히 에러를 낸다(조용히 빈 결과 금지)."""
    monkeypatch.setattr(
        retrieval.requests, "post", lambda *a, **k: _FakeResponse({"results": []})
    )
    with pytest.raises(ValueError) as exc_info:
        retrieval.rerank_candidates(
            query="q",
            candidates=[{"id": "a", "document": "d"}],
            rerank_base_url="http://fake",
            rerank_api_key="EMPTY",
            rerank_model="m",
            timeout=5,
        )
    print(f"\n[R-08] INPUT(빈 results) -> OUTPUT = ValueError: {str(exc_info.value)[:60]}...")


def test_pipeline_rerank_truncates_to_top_n(monkeypatch):
    """pipeline.rerank 는 정렬된 결과에서 상위 top_n 개만 남긴다."""
    # 설정 가드(_require)를 통과시키기 위한 더미 값
    monkeypatch.setattr(pipeline.config, "RERANK_BASE_URL", "http://fake", raising=False)
    monkeypatch.setattr(pipeline.config, "RERANK_MODEL", "fake-model", raising=False)

    # search 는 후보 5개를 준다고 가정(임베딩/Chroma 호출 없이)
    fake_candidates = [{"id": str(i), "document": f"d{i}"} for i in range(5)]
    monkeypatch.setattr(pipeline, "search", lambda query, top_k=None: fake_candidates)

    # rerank_candidates 는 이미 정렬돼 돌아온다고 가정(점수 부착)
    def fake_rank(query, candidates, **kwargs):
        return [dict(c, rerank_score=1.0 - i * 0.1) for i, c in enumerate(candidates)]

    monkeypatch.setattr(pipeline, "rerank_candidates", fake_rank)

    out = pipeline.rerank("질의", chroma_top_k=5, top_n=2)

    print(f"\n[R-08] INPUT  = 후보 5개, top_n=2")
    print(f"[R-08] OUTPUT = {len(out)}개 -> {[r['id'] for r in out]}")

    assert len(out) == 2  # top_n=2 만 남는다
    assert out[0]["id"] == "0"
