# RUN.md — 테스트 실행법 (tests/program_extension)

VS Code 확장 `swbc-prompt-refiner`의 요구사항(명세서 `R-15`~`R-24`) 자동 테스트를 **실행/재현**하는 방법.
지침은 [`AGENTS.md`](AGENTS.md), 매핑·설계는 [`README.md`](README.md)를 본다.

---

## 0. 전제

- **Node ≥ 20.13** 권장(내장 `node:test` + 내장 `junit` 리포터). 검증 환경: **Node v24**.
- **추가 의존성 0** — `npm install` 불필요. Node 내장 모듈만 쓴다.
- 모든 명령은 **결과파일 루트(`result_file/`)** 에서 실행한다(스크립트 경로가 그 기준).
- 셸: git bash 권장. 새 셸이면 Node를 PATH에 한 번 추가한다.
  ```bash
  export PATH="$PATH:/c/Program Files/nodejs"
  cd result_file
  ```

---

## 1. 콘솔로 빠르게 확인

```bash
# 둘 중 아무거나 (동일)
node --test --test-reporter=spec tests/program_extension/src/*.test.js
npm run test:extension
```
- 각 테스트가 `✔ [R-NN] ...`로 출력되고, 마지막에 `pass N / fail 0` 요약이 뜬다.
- ⚠️ 디렉터리 인자(`tests/program_extension/`)를 주면 Node가 **모듈로 해석해 실패**한다. 반드시
  **glob**(`tests/program_extension/src/*.test.js`)을 넘긴다. 이 Node 버전은 CLI에 넘긴 glob 문자열을
  스스로 확장해주지 않으므로 **따옴표로 감싸지 않는다**(감싸면 리터럴 취급돼 "Could not find" 에러) —
  셸이 먼저 파일 목록으로 확장해서 넘기게 한다.

## 2. 채점용 결과 산출물 생성 (JUnit XML + 요약)

```bash
npm run test:extension:junit
```
- `test-results/program_extension/junit.xml` — JUnit 표준 리포트. 테스트명에 `R-NN`이 박혀 있어
  **요구사항↔테스트↔결과** 매칭에 쓰인다.
- `test-results/program_extension/summary.txt` — 사람용 spec 리포터 요약(pass/fail 카운트 포함).
- 스크립트 원형(직접 실행 시):
  ```bash
  node --test \
    --test-reporter=junit --test-reporter-destination=test-results/program_extension/junit.xml \
    --test-reporter=spec  --test-reporter-destination=stdout \
    tests/program_extension/src/*.test.js
  ```

## 3. 테스트 커버리지 (Node 내장, 의존성 0)

`node --test`의 **내장 V8 커버리지**(`--experimental-test-coverage`)를 쓴다. nyc/c8/jest 같은 추가
도구가 필요 없어 **의존성 0 원칙을 깨지 않는다**. 원래 테스트 코드 자신은 `--test-coverage-exclude`로
집계에서 뺐었는데, 이 옵션이 없는 Node 버전(예: 20.20.2)에서는 "bad option" 에러가 나서 스크립트에서
뺐다 — 지금은 `tests/**` 파일도 함께 집계된다(대부분 100%라 실질 영향은 적음).

```bash
# (1) 콘솔 표로 보기 — src/program_extension/src/*.js 만 집계
npm run test:extension:coverage

# (2) lcov 산출물까지 생성 (HTML 뷰어/CI 연동용)
npm run test:extension:coverage:lcov
#   → test-results/program_extension/coverage.lcov
```
- 표에는 파일별 **line % / branch % / funcs % / 미커버 라인**이 나온다.
- lcov는 VS Code 확장 *Coverage Gutters*(에디터에 줄 표시)나 CI 리포트에 그대로 넣을 수 있다.
- 스크립트 원형(직접 실행 시):
  ```bash
  node --test --experimental-test-coverage \
    --test-reporter=spec \
    tests/program_extension/src/*.test.js
  ```
- 현재 스냅샷(소스 집계): 전체 **line 84.1% / branch 71.4% / funcs 87.5%**. `config.js`는 100%,
  미커버가 큰 곳은 `chat.js`(webview 액션 핸들러 분기)·`refiner.js`(일부 서버 호출 분기)다.

## 4. 특정 파일/요구사항만 실행

```bash
# 파일 1개만
node --test --test-reporter=spec tests/program_extension/src/refiner.test.js

# 이름(요구사항 ID)으로 필터 — 예: R-24만
node --test --test-name-pattern="R-24" "tests/program_extension/src/*.test.js"
```

---

## 5. 기대 결과 (현재 스냅샷)

- **총 25개 테스트 전부 통과(pass 25 / fail 0).**
- 요구사항 커버리지: 자동 10개(R-15~R-24, program_extension 구간 전부).
- R-24은 데이터 계층(`refiner.test.js`: 200/500/text500/연결실패/빈입력)과 UI 계층(`chat.test.js`:
  에러 메시지 + Use original/재시도/Cancel Fallback UI, 자동 전송 0회)으로 나눠 검증한다.

## 6. 자주 막히는 곳

| 증상 | 원인 / 해결 |
|---|---|
| `Cannot find module .../tests/program_extension` | 디렉터리를 인자로 줌 → glob `tests/program_extension/src/*.test.js`로(따옴표 없이) |
| `ERR_INVALID_PACKAGE_CONFIG ... result_file/package.json` | `package.json`이 비었/깨짐 → 유효한 JSON이어야 함(이미 구성됨) |
| `--test-reporter=junit` 오류 | Node가 20.13 미만 → 업그레이드(내장 JUnit 리포터 필요) |
| `node: command not found` | PATH 미설정 → `export PATH="$PATH:/c/Program Files/nodejs"` |

> 참고: 이 테스트들은 `.vsix`가 실제로 설치/구동되는 환경(Extension Host)에서 확장이 VS Code에 내리는
> 명령을 **목으로 재현**해 검증한다.
