# AGENTS.md — 테스트 작업 지침 (tests/program_extension)

이 폴더(`tests/program_extension`)는 VS Code 확장 **`swbc-prompt-refiner`**(코드: `src/program_extension`)의
요구사항 **`R-EX-*`**에 대한 자동 테스트다. 여기서 테스트를 추가/수정하는 **모든 AI 에이전트**가 따라야 할
규칙을 적는다. 사람용 개요·실행법은 [`README.md`](README.md)·[`RUN.md`](RUN.md)를 본다.

> **평가 기준**: 이 산출물은 프로젝트 루트의 `project_assessment_agent_v1.0.md`(프로젝트 평가 Agent
> 정의서)로 채점된다. 채점은 **요구사항↔테스트↔결과**를 증거로 매칭한다 — 그래서 이 폴더의 규칙은
> "매칭이 깨지지 않게" 하는 데 집중한다.

---

## 0. 한 줄 요약

확장 코드는 `require("vscode")`에 의존하는데, `vscode` 모듈은 **실제 `.vsix`가 설치/구동되는 Extension
Host에서만** 존재한다. 그래서 테스트는 `_helpers/vscode-stub.js`가 `Module._load`를 후킹해 **경량 목**을
주입하고(추가 의존성 0), "우리 코드가 VS Code에 무엇을 시키는가"(전송 쿼리·`isPartialQuery`·등록한
참가자/명령·렌더된 액션)를 결정론적으로 검증한다.

---

## 1. 절대 규칙 (불변 — 깨면 안 됨)

1. **요구사항 ID를 테스트 이름에 박는다** — 모든 `test("...")` 제목은 `[R-EX-NN]`으로 시작한다.
   채점 Agent가 JUnit XML의 테스트명에서 요구사항을 역추적한다. **빠지면 매칭 실패 = 감점.**
2. **검증 대상은 실제 `src/program_extension/src/*.js`** — 테스트용 사본을 만들지 않는다. 항상 상대경로
   `../../src/program_extension/src/<file>.js`로 **실코드**를 로드해 검증한다.
3. **결정론** — 시간/네트워크/전역상태에 의존하지 않는다. 정제 서버는 로컬 `http` 서버(200/500/연결실패)로
   흉내 내거나 `refine`/`refineDetailed`를 가짜로 주입한다. 외부 URL을 때리지 않는다.
4. **결과 산출물 위치 고정** — JUnit XML·요약은 **`test-results/program_extension/`**(`junit.xml`,
   `summary.txt`)에만 쓴다. 디렉터리 미러링(테스트↔결과)이 채점 신호다.
5. **fail-open 계약을 테스트로 지킨다** — 확장은 어떤 에러에서도 throw하지 않고 Copilot 흐름을 막지 않는다.
   `assert.doesNotReject` + "자동 전송 0회"로 이 불변식을 못 박는다.
6. **추가 의존성 0 유지** — Node 내장 `node:test`·`node:assert`·`http`·내장 `junit` 리포터만 쓴다.
   `npm install` 없이 도는 상태를 유지한다(꼭 필요할 때만, 사람 승인 후 devDependency 추가).

---

## 2. 파일 지도

| 파일 | 검증 대상 / 역할 | 대응 요구사항 |
|---|---|---|
| `_helpers/vscode-stub.js` | `require("vscode")` 후킹 + 캡처형 `ChatResponseStream` 목. 모든 chat/config 테스트의 토대. | (공통 인프라) |
| `chat.test.js` | `src/chat.js` — 참가자 등록, 미리보기 5선택지, allow/modify/try again/use original/cancel, **R-EX-11 Fallback UI** | R-EX-01~07, R-EX-11 |
| `refiner.test.js` | `src/refiner.js` — `refine`/`refineDetailed`/`callRefineApi`. 로컬 http로 200/500/text500/연결실패/빈입력 | R-EX-11(+02 파이프라인 근거) |
| `logger.test.js` | `src/logger.js` — `appendRewrite` JSONL 1줄 append/누적/폴더생성/방어 | R-EX-09 |
| `logreader.test.js` | `src/logReader.js` — `readEntries` 시간순 정렬·최근 N·fail-soft | R-EX-10 |
| `config.test.js` | `src/config.js` — `resolveLogDir`/`getMaxEntries` | R-EX-09/10 보강 |

