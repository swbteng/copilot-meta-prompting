# AGENTS.md — AI 에이전트 작업 지침 (swbc-prompt-refiner)

이 저장소(VS Code 확장 `swbc-prompt-refiner`)에서 코드를 수정하는 **모든 AI 에이전트(Claude 등)**가
따라야 할 규칙입니다. 사람용 개요는 [`README.md`](README.md)를 보세요. 이 문서는 "건드리면 안 되는 것"과
"구조"에 집중합니다.

> 이 확장은 원래 `swbc-proxy` 저장소에서 mitmproxy 프록시와 함께 개발되다가, **프록시를 전면 폐기하고
> 확장 단독(`@refine` Chat Participant)**으로 전환된 결과물입니다. 지금은 **프록시·CA·`http.proxy`·파이썬이
> 일절 필요 없습니다.** 옛 프록시 구현 이력은 원본 저장소에만 남아 있고, 이 repo에는 없습니다.

> **작업을 "완료"라고 보고하기 전에 반드시 [§7 작업 완료 정의](#7-작업-완료-정의-definition-of-done)를 수행한다 — 변경에 맞춰 문서를 갱신한다.**
> **모든 쉘 명령은 git bash. 개발 실행은 `F5`(Node 불필요), 패키징만 Node(`./build.sh`).**

> **📋 평가 기준** — 이 프로젝트의 최종 산출물은 **프로젝트 루트의 [`project_assessment_agent_v1.0.md`](../../../project_assessment_agent_v1.0.md)**(프로젝트 평가 Agent 정의서)에 따라 채점된다. 모든 에이전트는 요구사항 명세 대비 기능 구현, 테스트/신뢰성, DevOps·실행 가능성, 시연 동작 검증 관점을 의식하고 작업한다 — 결론에는 **검증 가능한 증거**(파일 경로·테스트 로그·실행 결과)를 남기고, 자동 검증 불가 항목은 **사람/시연 검증으로 명시**한다.

---

## 0. 한 줄 요약

확장이 VS Code **Copilot Chat에 `@refine`를 추가**한다. 사용자가 `@refine <프롬프트>`로 **명시적으로 부른
것만** 정제해 **미리보기 + 가로 액션 바(5개)**로 확인받고, 승인 시 최종 텍스트(정제본/원본/수정본)를 그대로
것만** 정제해 **미리보기 + 가로 액션 바(5개)**로 확인받고, 승인 시 최종 텍스트(정제본/원본/수정본)를 그대로
네이티브 Copilot에 보낸다(`workbench.action.chat.open`). **그 외 트래픽은 일절 건드리지 않는다**(프록시 없음).

---

## 1. 절대 규칙 (불변 — 깨면 안 됨)

1. **fail-open** — 핸들러/정제/로깅은 전부 `try/catch`로 감싸고, 어떤 에러에서도 Copilot 흐름을 막지 않는다.
2. **명시 호출만** — `@refine`로 들어온 **현재 요청(`request.prompt`)만** 정제한다. `@refine` 없이 친
   평범한 프롬프트나 그 외 트래픽은 **무수정**이다(확장 API로는 가로챌 수도 없고, 그게 의도다).
3. **서버 정제 + fail-open** — `refine()`는 정제 서버(`REFINE_API_URL`)를 호출하고(사용자 지시로 전환됨),
   실패/빈 응답이면 **원본을 그대로 반환**한다. URL이 비면 고정 문자열 폴백. `${question}` 등 자리표시자
   채움은 **BE 서버 책임**이며 확장은 받은 정제본을 그대로 쓴다(`appendQuestionDefinition`은 주석/보류).
   자세한 계약은 §3.
3. **서버 정제 + fail-open** — `refine()`는 정제 서버(`REFINE_API_URL`)를 호출하고(사용자 지시로 전환됨),
   실패/빈 응답이면 **원본을 그대로 반환**한다. URL이 비면 고정 문자열 폴백. `${question}` 등 자리표시자
   채움은 **BE 서버 책임**이며 확장은 받은 정제본을 그대로 쓴다(`appendQuestionDefinition`은 주석/보류).
   자세한 계약은 §3.
4. **JSONL 스키마 동결** — 사이드바 뷰어가 읽는 데이터 계약이다. 바꾸려면 `src/logger.js`·`src/logReader.js`를 함께.
5. **사용자 데이터 보존** — 정제 로그(`observe*.log`)는 절대 삭제/덮어쓰지 않는다(사용자 관측 데이터).
6. **의존성 0** — 확장은 순수 JS(Node 내장 모듈만). **런타임 npm 의존성 추가 금지**.

---

## 2. 코드 지도 (`src/`)

| 파일 | 핵심 |
|---|---|
| `extension.js` | 진입점. 사이드바(WebviewView) 등록 + `registerChat(context)`. |
| `chat.js` | **`@refine` 참가자**. `refinePrompt()`(=`refineDetailed` 우선)로 정제 -> 성공이면 미리보기(`stream.markdown`) + **가로 액션 바**(codicon 커맨드 링크 5개, 신뢰 `MarkdownString`; 막히면 `stream.button` 폴백) + 5명령. **실패(`ok:false`)/예외면 R-EX-11 Fallback UI**(에러 메시지 + Use original/재시도/Cancel). 전송은 `workbench.action.chat.open`. |
| `refiner.js` | **유일한 refiner**. `refineDetailed()`(성공/실패 `{text, ok, reason}` 구분 — R-EX-11 Fallback 판단 근거) / `refine()`(그 얇은 래퍼, 문자열만), `callRefineApi()`(http/https, **4xx·5xx는 실패로 처리**). 서버 URL 우선순위 = `process.env` > `env.generated.js`(빌드 굽기) > 코드 내장 기본값. `appendQuestionDefinition()`(`${var}` 정의 덧붙임)은 BE 서버가 처리하기로 해 **주석/보류**. |
| `env.generated.js` | **빌드 산출물**(커밋 금지, `.gitignore`). `build.sh`가 `.env`의 `REFINE_API_URL`을 구워 넣어 `.vsix`에 동봉(없으면 미생성, 코드 내장 기본값으로). `.vscodeignore`에서 **제외 금지**. |
| `logger.js` | `@refine` allow 시 `observe-YYYY-MM-DD.log`에 **JSONL 한 줄 append**(스키마 동결, fail-open). |
| `config.js` | `resolveLogDir(context)`(쓰는 쪽·읽는 쪽 단일 소스) / `getMaxEntries()`. |
| `logReader.js` | `observe-*.log`(JSONL) 읽기/파싱(줄단위 fail-soft). |
| `media/` | `icon.svg`(참가자/사이드바 아이콘) · `main.css`(테마 변수) · `main.js`(카드 렌더/검색/diff). |

### 액션 5개 (chat.js) — 가로 액션 바(codicon 커맨드 링크), 막히면 세로 버튼 폴백
### 액션 5개 (chat.js) — 가로 액션 바(codicon 커맨드 링크), 막히면 세로 버튼 폴백

| 버튼 | 동작 | 전송 | 로그 |
|---|---|---|---|
| **allow** | 정제본 자동 전송 | `chat.open({query: 정제본})` | 기록(원본->정제본) |
| **try again** | 원본으로 재정제 -> 새 미리보기 | `chat.open({query:"@refine 원본"})` | - |
| **use original** | 원본 자동 전송 | `chat.open({query: 원본})` | - (교체 없음) |
| **modify** | 정제본을 입력창에 시드(전송 안 함) | `seedInput(정제본)` | - |
| **cancel** | `@refine 원본`을 입력창에 시드(정제 취소, @refine 컨텍스트 유지) | `seedInput("@refine "+원본)` | - |

마커/슬래시 없음. modify는 `@refine`/슬래시 없는 **평범한 텍스트**를 입력창에 내린다(엔터 시 네이티브 Copilot 직행).

---

## 3. `refine()` 현재 상태 (중요)

- **현재: 정제 서버 호출이 기본**(사용자 지시로 전환됨). 서버 URL은 **우선순위**로 정해진다 —
  `process.env.REFINE_API_URL` > `src/env.generated.js`(빌드 시 `.env`를 구워 넣은 파일) > 코드 내장
  기본값. 그 URL로 `callRefineApi()`가 `{"prompt":...}`를 POST하고 응답 키 `refined/text/result/...`
  중 첫 문자열을 받는다. **`.env` → `.vsix` 굽기는 `build.sh`가 담당**(패키징 전 `env.generated.js` 생성).
- **폴백**: `REFINE_API_URL`이 비면 고정 문자열 `FIXED_REPLACEMENT`("안녕,클로드"). 서버 실패/빈 응답이면
  **원본을 그대로 반환**(fail-open — Copilot 흐름을 막지 않는다).
- **`${question}` 자리표시자 채움 = BE 서버 책임**: 정제본 템플릿의 `${question}`/`${query}` 등은 **정제
  서버가 채워서** 돌려준다. 확장은 받은 정제본을 그대로 쓴다. 확장 측에서 정의를 덧붙이던
  `appendQuestionDefinition()`은 `src/refiner.js`에 **주석 처리/보류**로 남아 있다 — 서버가 못 채우게 되면
  그 함수 + `refine()`의 호출 + `module.exports`를 함께 되살린다(특정 변수명 하드코딩 금지).
- 응답 스키마가 바뀌면 `callRefineApi()`의 요청/응답 키만 맞춘다(나머지는 fail-open이 흡수).
- **성공/실패 구분(R-EX-11)**: `refineDetailed()`가 `{text, ok, reason}`을 돌려준다 — 빈입력/URL미설정은
  `ok:true`(정상 흐름), 타임아웃·4xx·5xx·연결실패·빈응답·예외는 `ok:false`(원본 유지). chat.js는
  `ok:false`일 때만 **에러 메시지 + Use original/재시도/Cancel Fallback UI**를 띄운다(무한 로딩 금지). `refine()`는
  `refineDetailed().text`만 돌려주는 하위호환 래퍼(계약 불변).

---

## 4. 로그 데이터 계약 (JSONL)

`@refine`에서 정제본을 보내면(allow) `logger.appendRewrite()`가 `observe-YYYY-MM-DD.log`에 JSON 한 줄을
append 한다(폴더 자동 생성). **사이드바가 파싱하는 계약이므로 함부로 바꾸지 말 것.**
```json
{"ts":"2026-06-25T15:04:05","channel":"@refine","model":"","before":"<원본>","after":"<정제본>"}
```
- `channel`은 `@refine`, `model`은 확장이 알 수 없어 `""`. **언제 기록?** allow 1건만(use original=교체 없음,
  modify=최종 편집본을 확장이 못 봄, try again=전송 아님 -> 모두 미기록).
- 로그 폴더 기본값은 확장 전역 저장소(`globalStorage/logs`). 설정 `swbcPromptRefiner.logDir`(절대경로)로 바꿀 수 있다.

---

## 5. 작업 규칙

- **테스트 파일은 `_selftest_*.js`로 짓고, 삭제는 그 파일만.** 검증 후 정리한다(패키징 전에 지운다 — `.vsix`에 섞이지 않게).
- **사용자 데이터 파일은 절대 삭제 금지** — `observe*.log` 포함.
- **모든 쉘 명령은 git bash로 통일**(PowerShell/cmd 아님).
- **개발 실행은 `F5`** — VS Code로 이 폴더를 열고 F5 -> Extension Development Host. **Node 불필요**(VS Code 자체 런타임). 코드 변경은 `Ctrl+R`로 즉시 반영.
- **패키징만 Node 필요**: `./build.sh [--install]`. 새 git bash 세션은 `export PATH="$PATH:/c/Program Files/nodejs"`. `vsce`는 `npx @vscode/vsce`로 on-demand.
- 순수 모듈(`refiner.js`/`logger.js`/`logReader.js`)은 vscode 없이 import 가능 -> 셀프테스트는 `node`로 직접 호출.

### 실행 / 테스트 (git bash)
```bash
# 개발: VS Code로 이 폴더 열고 F5 (Node 불필요). 코드 바꾸면 Ctrl+R.

# 빠른 로직 점검 (Node) — 서버 정제본 반환(끝에 ${var} 정의가 붙을 수 있음). 서버 불가 시 원본.
# 빠른 로직 점검 (Node) — 서버 정제본 반환(끝에 ${var} 정의가 붙을 수 있음). 서버 불가 시 원본.
export PATH="$PATH:/c/Program Files/nodejs"
node -e "require('./src/refiner').refine('1+1이 뭐야?').then(console.log)"
node -e "require('./src/refiner').refine('1+1이 뭐야?').then(console.log)"

# 패키징/설치
./build.sh --install      # swbc-prompt-refiner-<version>.vsix 만들고 설치
```

---

## 6. 하지 말 것

- `@refine` 밖의 트래픽(평범한 Copilot 프롬프트 등)을 가로채려는 시도 — 불가능하고 의도 위반.
- fail-open 위반(서버 실패/예외에서 원본 대신 throw하거나 Copilot 흐름을 막는 것).
- `${question}` 등 자리표시자를 확장에서 채우려는 시도(채움은 BE 서버 책임 — 확장은 정제본을 그대로 쓴다).
- fail-open 위반(서버 실패/예외에서 원본 대신 throw하거나 Copilot 흐름을 막는 것).
- `${question}` 등 자리표시자를 확장에서 채우려는 시도(채움은 BE 서버 책임 — 확장은 정제본을 그대로 쓴다).
- JSONL 로그 스키마 변경(사이드바 계약 깨짐).
- 런타임 의존성 추가(의존성 0 유지).
- `observe*.log` 등 사용자 데이터 삭제/덮어쓰기.
- 확정되지 않은 사실을 추측으로 코드에 반영 — 애매하면 사용자에게 먼저 확인한다.

---

## 7. 작업 완료 정의 (Definition of Done)

이 저장소는 **문서 갱신을 "완료"의 일부로 본다(docs-as-code).** 코드/동작이 바뀌었는데 문서가 그대로면
그 작업은 **미완성**이다. 끝났다고 보고하기 **전에**, 같은 작업 안에서 닿는 문서를 모두 갱신한다.

- [ ] **`docs/WORKLOG-<YYYY-MM-DD>.md` (필수)** — 작업 종료 전 **반드시** 그날의 워크로그를 작성/갱신한다.
      무엇을·왜 바꿨는지, 영향받은 파일, 검증 방법/결과, 후속 메모를 남긴다. 같은 날 추가 작업이면
      그날 파일에 이어 적는다(날짜=작업한 날, 절대표기). **이 항목은 생략 불가 — 빠지면 미완성이다.**
- [ ] **`docs/WORKLOG-<YYYY-MM-DD>.md` (필수)** — 작업 종료 전 **반드시** 그날의 워크로그를 작성/갱신한다.
      무엇을·왜 바꿨는지, 영향받은 파일, 검증 방법/결과, 후속 메모를 남긴다. 같은 날 추가 작업이면
      그날 파일에 이어 적는다(날짜=작업한 날, 절대표기). **이 항목은 생략 불가 — 빠지면 미완성이다.**
- [ ] **README.md** — 동작/셋업/실행법/설정/구조가 바뀌었으면 갱신.
- [ ] **AGENTS.md** — 구조/절대규칙/핵심 함수/데이터 계약이 바뀌었으면 갱신.
- [ ] **(Claude Code 한정)** 다음 세션에 필요한 비자명한 사실이 생겼으면 프로젝트 메모리도 갱신.

원칙: 문서 변경을 별도 작업으로 미루지 말고 **그 코드 변경과 한 묶음**으로.
