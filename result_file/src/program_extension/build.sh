#!/usr/bin/env bash
# build.sh - 이 폴더(program_extension/)를 .vsix로 패키징한다. (확장 단독 구조 - 엔진 동봉 없음)
#
#   ./build.sh            # 패키징 -> <name>-<version>.vsix (이름/버전은 package.json에서)
#   ./build.sh --install  # 위 + 현재 VS Code에 강제 설치(code --install-extension --force)
#
# [하이브리드 빌드] 목표: '아무 의존성도 없는 머신에서도 빌드가 가능'해야 한다(반드시 그 상태를 '유지'할 필요는 없음).
#   - Tier 1 (선호): Node/npm 이 있으면 표준 도구 @vscode/vsce 로 패키징한다.
#       package.json 의 devDependencies(@vscode/vsce 버전 핀)를 `npm install` 로 받은 뒤 `vsce package`.
#   - Tier 2 (폴백): Node 가 없거나 vsce 가 실패하면, Windows 기본 내장 PowerShell 로 직접 패키징한다.
#       .vsix 는 OPC 규격 ZIP(extension.vsixmanifest + [Content_Types].xml + extension/<파일들>)이라 vsce 없이도 만든다.
#       이 경로는 설치/네트워크가 전혀 필요 없다 -> '빈 머신에서도 빌드 가능'을 보장한다.
#
#   왜 폴백이 'npm/Node 자동설치'가 아닌가: npm 은 Node 에 동봉되어 'npm 설치' = 'Node 설치'다. 그건 항상
#   네트워크가 필요하고 머신을 변경(전역 설치)한다. PowerShell 폴백은 오프라인·무변경이라 목표에 더 잘 맞고,
#   Node 부트스트랩 케이스까지 이미 커버한다(그래서 별도 자동설치 티어를 두지 않는다).
#
# 참고: 개발 중엔 vsix가 필요 없다 - F5로 띄운 Extension Development Host 창에서 'Ctrl+R'이면 즉시 반영.
set -e
cd "$(dirname "$0")"
export PATH="$PATH:/c/Program Files/nodejs"   # 새 git bash 세션 방어적 PATH(있으면 무해)

INSTALL=""
for a in "$@"; do
  case "$a" in
    --install|-i) INSTALL="1" ;;
  esac
done

# --- 1) .env -> src/env.generated.js 굽기 (순수 셸 — Node 불필요, 두 경로 공통) ---
#   패키징된 확장은 VS Code 호스트에서 도므로 .env/OS 환경변수가 없을 수 있다. 빌드 시점에 .env의
#   REFINE_API_URL을 코드 모듈로 구워, refiner.js가 (OS env > 이 파일 > 코드 내장 기본값) 순으로 쓰게 한다.
bake_env() {
  echo "[build] baking .env -> src/env.generated.js ..."
  local url="" esc_url=""
  if [ -f .env ]; then
    url="$(grep -E '^[[:space:]]*REFINE_API_URL[[:space:]]*=' .env | tr -d '\r' | tail -n1 \
          | sed -E 's/^[^=]*=[[:space:]]*//; s/[[:space:]]*$//; s/^"(.*)"$/\1/; s/^'\''(.*)'\''$/\1/')"
  fi
  esc_url="$(printf '%s' "$url" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')"
  cat > src/env.generated.js <<EOF
// [자동 생성] build.sh가 .env 값을 vsix에 구워 넣은 파일. 직접 수정/커밋 금지(.gitignore).
// refiner.js fallback: process.env > (이 파일) > 코드 내장 기본값.
module.exports = { REFINE_API_URL: "${esc_url}" };
EOF
  echo "[build] baked REFINE_API_URL=${url:-<빈값: 코드 내장 기본값 사용>}"
}

# --- 2a) Tier 1: 표준 @vscode/vsce 빌드 (Node/npm 필요). 성공하면 0, 불가/실패면 비0 반환. ---
package_with_vsce() {
  command -v node >/dev/null 2>&1 || return 1
  command -v npm  >/dev/null 2>&1 || return 1
  echo "[build] Node 감지 → 표준 @vscode/vsce 빌드 시도 (package.json devDependencies)"
  # package.json 의 devDependencies(@vscode/vsce 핀) 설치 후, 그 로컬 vsce 로 패키징.
  npm install --no-audit --no-fund || { echo "[build] npm install 실패 → 폴백"; return 1; }
  # npx 는 로컬 node_modules 의 vsce(핀 버전)를 우선 사용한다(재다운로드 없음).
  npx --no-install @vscode/vsce package --allow-missing-repository \
    || npx --yes @vscode/vsce package --allow-missing-repository \
    || { echo "[build] vsce package 실패 → 폴백"; return 1; }
  echo "[build] (표준 vsce 경로로 패키징 완료)"
  return 0
}

