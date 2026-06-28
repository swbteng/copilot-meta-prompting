#!/usr/bin/env bash
# build.sh - 현재 extension/ 코드를 '자기완결' .vsix로 패키징한다 (git bash).
#
#   ./build.sh                  # 엔진 준비(없으면 다운로드) + 패키징 -> swbc-prompt-refiner-<version>.vsix
#   ./build.sh --install        # 위 + 현재 VS Code에 강제 설치(code --install-extension --force)
#   ./build.sh --refresh-engine # mitmdump 바이너리를 강제로 다시 받은 뒤 패키징
#
# 동봉(engine/): standalone mitmdump.exe(파이썬 불필요) + refine_copilot.py(애드온).
#   - refine_copilot.py는 매 빌드마다 저장소 루트에서 복사해 '항상 동기화'한다.
#   - mitmdump.exe는 한 번 받아두면 캐시한다(85MB zip -> 27MB exe).
# vsce는 전역 설치 없이 npx로 on-demand 실행한다(이 머신엔 Node 설치돼 있음).
#
# 참고: 개발 중엔 vsix가 필요 없다 - F5로 띄운 Extension Development Host 창에서 'Ctrl+R'면 즉시 반영.
set -e
cd "$(dirname "$0")"

# 새 git bash 세션은 PATH에 Node가 아직 없을 수 있어 방어적으로 추가(있으면 무해).
export PATH="$PATH:/c/Program Files/nodejs"

MITM_VERSION="12.2.3"   # requirements.txt(mitmproxy==12.2.3)와 맞춤
MITM_URL="https://downloads.mitmproxy.org/${MITM_VERSION}/mitmproxy-${MITM_VERSION}-windows-x86_64.zip"

# 인자 파싱
REFRESH=""
INSTALL=""
for a in "$@"; do
  case "$a" in
    --refresh-engine) REFRESH="1" ;;
    --install|-i) INSTALL="1" ;;
  esac
done

ensure_engine() {
  mkdir -p engine
  # 애드온은 항상 루트와 동기화(refine_copilot.py 수정이 바로 vsix에 반영되도록).
  cp ../refine_copilot.py engine/refine_copilot.py
  if [ -n "$REFRESH" ] || [ ! -f engine/mitmdump.exe ]; then
    echo "[engine] downloading standalone mitmdump ${MITM_VERSION} (~85MB zip)..."
    curl -L --fail --max-time 600 -o engine/_dl.zip "$MITM_URL"
    unzip -o -j engine/_dl.zip mitmdump.exe -d engine/
    rm -f engine/_dl.zip
    echo "[engine] mitmdump.exe ready ($(du -h engine/mitmdump.exe | cut -f1))."
  else
    echo "[engine] mitmdump.exe 캐시 사용. (--refresh-engine로 재다운로드)"
  fi
}

ensure_engine

echo "[build] packaging..."
npx --yes @vscode/vsce package --allow-missing-repository

vsix="$(ls -t *.vsix | head -n1)"
echo "[build] created: $vsix"

if [ "$INSTALL" = "1" ]; then
  if command -v code >/dev/null 2>&1; then
    echo "[build] installing into VS Code (force)..."
    code --install-extension "$vsix" --force
    echo "[build] installed. -> VS Code에서 'Developer: Reload Window' 또는 재시작하세요."
  else
    echo "[build] 'code' CLI를 찾지 못했습니다. VS Code에서 'Extensions: Install from VSIX...'로 $vsix 를 설치하세요."
  fi
fi
