#!/usr/bin/env bash
# build.sh - extension/ 코드를 .vsix로 패키징한다 (git bash). (확장 단독 구조 - 엔진 동봉 없음)
#
#   ./build.sh            # 패키징 -> swbc-prompt-refiner-<version>.vsix
#   ./build.sh --install  # 위 + 현재 VS Code에 강제 설치(code --install-extension --force)
#
# 이 확장은 순수 JS(의존성 0)라 동봉할 바이너리가 없다 - vsix는 작다(수십 KB).
# vsce는 전역 설치 없이 npx로 on-demand 실행한다(이 머신엔 Node 설치돼 있음).
#
# 참고: 개발 중엔 vsix가 필요 없다 - F5로 띄운 Extension Development Host 창에서 'Ctrl+R'이면 즉시 반영.
set -e
cd "$(dirname "$0")"

# 새 git bash 세션은 PATH에 Node가 아직 없을 수 있어 방어적으로 추가(있으면 무해).
export PATH="$PATH:/c/Program Files/nodejs"

INSTALL=""
for a in "$@"; do
  case "$a" in
    --install|-i) INSTALL="1" ;;
  esac
done

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
