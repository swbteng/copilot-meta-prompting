#!/usr/bin/env bash
# build.sh - 이 폴더(program_extension/)를 .vsix로 패키징한다 (git bash). (확장 단독 구조 - 엔진 동봉 없음)
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

# .env가 있으면 그 값을 vsix에 '구워 넣는다'(src/env.generated.js 생성 -> vsce가 동봉).
#   패키징된 확장은 VS Code 호스트에서 도므로 .env/OS 환경변수가 없을 수 있다. 그래서 빌드 시점에
#   .env 값을 코드 모듈로 구워 넣어, refiner.js가 (OS env > 이 파일 > 코드 내장 기본값) 순으로 쓰게 한다.
#   .env가 없거나 키가 비면 빈 값으로 생성되고, refiner.js는 코드 내장 기본값으로 폴백한다(문제 없음).
echo "[build] baking .env -> src/env.generated.js ..."
node <<'NODE'
const fs = require("fs");
let url = "";
try {
  const t = fs.readFileSync(".env", "utf8");
  for (const line of t.split(/\r?\n/)) {
    const m = line.match(/^\s*REFINE_API_URL\s*=\s*(.*?)\s*$/); // 마지막 정의가 이김
    if (m) url = m[1].replace(/^["']|["']$/g, "").trim();       // 양끝 따옴표 제거
  }
} catch (e) { /* .env 없음 -> 빈 값(코드 내장 기본값 사용) */ }
const out =
  "// [자동 생성] build.sh가 .env 값을 vsix에 구워 넣은 파일. 직접 수정/커밋 금지(.gitignore).\n" +
  "// refiner.js fallback: process.env > (이 파일) > 코드 내장 기본값.\n" +
  "module.exports = { REFINE_API_URL: " + JSON.stringify(url) + " };\n";
fs.writeFileSync("src/env.generated.js", out);
console.log("[build] baked REFINE_API_URL=" + (url || "<빈값: 코드 내장 기본값 사용>"));
NODE

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
