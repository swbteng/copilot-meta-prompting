# Prompt Refiner — Copilot Chat 프롬프트 정제 확장

> **한 줄 소개** — VS Code Copilot Chat에 `@refine`를 추가해, 사용자가 막 던진 프롬프트를
> **LLM이 더 잘 답하도록 정제(meta-prompting)** 한 뒤, **미리보기 + 승인 게이트**를 거쳐 네이티브
> Copilot에 보내고, 정제 내역을 사이드바에 **원본 → 정제본** 카드로 쌓아 주는 VS Code 확장.

---

## 1. 무엇을, 왜 (프로젝트 목적)

LLM 코딩 어시스턴트(Copilot)의 답 품질은 **프롬프트의 질**에 크게 좌우된다. 하지만 사용자는 보통
짧고 모호하게 묻는다(예: `"정렬 코드 짜줘"`). 이 프로젝트는 그 사이에 **정제 계층**을 끼워 넣는다.

- **문제** — 거칠고 모호한 프롬프트 → 빗나간 답 → 사용자가 다시 묻는 비효율.
- **해법(meta-prompting)** — 사용자의 입력을 **구조화·구체화된 프롬프트로 자동 재작성**해
  Copilot에 전달한다. 단, **사용자 통제권**을 지키기 위해 보내기 전에 **미리보기 + 승인 게이트**를 둔다.
- **부가가치** — 어떤 프롬프트가 어떻게 정제됐는지 **로그·시각화**해 학습/회고에 쓰게 한다.

핵심 설계 철학은 **"끼어들되 가로막지 않는다"** 이다. 정제는 `@refine`로 **명시 호출**했을 때만 일어나고,
서버 장애·예외 등 어떤 문제에서도 **원본을 그대로 흘려보내(fail-open)** Copilot 흐름을 막지 않는다.

---

## 2. 동작 한눈에 (데모 흐름)

```
사용자: @refine 헝가리의 수도가 어디야?
            │
            ▼
 ┌──────────────────────────────────────────────────────────────┐
 │  @refine 참가자(chat.js)                                       │
 │   1) refine() 호출 → 정제 서버(/refine)로 POST                 │
 │   2) 정제본 '미리보기' + 가로 액션 바(아이콘 버튼 5개)          │
 │                                                                │
 │   정제본 미리보기                                              │
 │   > 다음 질문에 정확히 답하세요. 사용자 입력: 헝가리의 수도... │
 │   _원본_: 헝가리의 수도가 어디야?                              │
 │                                                                │
 │   ✓ 전송 · ✎ 수정 · ↻ 다시 정제 · → 원본 전송 · ✕ 취소         │
 └──────────────────────────────────────────────────────────────┘
            │  (사용자가 '전송' 승인)
            ▼
 네이티브 Copilot Chat에 정제본을 제출 → Copilot이 평소처럼 답변
            │  (동시에)
            ▼
 좌측 사이드바에 "원본 → 정제본" 카드 1장 기록(JSONL 로그)
```

승인은 **5가지 선택지**로 갈린다.

| 액션 | 동작 | 전송 | 로그 |
|---|---|---|---|
| **✓ 전송 (allow)** | 정제본을 Copilot에 자동 전송 | O (정제본) | 기록(원본→정제본) |
| **✎ 수정 (modify)** | 정제본을 입력창에 채워 손본 뒤 엔터 | 사용자 엔터 | - |
| **↻ 다시 정제 (try again)** | 원본으로 재정제 → 새 미리보기 | - | - |
| **→ 원본 전송 (use original)** | 정제 없이 원본 그대로 전송 | O (원본) | - |
| **✕ 취소 (cancel)** | 원본을 입력창에 돌려놓음 | - | - |

---

## 3. 전체 구조 (아키텍처)

이 확장은 **프런트엔드(VS Code 확장)** 와 **백엔드(정제 서버)** 로 나뉘며, 이 저장소(`program_extension/`)는
**확장(FE)** 만 담당한다. 정제 알고리즘(LLM 호출 등)은 BE 서버 `/refine`가 책임진다.

