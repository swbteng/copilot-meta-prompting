# AGENTS.md — AI 에이전트 작업 지침 (swbc-prompt-refiner)

이 저장소(VS Code 확장 `swbc-prompt-refiner`)에서 코드를 수정하는 **모든 AI 에이전트(Claude 등)**가
따라야 할 규칙입니다. 사람용 개요는 [`README.md`](README.md)를 보세요. 이 문서는 "건드리면 안 되는 것"과
"구조"에 집중합니다.

> 이 확장은 원래 `swbc-proxy` 저장소에서 mitmproxy 프록시와 함께 개발되다가, **프록시를 전면 폐기하고
> 확장 단독(`@refine` Chat Participant)**으로 전환된 결과물입니다. 지금은 **프록시·CA·`http.proxy`·파이썬이
> 일절 필요 없습니다.** 옛 프록시 구현 이력은 원본 저장소에만 남아 있고, 이 repo에는 없습니다.

> **작업을 "완료"라고 보고하기 전에 반드시 [§7 작업 완료 정의](#7-작업-완료-정의-definition-of-done)를 수행한다 — 변경에 맞춰 문서를 갱신한다.**
> **모든 쉘 명령은 git bash. 개발 실행은 `F5`(Node 불필요), 패키징만 Node(`./build.sh`).**

---

## 0. 한 줄 요약

확장이 VS Code **Copilot Chat에 `@refine`를 추가**한다. 사용자가 `@refine <프롬프트>`로 **명시적으로 부른
것만** 정제해 **미리보기 + 5버튼**으로 확인받고, 승인 시 최종 텍스트(정제본/원본/수정본)를 그대로
네이티브 Copilot에 보낸다(`workbench.action.chat.open`). **그 외 트래픽은 일절 건드리지 않는다**(프록시 없음).

---

## 1. 절대 규칙 (불변 — 깨면 안 됨)

1. **fail-open** — 핸들러/정제/로깅은 전부 `try/catch`로 감싸고, 어떤 에러에서도 Copilot 흐름을 막지 않는다.
2. **명시 호출만** — `@refine`로 들어온 **현재 요청(`request.prompt`)만** 정제한다. `@refine` 없이 친
   평범한 프롬프트나 그 외 트래픽은 **무수정**이다(확장 API로는 가로챌 수도 없고, 그게 의도다).
3. **고정문자열 유지** — `refine()`는 **사용자 지시 전까지** `FIXED_REPLACEMENT`("안녕,클로드")를 반환한다.
   서버 호출 경로(`callRefineApi`)는 구현돼 있으나 **주석 처리**다. 임의로 전환하지 않는다.
4. **JSONL 스키마 동결** — 사이드바 뷰어가 읽는 데이터 계약이다. 바꾸려면 `src/logger.js`·`src/logReader.js`를 함께.
5. **사용자 데이터 보존** — 정제 로그(`observe*.log`)는 절대 삭제/덮어쓰지 않는다(사용자 관측 데이터).
6. **의존성 0** — 확장은 순수 JS(Node 내장 모듈만). **런타임 npm 의존성 추가 금지**.

---

## 2. 코드 지도 (`src/`)

| 파일 | 핵심 |
|---|---|
| `extension.js` | 진입점. 사이드바(WebviewView) 등록 + `registerChat(context)`. |
| `chat.js` | **`@refine` 참가자**. `refine()` -> 미리보기(`stream.markdown`) + 5버튼(`stream.button`) + 5명령. 전송은 `workbench.action.chat.open`. |
| `refiner.js` | **유일한 refiner**. `refine()`(현재 고정문자열 / 주석된 서버호출), `callRefineApi()`(http/https, 미사용). |
| `logger.js` | `@refine` allow 시 `observe-YYYY-MM-DD.log`에 **JSONL 한 줄 append**(스키마 동결, fail-open). |
| `config.js` | `resolveLogDir(context)`(쓰는 쪽·읽는 쪽 단일 소스) / `getMaxEntries()`. |
| `logReader.js` | `observe-*.log`(JSONL) 읽기/파싱(줄단위 fail-soft). |
| `media/` | `icon.svg`(참가자/사이드바 아이콘) · `main.css`(테마 변수) · `main.js`(카드 렌더/검색/diff). |

### 버튼 5개 (chat.js)

| 버튼 | 동작 | 전송 | 로그 |
|---|---|---|---|
| **allow** | 정제본 자동 전송 | `chat.open({query: 정제본})` | 기록(원본->정제본) |
| **try again** | 원본으로 재정제 -> 새 미리보기 | `chat.open({query:"@refine 원본"})` | - |
| **use original** | 원본 자동 전송 | `chat.open({query: 원본})` | - (교체 없음) |
| **modify** | 정제본을 입력창에 시드(전송 안 함) | `seedInput(정제본)` | - |
| **cancel** | 원본을 입력창에 시드(정제 취소) | `seedInput(원본)` | - |

마커/슬래시 없음. modify는 `@refine`/슬래시 없는 **평범한 텍스트**를 입력창에 내린다(엔터 시 네이티브 Copilot 직행).

---

## 3. `refine()` 현재 상태 (중요)

- **현재: 항상 고정 문자열 `FIXED_REPLACEMENT`("안녕,클로드")** — 서버 연동 전 파이프라인 검증용.
- **서버 경로는 `src/refiner.js`에 구현돼 있고 `refine()` 안에서 주석 처리만** 돼 있다.
  `REFINE_API_URL` 설정 + `[정식]` 블록 주석 해제 + `return FIXED_REPLACEMENT` 제거 -> 라이브 전환.
  서버 스키마가 다르면 `callRefineApi()`의 요청 `{"prompt":...}` / 응답 키(`refined/text/...`)만 맞춘다.
- **사용자 지시 없이 둘을 바꾸지 말 것**(고정 문자열로 먼저 테스트한다는 결정 유지).

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

# 빠른 로직 점검 (Node)
export PATH="$PATH:/c/Program Files/nodejs"
node -e "require('./src/refiner').refine('x').then(console.log)"   # -> 안녕,클로드

# 패키징/설치
./build.sh --install      # swbc-prompt-refiner-<version>.vsix 만들고 설치
```

---

## 6. 하지 말 것

- `@refine` 밖의 트래픽(평범한 Copilot 프롬프트 등)을 가로채려는 시도 — 불가능하고 의도 위반.
- `refine()`를 고정 문자열에서 멋대로 서버 호출로 전환(사용자 지시 없이).
- JSONL 로그 스키마 변경(사이드바 계약 깨짐).
- 런타임 의존성 추가(의존성 0 유지).
- `observe*.log` 등 사용자 데이터 삭제/덮어쓰기.
- 확정되지 않은 사실을 추측으로 코드에 반영 — 애매하면 사용자에게 먼저 확인한다.

---

## 7. 작업 완료 정의 (Definition of Done)

이 저장소는 **문서 갱신을 "완료"의 일부로 본다(docs-as-code).** 코드/동작이 바뀌었는데 문서가 그대로면
그 작업은 **미완성**이다. 끝났다고 보고하기 **전에**, 같은 작업 안에서 닿는 문서를 모두 갱신한다.

- [ ] **README.md** — 동작/셋업/실행법/설정/구조가 바뀌었으면 갱신.
- [ ] **AGENTS.md** — 구조/절대규칙/핵심 함수/데이터 계약이 바뀌었으면 갱신.
- [ ] **(Claude Code 한정)** 다음 세션에 필요한 비자명한 사실이 생겼으면 프로젝트 메모리도 갱신.

원칙: 문서 변경을 별도 작업으로 미루지 말고 **그 코드 변경과 한 묶음**으로.
