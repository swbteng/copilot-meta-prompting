#!/usr/bin/env bash
# tests/run_tests.sh — 프로그램별 테스트 실행기 (Linux / macOS)
#
# 전제: 파이썬 환경(가상환경 등)은 이미 준비되어 있다고 가정한다.
#       (가상환경 생성·의존성 설치 방법은 RUN.md 참고 — 위치가 서버마다 달라 스크립트에서 다루지 않음)
#       파이썬 인터프리터는 PYTHON 환경변수로 바꿀 수 있다(기본: python).
#
# 사용법 (result_file 어디에서 실행해도 됨):
#   bash tests/run_tests.sh <대상> [--save]
#     대상   : backend | ai | extension | all
#     --save : 결과 로그를 test-results/<프로그램>/ 에 저장 (생략하면 콘솔 출력만)
#
# 예:
#   bash tests/run_tests.sh backend           # 콘솔로만 보기
#   bash tests/run_tests.sh backend --save    # test-results/program_backend/ 에 저장
#   PYTHON=.venv/bin/python tests/run_tests.sh all --save
#
# -s 옵션으로 실행하므로 각 테스트의 '입력 -> 출력' print 가 로그에 그대로 남는다.
#
# 통합 테스트(ai 전체, backend 일부)는 모델 서버가 떠 있어야 통과한다(없으면 자동 skip):
#   - backend 통합: src/program_backend/.env 에 LLM/EMBED/RERANK 연결값을 채운다.
#   - ai 통합: 환경변수 AI_HOST/LLM_PORT/EMBED_PORT/RERANK_PORT/*_MODEL 로 서버를 지정한다.

set -uo pipefail
cd "$(dirname "$0")/.."   # result_file (zip 루트)

PYTHON="${PYTHON:-python}"

TARGET="${1:-all}"
SAVE=""
[ "${2:-}" = "--save" ] && SAVE="yes"

check_python() {
  if ! "$PYTHON" -c "import pytest" >/dev/null 2>&1; then
    echo "[오류] '$PYTHON' 에 pytest/테스트 의존성이 없습니다."
    echo "       가상환경을 먼저 준비하세요(생성·설치 방법은 RUN.md 참고)."
    echo "       - 활성화 후 실행:  source <venv>/bin/activate  (Windows: source <venv>/Scripts/activate)"
    echo "       - 또는 인터프리터 직접 지정:"
    echo "         PYTHON=src/program_backend/.venv/Scripts/python.exe bash tests/run_tests.sh $TARGET ${SAVE:+--save}"
    exit 1
  fi
}

run_py() {  # $1=테스트 디렉터리, $2=test-results 하위 폴더명
  local dir="$1" sub="$2"
  check_python
  if [ "$SAVE" = "yes" ]; then
    mkdir -p "test-results/$sub"
    "$PYTHON" -m pytest "$dir" -v -s \
      --junitxml="test-results/$sub/junit.xml" 2>&1 | tee "test-results/$sub/output.txt"
  else
    "$PYTHON" -m pytest "$dir" -v -s
  fi
}

run_ext() {  # 확장(Node) — 모델 서버 불필요
  if ! command -v npm >/dev/null 2>&1; then
    echo "Node.js 미설치 — 확장 테스트 건너뜀 (Node 설치 후 다시 실행)."
    return
  fi
  if [ "$SAVE" = "yes" ]; then
    mkdir -p test-results/program_extension
    npm run test:extension:junit 2>&1 | tee test-results/program_extension/output.txt
  else
    npm run test:extension
  fi
}

case "$TARGET" in
  backend)   run_py tests/program_backend program_backend ;;
  ai)        run_py tests/program_AI        program_AI ;;
  extension) run_ext ;;
  all)
    run_py tests/program_backend program_backend
    run_py tests/program_AI        program_AI
    run_ext
    ;;
  *)
    echo "사용법: bash tests/run_tests.sh <backend|ai|extension|all> [--save]"
    exit 1
    ;;
esac
