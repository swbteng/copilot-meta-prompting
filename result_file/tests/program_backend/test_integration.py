"""파이프라인 통합 테스트 — 실제 vLLM 모델 서버가 떠 있어야 통과.

서버가 꺼져 있거나 .env 가 비어 있으면 자동 skip 한다(실패 아님).
실행하려면 program_backend/.env 에 LLM/EMBED/RERANK 연결값을 채우고 서버를 띄운 뒤:
    pytest tests/program_backend -m integration -s   # -s 로 실제 입력/출력을 로그에 남김

각 테스트는 '실제 입력 -> 실제 모델 출력'을 print 로 남겨, 로그가 그 자체로 동작 증거가 되게 한다.

대응 요구사항:
  R-05  POST /rewrite -> translated_input / rewritten_prompt (실서버)
  R-07  POST /search  -> top_k 후보 + 필수 필드 (실서버)
  R-10  POST /refine  -> refined + 중간 산출물 (실서버, 전체 파이프라인)
"""
import pytest
from fastapi.testclient import TestClient

import config
import app as app_module
from conftest import require_reachable

client = TestClient(app_module.app)


@pytest.mark.integration
def test_rewrite_endpoint_live():
    require_reachable(config.LLM_BASE_URL)
    prompt = "1더하기1?"
    res = client.post("/rewrite", json={"prompt": prompt})
    assert res.status_code == 200
    data = res.json()

    print(f"\n[R-05] INPUT(prompt)       = {prompt!r}")
    print(f"[R-05] OUTPUT.translated   = {data.get('translated_input')!r}")
    print(f"[R-05] OUTPUT.rewritten    = {data.get('rewritten_prompt')!r}")

    assert "translated_input" in data
    assert "rewritten_prompt" in data
    assert isinstance(data["rewritten_prompt"], str) and data["rewritten_prompt"].strip()


@pytest.mark.integration
def test_search_endpoint_live():
    require_reachable(config.EMBED_BASE_URL)
    query = "분기 매출 예측 보고서"
    res = client.post("/search", json={"query": query, "top_k": 5})
    assert res.status_code == 200
    results = res.json()["results"]

    print(f"\n[R-07] INPUT(query) = {query!r}, top_k=5")
    print(f"[R-07] OUTPUT       = {len(results)}개 후보")
    for r in results:
        title = (r.get("metadata") or {}).get("title")
        print(f"         rank={r['chroma_rank']} id={r['id']} dist={r['chroma_distance']:.4f} title={title!r}")

    assert 0 < len(results) <= 5
    for cand in results:
        for key in ("chroma_rank", "id", "chroma_distance", "metadata", "document"):
            assert key in cand


@pytest.mark.integration
def test_refine_full_pipeline_live():
    require_reachable(config.LLM_BASE_URL)
    require_reachable(config.EMBED_BASE_URL)
    require_reachable(config.RERANK_BASE_URL)
    prompt = "발표 자료 만들어줘"
    res = client.post("/refine", json={"prompt": prompt})
    assert res.status_code == 200
    data = res.json()

    print(f"\n[R-10] INPUT(prompt)        = {prompt!r}")
    print(f"[R-10] 중간.rewritten_prompt = {data.get('rewritten_prompt')!r}")
    print(f"[R-10] 중간.선택 템플릿       = "
          f"{[(t.get('title'), t.get('rerank_score')) for t in data.get('templates', [])]}")
    print(f"[R-10] OUTPUT.refined       =\n{data.get('refined')}")

    assert data["refined"].strip()              # 최종 정제 프롬프트
    assert "templates" in data                    # 중간 산출물(선택된 템플릿들)
    assert "rewritten_prompt" in data
