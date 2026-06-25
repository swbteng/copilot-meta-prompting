#!/usr/bin/env bash
# run.sh - .venv 위에서 swbc-proxy(refine_copilot) 실행 (git bash 전용)
#
# 사용법 (전부 git bash에서):
#   ./run.sh                                  # 기본 실행 (파일 로깅 on)
#   LOG_ENABLED=0 ./run.sh                    # 파일 로깅 끄고 실행
#   REFINE_API_URL=http://127.0.0.1:8000/refine ./run.sh   # (refine_text 주석 해제 후) 서버 정제
#   ./run.sh --listen-port 8081               # 추가 인자는 그대로 mitmdump로 전달
#
# 전역 파이썬이 아니라 .venv의 mitmdump로 실행한다.

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mitm="$here/.venv/Scripts/mitmdump.exe"
addon="$here/refine_copilot.py"

if [ ! -f "$mitm" ]; then
  echo "[!] .venv 에 mitmdump가 없습니다. 먼저 셋업하세요:"
  echo "    python -m venv .venv"
  echo "    ./.venv/Scripts/python.exe -m pip install -r requirements.txt"
  exit 1
fi

echo "[*] venv mitmdump 실행: $mitm"
# Copilot 호스트만 가로채고 나머지는 그대로 터널링. 추가 인자("$@")는 그대로 전달.
"$mitm" -s "$addon" --allow-hosts 'githubcopilot\.com' "$@"