```
┌─────────────────────────── VS Code (Extension Host) ───────────────────────────┐
│                                                                                 │
│   Copilot Chat 패널                          좌측 Activity Bar 사이드바          │
│   ┌───────────────────────┐                 ┌──────────────────────────┐        │
│   │  @refine 참가자        │   정제 1건       │  WebviewView (정제 내역) │        │
│   │  (chat.js)            │   기록 ───────▶ │  (extension.js + media/) │        │
│   │   · 미리보기/액션 바   │                 │   · 카드 렌더/검색/diff   │        │
│   │   · 승인 게이트        │   ◀─ 폴더 감시  │   · JSONL 읽기(logReader)│        │
│   └──────────┬────────────┘   (fs.watch)    └──────────────────────────┘        │
│              │ refine(text)                          ▲                           │
│              ▼                                        │ append(JSONL)             │
│   ┌───────────────────────┐                ┌─────────┴──────────┐                │
│   │ refiner.js            │   같은 폴더      │ logger.js          │                │
│   │  callRefineApi()      │   (config.js)   │ observe-<날짜>.log │                │
│   └──────────┬────────────┘                └────────────────────┘                │
│              │ HTTP POST {"prompt": "..."}                                        │
└──────────────┼──────────────────────────────────────────────────────────────────┘
               ▼
   ┌──────────────────────────────┐
   │ 정제 서버(BE)  POST /refine   │   응답: {"refined": "...", ...}
   │ (LLM 기반 프롬프트 재작성)     │   ※ ${question} 등 자리표시자 채움도 BE 책임
   └──────────────────────────────┘
```

**모듈 책임 (`src/`)**

| 파일 | 책임 |
|---|---|
| `extension.js` | 진입점. 사이드바 WebviewView 등록 + 로그 폴더 `fs.watch` 감시 + `@refine` 참가자 등록. |
| `chat.js` | `@refine` 참가자. 정제 미리보기 + **가로 액션 바** + 5개 명령. 전송은 `workbench.action.chat.open`. |
| `refiner.js` | **유일한 refiner**. `refine()`(서버 호출/폴백) + `callRefineApi()`(`http`/`https`로 `/refine` POST). |
| `logger.js` | 승인(allow) 시 `observe-YYYY-MM-DD.log`에 **JSONL 한 줄 append**(스키마 동결, fail-open). |
| `logReader.js` | `observe-*.log`(JSONL) 줄 단위 읽기/파싱(fail-soft). |
| `config.js` | 로그 폴더(쓰는 쪽·읽는 쪽 **단일 소스**) / 최대 표시 건수 해석. |
| `env.generated.js` | **빌드 산출물**. `build.sh`가 `.env`를 구워 넣음(있을 때만, `.gitignore`). |
| `media/` | `icon.svg` · `main.css`(테마 변수) · `main.js`(카드 렌더/검색/diff). |

---

## 4. 동작 원리 (단계별)

1. **명시 호출** — 사용자가 `@refine <프롬프트>` 입력. (그 외 평범한 프롬프트는 **건드리지 않는다** —
   확장 API로는 가로챌 수도 없고, 그게 의도다.)
2. **정제 요청** — `refiner.js`가 정제 서버에 `POST /refine`, 본문 `{"prompt": "<원본>"}`(UTF-8).
   응답 JSON에서 `refined`(없으면 `text/result/...`) 키의 문자열을 정제본으로 취한다.
3. **미리보기 + 승인 게이트** — `chat.js`가 정제본을 `stream.markdown`으로 보여주고, **codicon 커맨드
   링크**로 만든 가로 액션 바(전송/수정/다시 정제/원본 전송/취소)를 제시한다.
4. **전송 위임** — 승인 시 `workbench.action.chat.open`으로 **네이티브 Copilot에 그대로 제출**한다.
   답변은 평소처럼 Copilot 스레드에 뜨고, 에이전트/툴도 그대로 동작한다.
