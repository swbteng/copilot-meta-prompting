"""FastAPI 엔드포인트 단위 테스트 (외부 모델 서버 불필요).

TestClient 로 실제 HTTP 요청 없이 앱을 인메모리로 호출한다.
파이프라인 단계(LLM/임베딩/리랭커)는 호출하지 않거나 가짜로 대체한다.
각 테스트는 '요청 -> 응답'을 print 로 남긴다.

대응 요구사항:
  R-04  GET /health -> 200 {"status":"ok"}
  R-11  파이프라인 단계 실패 시 /refine 가 500 + 오류 메시지
  R-12  CORS 허용 (Access-Control-Allow-Origin: *)
  R-14  GET /viz/map 이 번들 아티팩트만으로 points/clusters 반환(서버 불필요)
"""
import pytest
from fastapi.testclient import TestClient

import app as app_module
import pipeline

client = TestClient(app_module.app)


# ----------------------------------------------------------------------------
# R-04: 헬스체크
# ----------------------------------------------------------------------------
def test_health_returns_ok():
    res = client.get("/health")
    print(f"\n[R-04] REQUEST  = GET /health")
    print(f"[R-04] RESPONSE = {res.status_code} {res.json()}")
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}


# ----------------------------------------------------------------------------
# R-11: 단계 실패 -> 500
# ----------------------------------------------------------------------------
def test_refine_returns_500_on_pipeline_error(monkeypatch):
    """파이프라인이 예외를 던지면 서버가 죽지 않고 500을 반환한다."""
    def boom(*args, **kwargs):
        raise RuntimeError("단계 실패 시뮬레이션")

    monkeypatch.setattr(pipeline, "run_full", boom)

    res = client.post("/refine", json={"prompt": "안녕"})
    print(f"\n[R-11] REQUEST  = POST /refine (파이프라인이 예외를 던지는 상황)")
    print(f"[R-11] RESPONSE = {res.status_code} {res.json()}")
    assert res.status_code == 500
    assert "단계 실패 시뮬레이션" in res.json()["detail"]


# ----------------------------------------------------------------------------
# R-12: CORS 허용
# ----------------------------------------------------------------------------
def test_cors_header_present():
    """다른 origin 에서의 요청에 CORS 허용 헤더가 붙는다."""
    res = client.get("/health", headers={"Origin": "http://example.com"})
    print(f"\n[R-12] REQUEST  = GET /health (Origin: http://example.com)")
    print(f"[R-12] RESPONSE = access-control-allow-origin: {res.headers.get('access-control-allow-origin')!r}")
    assert res.headers.get("access-control-allow-origin") == "*"


# ----------------------------------------------------------------------------
# R-14: 벡터 DB 지도(정적 아티팩트만으로 동작)
# ----------------------------------------------------------------------------
def test_viz_map_returns_points_and_clusters():
    """임베딩 서버 없이도 미리 계산된 지도(points/clusters)를 반환한다."""
    res = client.get("/viz/map")
    data = res.json()
    print(f"\n[R-14] REQUEST  = GET /viz/map (임베딩 서버 없이)")
    print(f"[R-14] RESPONSE = {res.status_code}, points={len(data.get('points', []))}개, "
          f"clusters={len(data.get('clusters', []))}개")
    print(f"[R-14] point[0] = {data['points'][0]}")
    assert res.status_code == 200
    assert "points" in data and "clusters" in data
    assert len(data["points"]) > 0
    # 각 점은 좌표와 군집 정보를 가진다
    first = data["points"][0]
    for key in ("id", "x", "y", "cluster"):
        assert key in first