# --- 2b) Tier 2: PowerShell 직접 패키징 (Windows 기본 내장 — 설치/네트워크 0). ---
package_with_powershell() {
  echo "[build] PowerShell 직접 패키징(의존성 0, 오프라인) ..."
  local WINPATH PS1
  WINPATH="$(pwd -W 2>/dev/null || pwd)"   # PowerShell에 넘길 Windows 경로(C:/...)
  PS1="$(mktemp).ps1"
  trap 'rm -f "$PS1"' RETURN

  cat > "$PS1" <<'PS'
param([Parameter(Mandatory=$true)][string]$Ext)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $Ext

# --- package.json 읽기(매니페스트 메타데이터 출처: 사람이 적은 단일 소스) ---
$pkg     = Get-Content -Raw -Encoding UTF8 (Join-Path $Ext 'package.json') | ConvertFrom-Json
$name    = $pkg.name
$ver     = $pkg.version
$pub     = $pkg.publisher
$display = if ($pkg.displayName) { $pkg.displayName } else { $name }
$desc    = if ($pkg.description) { $pkg.description } else { '' }
$engine  = $pkg.engines.vscode
$cats    = if ($pkg.categories)  { ($pkg.categories -join ',') } else { 'Other' }
$tags    = if ($pkg.contributes -and $pkg.contributes.chatParticipants) { 'chat-participant' } else { '' }

function XmlEsc([string]$s) {
  if ($null -eq $s) { return '' }
  $s.Replace('&','&amp;').Replace('<','&lt;').Replace('>','&gt;').Replace('"','&quot;')
}

# --- 스테이징: extension/<파일들> 로 런타임에 필요한 것만 복사 ---
$stage  = Join-Path ([System.IO.Path]::GetTempPath()) ('vsixpkg_' + [guid]::NewGuid().ToString('N'))
$extDir = Join-Path $stage 'extension'
New-Item -ItemType Directory -Force -Path $extDir | Out-Null

Copy-Item (Join-Path $Ext 'package.json') (Join-Path $extDir 'package.json')
$hasReadme = Test-Path (Join-Path $Ext 'README.md')
if ($hasReadme) { Copy-Item (Join-Path $Ext 'README.md') (Join-Path $extDir 'readme.md') }   # vsce 관례: 소문자 readme.md
Copy-Item (Join-Path $Ext 'src')   (Join-Path $extDir 'src')   -Recurse
Copy-Item (Join-Path $Ext 'media') (Join-Path $extDir 'media') -Recurse

# 패키지에 섞이면 안 되는 개발 잔재 정리(.vscodeignore 취지: 소스맵/셀프테스트 제외).
#   주의: Get-ChildItem 의 -Include 는 -LiteralPath 와 함께 쓰면 무시되어 '모든 파일'을 반환한다.
#   그래서 Where-Object 로 직접 이름 필터링한다(전체 삭제 방지).
Get-ChildItem -LiteralPath $extDir -Recurse -File |
  Where-Object { $_.Name -like '*.map' -or $_.Name -like '_selftest_*.js' } |
  Remove-Item -Force -ErrorAction SilentlyContinue

# --- extension.vsixmanifest (vsce가 만드는 구조를 그대로 재현) ---
$detailsAsset = if ($hasReadme) {
  "`r`n`t`t<Asset Type=`"Microsoft.VisualStudio.Services.Content.Details`" Path=`"extension/readme.md`" Addressable=`"true`" />"
} else { '' }

$manifest = @"
<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
	<Metadata>
		<Identity Language="en-US" Id="$(XmlEsc $name)" Version="$(XmlEsc $ver)" Publisher="$(XmlEsc $pub)" />
		<DisplayName>$(XmlEsc $display)</DisplayName>
		<Description xml:space="preserve">$(XmlEsc $desc)</Description>
		<Tags>$(XmlEsc $tags)</Tags>
		<Categories>$(XmlEsc $cats)</Categories>
		<GalleryFlags>Public</GalleryFlags>
		<Properties>
			<Property Id="Microsoft.VisualStudio.Code.Engine" Value="$(XmlEsc $engine)" />
			<Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value="" />
			<Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value="" />
			<Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="workspace" />
			<Property Id="Microsoft.VisualStudio.Code.LocalizedLanguages" Value="" />
			<Property Id="Microsoft.VisualStudio.Code.EnabledApiProposals" Value="" />
			<Property Id="Microsoft.VisualStudio.Code.ExecutesCode" Value="true" />
			<Property Id="Microsoft.VisualStudio.Services.GitHubFlavoredMarkdown" Value="true" />
			<Property Id="Microsoft.VisualStudio.Services.Content.Pricing" Value="Free"/>
		</Properties>
	</Metadata>
	<Installation>
		<InstallationTarget Id="Microsoft.VisualStudio.Code"/>
	</Installation>
	<Dependencies/>
	<Assets>
		<Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />$detailsAsset
	</Assets>
</PackageManifest>
"@

$utf8 = New-Object System.Text.UTF8Encoding($false)   # BOM 없는 UTF-8
[System.IO.File]::WriteAllText((Join-Path $stage 'extension.vsixmanifest'), $manifest, $utf8)

# --- [Content_Types].xml : 패키지에 든 확장자별 ContentType (OPC 필수) ---
$map = @{
  'json'='application/json'; 'js'='application/javascript'; 'md'='text/markdown';
  'css'='text/css'; 'svg'='image/svg+xml'; 'xml'='text/xml'; 'vsixmanifest'='text/xml';
  'txt'='text/plain'; 'map'='application/json'; 'png'='image/png'; 'jpg'='image/jpeg'
}
$exts = @(Get-ChildItem -LiteralPath $stage -Recurse -File | ForEach-Object { $_.Extension.TrimStart('.').ToLower() })
$exts += @('vsixmanifest','xml')                       # 매니페스트/콘텐츠타입 자신도 포함
$exts = $exts | Where-Object { $_ -ne '' } | Select-Object -Unique
$defs = foreach ($e in $exts) {
  $ct = if ($map.ContainsKey($e)) { $map[$e] } else { 'application/octet-stream' }
  '  <Default Extension="' + $e + '" ContentType="' + $ct + '" />'
}
$ctxml = '<?xml version="1.0" encoding="utf-8"?>' + "`r`n" +
         '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' + "`r`n" +
         ($defs -join "`r`n") + "`r`n" + '</Types>' + "`r`n"
[System.IO.File]::WriteAllText((Join-Path $stage '[Content_Types].xml'), $ctxml, $utf8)

# --- ZIP(.vsix) 생성: 엔트리 경로를 강제로 forward-slash로(.vsix/OPC 호환) ---
$vsix = Join-Path $Ext ("$name-$ver.vsix")
if (Test-Path -LiteralPath $vsix) { Remove-Item -LiteralPath $vsix -Force }
Add-Type -AssemblyName System.IO.Compression | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem | Out-Null
$fs  = [System.IO.File]::Open($vsix, [System.IO.FileMode]::CreateNew)
$zip = New-Object System.IO.Compression.ZipArchive($fs, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  $stageFull = (Resolve-Path -LiteralPath $stage).Path
  Get-ChildItem -LiteralPath $stage -Recurse -File | ForEach-Object {
    $rel = $_.FullName.Substring($stageFull.Length + 1) -replace '\\','/'
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $rel) | Out-Null
  }
} finally {
  $zip.Dispose(); $fs.Dispose()
}
Remove-Item -LiteralPath $stage -Recurse -Force
Write-Output ('[build] created: ' + (Split-Path $vsix -Leaf))
PS

  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$PS1" "$WINPATH"
}

# --- 실행: 굽기 -> (Tier1 vsce) 실패 시 (Tier2 PowerShell) ---
bake_env
if ! package_with_vsce; then
  echo "[build] Node/vsce 미사용 또는 실패 → PowerShell 폴백으로 빌드"
  package_with_powershell
fi

vsix="$(ls -t *.vsix | head -n1)"
echo "[build] artifact: $vsix"

if [ "$INSTALL" = "1" ]; then
  if command -v code >/dev/null 2>&1; then
    echo "[build] installing into VS Code (force)..."
    code --install-extension "$vsix" --force
    echo "[build] installed. -> VS Code에서 'Developer: Reload Window' 또는 재시작하세요."
  else
    echo "[build] 'code' CLI를 찾지 못했습니다. VS Code에서 'Extensions: Install from VSIX...'로 $vsix 를 설치하세요."
  fi
fi