5. **기록 & 시각화** — 승인(allow) 1건마다 `logger.js`가 JSONL 한 줄을 append → `extension.js`의
   `fs.watch`가 변화를 감지(250ms 디바운스) → 사이드바가 다시 읽어 **원본→정제본 카드**로 렌더.

> **`${question}` 같은 자리표시자 채움은 BE 서버 책임**이다. 확장은 정제 서버가 돌려준 정제본을 **그대로**
> 쓴다(확장 측에서 채우던 로직은 `src/refiner.js`에 주석/보류로 남겨 두었다 — 서버가 못 채우게 되면 되살린다).

---

## 5. 사용된 기술 (기술 스택)

| 분류 | 기술 | 어디에 |
|---|---|---|
| 확장 플랫폼 | **VS Code Extension API** (`engines.vscode ^1.90`) | 전반 |
| 채팅 연동 | **Chat Participant API** (`vscode.chat.createChatParticipant`, `ChatResponseStream`) | `chat.js` |
| 액션 UI | **Trusted `MarkdownString` + codicon 커맨드 링크**(`isTrusted`/`supportThemeIcons`) | `chat.js` |
| 사이드바 | **Webview View API** + **CSP/nonce** 보안, 테마 변수 기반 CSS | `extension.js`, `media/` |
| 네트워킹 | **Node 내장 `http`/`https`/`url`** (추가 의존성 0) | `refiner.js` |
| 데이터 | **JSONL** 로그(append-only) + `fs.watch` 실시간 반영 | `logger.js`, `logReader.js` |
| 패키징 | **`@vscode/vsce`** (npx로 on-demand) | `build.sh` |
| 런타임 의존성 | **0개** (순수 JavaScript, `npm install` 불필요) | — |

> **왜 의존성 0인가** — 외부 패키지를 쓰지 않아 공급망 위험이 없고, `.vsix`가 수십 KB로 작으며,
> 설치/리뷰가 단순하다. 네트워크·파일·해시 등은 전부 Node 표준 모듈로 처리한다.

---

## 6. 설계 원칙 (불변식)

- **fail-open** — 핸들러/정제/로깅은 전부 `try/catch`. 어떤 에러에서도 **원본을 흘려보내** Copilot 흐름을
  막지 않는다. (서버 장애 = 정제 없이 원본 전송)
- **명시 호출만** — `@refine`로 부른 **현재 요청만** 정제한다. 그 외 트래픽은 무수정.
- **승인 게이트** — 정제본은 사용자가 **눈으로 보고 고른 뒤**에만 전송된다(자동 치환 강요 없음).
- **단일 소스 로그 폴더** — 쓰는 쪽(`logger`)과 읽는 쪽(사이드바)이 `config.resolveLogDir()` **하나**를 공유.
- **JSONL 스키마 동결** — `{"ts","channel","model","before","after"}`. 사이드바가 읽는 **데이터 계약**이라
  바꾸려면 `logger.js`·`logReader.js`를 함께 고친다.
- **사용자 데이터 보존** — 정제 로그(`observe*.log`)는 삭제/덮어쓰지 않는다.

---

## 7. 디렉터리 구조

```
program_extension/                 # ← 이 폴더가 곧 .vsix 패키징 루트
├─ package.json                    # 매니페스트(@refine 참가자 / 사이드바 / 명령 / 설정)
├─ src/                            # 확장 코드(런타임)
│  ├─ extension.js · chat.js · refiner.js · logger.js · logReader.js · config.js
│  └─ env.generated.js            # (빌드 시 .env에서 자동 생성, gitignore)
├─ media/                          # icon.svg · main.css · main.js (사이드바 UI)
├─ build.sh                        # .vsix 패키징(+ .env 굽기) 런처 — git bash
├─ .env / .env.example             # 환경변수(.env는 gitignore, example만 커밋)
├─ .vscode/launch.json             # F5 실행 설정
├─ .vscodeignore / .gitignore      # 패키징·추적 제외 목록
├─ README.md · RUN.md · AGENTS.md · CLAUDE.md · requirements.txt
└─ docs/                           # 개발 계획 · 워크로그(.vsix 미포함)
```