---

## 3. 테스트 기법 (왜 이렇게 짰는가)

- **vscode 주입**: `_helpers/vscode-stub.js`를 **맨 먼저 require**하면 `Module._load`가 후킹돼, 이후
  로드되는 `chat.js`/`config.js`의 `require("vscode")`가 목을 받는다. 목은 호출 사실만 `state`에 캡처한다.
- **refiner 주입**(chat 테스트): `require.cache[refiner경로]`에 가짜 exports(`refine`, 선택적
  `refineDetailed`)를 심어 chat.js가 그걸 쓰게 한다 → 네트워크 없이 서버 성공/실패(`{ok}`)를 흉내.
- **실서버 흉내**(refiner 테스트): `http.createServer`로 포트 0에 띄워 200/500/`text/plain` 500/연결거부를
  만든다. `refiner.js`는 `REFINE_API_URL`을 모듈 로드시 `const`로 읽으므로, 시나리오마다
  `process.env.REFINE_API_URL` 설정 후 `require.cache`를 비우고 다시 require한다.
- **MarkdownString 캡처**: 가로 액션 바는 신뢰 `MarkdownString`이라, 스텁의 `makeStream().text()`가
  `.value`를 모아 준다 → 렌더된 커맨드 id(`swbcPromptRefiner.*`) 존재로 액션 노출을 검증한다.

---

## 4. 새 요구사항/테스트를 추가할 때

1. 제목을 `[R-EX-NN] <행위> -> <기대>`로 짓는다(ID 필수).
2. 가능하면 **실코드를 그대로** 로드해 검증한다(사본 금지). vscode 의존이면 스텁을 먼저 require.
3. 자동화 불가(시각적 UI 노출 등)면 테스트를 억지로 만들지 말고, `README.md` 매핑 표에 **🧑 사람/시연
   검증**으로 적고 명세서에도 같은 표시를 단다(현재 R-EX-08이 그 예).
4. 추가 후 **반드시 재실행 + 결과 재생성**(아래 §5). `test-results/`의 카운트/문서를 갱신한다.
5. `docs/WORKLOG-<날짜>.md`(코드 저장소)·README의 통과 카운트 등 **닿는 문서를 같은 작업에서 갱신**한다.

---

## 5. 실행 / 결과 재생성 (git bash)

```bash
export PATH="$PATH:/c/Program Files/nodejs"   # 새 셸이면 1회
cd result_file

# 콘솔 확인
node --test --test-reporter=spec "tests/program_extension/*.test.js"
npm run test:extension

# 결과 산출물(JUnit XML + 사람용 요약) 재생성
npm run test:extension:junit
```
- 디렉터리 인자(`tests/program_extension/`)를 주면 Node가 모듈로 해석해 실패한다 → **반드시 glob**
  (`tests/program_extension/*.test.js`)을 따옴표로 감싼다.
- 권장 Node ≥ 20.13(내장 JUnit 리포터). 검증 환경: Node v24.

---

## 6. 하지 말 것

- 테스트 제목에서 `[R-EX-NN]` 누락(채점 매칭 깨짐).
- 실코드 대신 테스트용 사본을 만들어 검증(거짓 통과 위험).
- 외부 정제 서버/네트워크에 실제로 의존(비결정·CI 불가).
- 결과를 `test-results/program_extension/` 밖에 쓰기(미러링 깨짐).
- 런타임/불필요한 devDependency 추가(의존성 0 원칙).
- fail-open을 깨는 단언(예외에서 throw를 기대하는 테스트).
