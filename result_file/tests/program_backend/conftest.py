"""pytest 공통 설정 — program_backend 테스트.

역할:
  1) 백엔드 소스(src/program_backend)를 import 경로에 추가한다.
     (app.py 등이 `import config`, `import pipeline` 처럼 절대 임포트를 쓰기 때문)
  2) 'integration'(서버 필요) 마커를 등록하고, 서버가 없으면 건너뛰는 헬퍼를 제공한다.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

# tests/program_backend/conftest.py -> parents[2] = result_file
SRC_DIR = Path(__file__).resolve().parents[2] / "src" / "program_backend"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))


def pytest_configure(config: pytest.Config) -> None:
    # @pytest.mark.integration 사용 시 "unknown marker" 경고가 뜨지 않게 등록.
    config.addinivalue_line(
        "markers",
        "integration: 실제 vLLM 모델 서버가 떠 있어야 통과하는 통합 테스트 (없으면 skip).",
    )


def require_reachable(url: str) -> None:
    """url(헬스/베이스)이 응답하지 않으면 해당 테스트를 skip한다.

    통합 테스트 맨 앞에서 호출한다. 서버가 꺼져 있으면 실패가 아니라 '건너뜀'으로 처리해
    개발/평가 환경 어디서든 테스트 수트가 깨지지 않게 한다.
    """
    import requests  # 지역 임포트: 단위 테스트만 돌릴 땐 불필요

    if not url:
        pytest.skip("서버 URL이 설정되지 않음(.env 미설정) — 통합 테스트 skip")
    try:
        requests.get(url, timeout=3)
    except Exception as exc:  # 연결 거부/타임아웃 등
        pytest.skip(f"서버에 접속할 수 없음({url}): {exc} — 통합 테스트 skip")