런타임에 `.vsix`로 들어가는 것은 `package.json` · `src/` · `media/` 뿐이다(문서/개발 파일은 제외).

---

## 8. 빠르게 실행 (F5 — Node 불필요)

확장은 **의존성 0의 순수 JS**라 `npm install` 없이 바로 뜬다.

1. VS Code로 **이 `program_extension/` 폴더**를 연다.
2. `F5` → **Extension Development Host** 새 창이 뜬다.
3. 그 창 우측 **Copilot Chat**에서 `@refine 1+1이 뭐야?` 입력 → 정제본 미리보기 + 가로 액션 바.
4. 코드를 바꾸면 `Ctrl+R`(Reload Window)로 즉시 반영.

> 정제 서버에 붙지 않아도 동작한다(fail-open) — 서버가 없으면 원본이 그대로 전송된다.
> 자세한 실행/점검/패키징은 `RUN.md` 참고.

---

## 9. 설정 · 환경변수

**VS Code 설정**

| 키 | 기본값 | 설명 |
|---|---|---|
| `swbcPromptRefiner.logDir` | `""` | 정제 내역 로그 폴더 절대경로(비우면 `globalStorage/logs`). |
| `swbcPromptRefiner.maxEntries` | `200` | 사이드바에 표시할 최근 건수 상한. |

**환경변수** — 이 확장이 읽는 환경변수는 **`REFINE_API_URL` 하나**(정제 서버 주소)다.

- 우선순위: **OS 환경변수 > `.env`(빌드 시 구워 넣음) > 코드 내장 기본값**.
- 로컬에선 `.env`에 적어 둔다(`.env.example` 템플릿 복사). `.env`는 `.gitignore`로 추적 제외된다.
- `build.sh`가 패키징 시 `.env`를 읽어 `src/env.generated.js`로 **구워 넣어** `.vsix`에 동봉하므로,
  배포된 확장도 `.env`의 서버 주소를 쓴다. `.env`가 없으면 코드 내장 기본값으로 폴백한다(문제 없음).

---

## 10. 패키징 / 설치 (.vsix)

배포는 **VSIX 사설 공유**. 이 폴더가 곧 패키징 루트라 한 줄이면 단일 `.vsix`가 만들어진다.

```bash
./build.sh            # .env 굽기 → 패키징 → swbc-prompt-refiner-<version>.vsix
./build.sh --install  # 위 + 현재 VS Code에 강제 설치(code --install-extension --force)
```

- **git bash + Node 필요**. `vsce`는 전역 설치 없이 `npx @vscode/vsce`로 on-demand 실행.
- **같은 버전 재설치**는 `--install`(=`--force`)이 처리. "업데이트"로 인식시키려면 `package.json`의
  `version`을 올린다(VS Code는 같은 버전을 업데이트로 보지 않는다).

---

## 11. 한계 · 향후

- **채팅 표면 스타일링 제약** — VS Code 채팅 버튼/커맨드 링크는 **커스텀 색·CSS 불가**(테마색 고정). 그래서
  액션 바는 *배치·아이콘·1차 액션 강조*로만 현대화했다. 브랜드 색상이 필요하면 자유롭게 꾸밀 수 있는
  **사이드바 webview**(`media/`)에서만 가능하다.
- **정제 품질은 BE 의존** — 정제 알고리즘/모델은 정제 서버 책임이다. 확장은 FE(호출·게이트·기록)만 담당한다.
- **향후** — 정제 서버 주소를 VS Code 설정으로 노출, 모델 메타데이터 로깅, 정제 프리셋 등.

---

> 데이터 계약: 사이드바는 `logger.js`가 남기는 JSONL 한 줄
> `{"ts","channel","model","before","after"}`만 읽는다. 스키마가 바뀌면 뷰가 깨지므로
> `logger.js`와 `logReader.js`를 함께 수정할 것. (에이전트 작업 규칙은 `AGENTS.md` 참고.)
