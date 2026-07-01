# 실행 방법 (RUN)

`swbc-prompt-refiner`(VS Code Copilot Chat에 `@refine`를 추가하는 확장)를 **개발 실행 / 빠른 점검 /
패키징·설치**하는 방법. 모든 쉘 명령은 **git bash** 기준이다.

> 한눈에: **개발은 F5(Node 불필요)**, **패키징만 Node**(`./build.sh`). 런타임 의존성은 0이다.

---

## 1. 개발 실행 (F5 — Node 불필요)

확장은 의존성 0의 순수 JS라 `npm install` 없이 바로 뜬다.

1. VS Code로 **이 폴더(`program_extension/`)** 를 연다.
2. `F5` → **Extension Development Host** 새 창이 열린다.
3. 그 창 우측 **Copilot Chat**에서 호출:
   ```
   @refine 헝가리의 수도가 어디야?
   ```
   → 정제본 미리보기 + **가로 액션 바**(전송 · 수정 · 다시 정제 · 원본 전송 · 취소, codicon 아이콘).
4. 코드를 바꾸면 그 창에서 `Ctrl+R`(Reload Window) → 즉시 반영.

---

## 2. 빠른 로직 점검 (Node)

`refiner.js`는 vscode 없이 import 가능해, 정제 파이프라인만 따로 돌려볼 수 있다.

```bash
export PATH="$PATH:/c/Program Files/nodejs"          # 새 세션이면 1회
node -e "require('./src/refiner').refine('1+1이 뭐야?').then(console.log)"
```

정제본은 정제 서버가 돌려준 그대로다. 템플릿 자리표시자(`${question}`/`${query}` 등) 채움은
**BE(정제) 서버 책임**이라 확장은 손대지 않는다(확장 측 `appendQuestionDefinition`은 주석/보류 — `src/refiner.js`).

---

## 3. 정제 서버 설정

- 정제는 **정제 서버**(`/refine`, `{"prompt": "..."}` POST)로 보내 응답의 `refined`를 받아 온다.
- 기본 URL은 [`src/refiner.js`](src/refiner.js)의 `REFINE_API_URL`에 내장돼 있다.
- 다른 서버를 쓰려면 환경변수 `REFINE_API_URL`로 override한다. 두 가지 방법:
  ```bash
  # (1) 한 번만 인라인으로
  REFINE_API_URL="https://<host>/refine" node -e "require('./src/refiner').refine('테스트').then(console.log)"

  # (2) .env에 적어 두고 현재 쉘에 적용 (.env / .env.example 참고, .env는 gitignore)
  export $(grep -v '^#' .env | xargs)
  node -e "require('./src/refiner').refine('테스트').then(console.log)"
  ```
- `.env`는 **이 점검/패키징 쉘 전용**이다. 확장 런타임/F5는 `.env`를 자동 로드하지 않고 OS 환경변수 또는
  코드 내장 기본값을 쓴다 — 그래서 `.env`가 없어도 정제는 동작한다(기본 URL이 `src/refiner.js`에 내장).
- 서버가 죽었거나 응답이 비면 **원본을 그대로 반환**한다(fail-open — Copilot 흐름을 막지 않는다).

---

## 4. 패키징 / 설치 (.vsix)

배포는 **VSIX 사설 공유**. 이 폴더가 곧 패키징 루트라, 한 줄이면 단일 `.vsix`가 만들어진다.

```bash
./build.sh            # 패키징 → <name>-<version>.vsix (이름/버전은 package.json에서)
./build.sh --install  # 위 + 현재 VS Code에 강제 설치(code --install-extension --force)
```

- **하이브리드 빌드 — 목표: '아무 의존성도 없는 머신에서도 빌드 *가능*'.** `build.sh`가 환경을 보고 두 경로 중 하나를 쓴다.
  - **Tier 1 (선호)**: Node/npm 이 있으면 표준 도구 `@vscode/vsce` 로 패키징. `package.json` 의 **devDependencies**
    (`@vscode/vsce` 버전 핀 = `3.9.2`)를 `npm install` 로 받은 뒤 `vsce package`. (관용적·표준)
  - **Tier 2 (폴백)**: Node 가 없거나 vsce 가 실패하면, **Windows 기본 내장 PowerShell**(`System.IO.Compression`)로
    `.vsix`(= OPC ZIP: `extension.vsixmanifest` + `[Content_Types].xml` + `extension/<파일들>`)를 직접 만든다.
    이 경로는 **설치·네트워크가 전혀 필요 없어** 빈 머신에서도 빌드를 보장한다. 매니페스트 메타데이터는
    `package.json`에서 읽어 vsce 출력 구조를 그대로 재현한다.
  - 두 경로 모두 **동일한 14파일 .vsix**를 만든다(검증됨). 설치(`--install`)는 `code` CLI가 있으면 쓰고,
    없으면 VS Code *Install from VSIX…* 안내로 폴백.
  > 폴백을 'Node 자동설치'로 두지 않은 이유: npm 은 Node 동봉이라 'npm 설치' = 'Node 설치'이고, 그건 항상
  > 네트워크가 필요하고 머신을 변경한다. PowerShell 폴백은 오프라인·무변경이라 그 케이스를 더 잘 커버한다.
- **`.env` 자동 굽기** — `build.sh`는 패키징 직전 `.env`의 `REFINE_API_URL`을 읽어
  `src/env.generated.js`로 구워 `.vsix`에 동봉한다. 그래서 배포된 확장도 `.env`의 서버 주소를 쓴다.
  `.env`가 없거나 키가 비면 빈 값으로 생성되고 **코드 내장 기본값으로 폴백**한다(패키징은 항상 성공).
- **같은 버전 재설치**는 `--install`(=`--force`)이 처리. "업데이트"로 인식시키려면
  `package.json`의 `version`을 올린다(VS Code는 같은 버전을 업데이트로 보지 않는다).
- 개발 중엔 vsix가 필요 없다 — F5 + `Ctrl+R`이면 충분하다.

---

## 5. 확장 설정 (VS Code Settings)

| 설정 키 | 기본값 | 설명 |
|---|---|---|
| `swbcPromptRefiner.logDir` | `""` | 정제 내역 로그(`observe-YYYY-MM-DD.log`) 폴더 절대경로. 비우면 `globalStorage/logs`. |
| `swbcPromptRefiner.maxEntries` | `200` | 사이드바에 표시할 최근 정제 건수 상한. |

---

## 6. 의존성

| 구분 | 비고 |
|---|---|
| 런타임 의존성 | **0** — 순수 JS(Node 내장 `http`/`https`/`url`만 사용). `npm install` 불필요. |
| 패키징 Tier 1(선호) | `@vscode/vsce` **3.9.2**(`package.json` devDependencies, 핀) + Node/npm. 표준. |
| 패키징 Tier 2(폴백) | Windows 기본 내장 PowerShell만(Node/네트워크 불필요) → **빈 머신 빌드 보장**. |
| VS Code 엔진 | `engines.vscode` **^1.90.0** (`package.json`) |
| Node.js | 테스트(`node --test`) + 패키징 Tier 1에 필요(≥ 20.13, 검증 v24.17.0). 없어도 Tier 2로 빌드 가능. |

- 자세한 내용은 [`requirements.txt`](requirements.txt) 참고(파이썬 런타임 의존성 없음을 명시).
