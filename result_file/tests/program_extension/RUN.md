# RUN.md — 테스트 실행법 (tests/program_extension)

VS Code 확장 `swbc-prompt-refiner`의 요구사항 `R-EX-*` 자동 테스트를 **실행/재현**하는 방법.
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
node --test --test-reporter=spec "tests/program_extension/*.test.js"
npm run test:extension
```
- 각 테스트가 `✔ [R-EX-NN] ...`로 출력되고, 마지막에 `pass N / fail 0` 요약이 뜬다.
- ⚠️ 디렉터리 인자(`tests/program_extension/`)를 주면 Node가 **모듈로 해석해 실패**한다. 반드시
  **glob을 따옴표로 감싼다**: `"tests/program_extension/*.test.js"`.

## 2. 채점용 결과 산출물 생성 (JUnit XML + 요약)

```bash
npm run test:extension:junit
```
- `test-results/program_extension/junit.xml` — JUnit 표준 리포트. 테스트명에 `R-EX-NN`이 박혀 있어
  **요구사항↔테스트↔결과** 매칭에 쓰인다.
- `test-results/program_extension/summary.txt` — 사람용 spec 리포터 요약(pass/fail 카운트 포함).
- 스크립트 원형(직접 실행 시):
  ```bash
  node --test \
    --test-reporter=junit --test-reporter-destination=test-results/program_extension/junit.xml \
    --test-reporter=spec  --test-reporter-destination=stdout \
    "tests/program_extension/*.test.js"
  ```

## 3. 특정 파일/요구사항만 실행

```bash
# 파일 1개만
node --test --test-reporter=spec tests/program_extension/refiner.test.js

# 이름(요구사항 ID)으로 필터 — 예: R-EX-11만
node --test --test-name-pattern="R-EX-11" "tests/program_extension/*.test.js"
```

---

## 4. 기대 결과 (현재 스냅샷)

- **총 25개 테스트 전부 통과(pass 25 / fail 0).**
- 요구사항 커버리지: 자동 10개(R-EX-01~07, 09, 10, 11) / 사람·시연 검증 1개(**R-EX-08** 액티비티 바 UI).
- R-EX-11은 데이터 계층(`refiner.test.js`: 200/500/text500/연결실패/빈입력)과 UI 계층(`chat.test.js`:
  에러 메시지 + Use original/재시도/Cancel Fallback UI, 자동 전송 0회)으로 나눠 검증한다.

## 5. 자주 막히는 곳

| 증상 | 원인 / 해결 |
|---|---|
| `Cannot find module .../tests/program_extension` | 디렉터리를 인자로 줌 → glob `"tests/program_extension/*.test.js"`로 |
| `ERR_INVALID_PACKAGE_CONFIG ... result_file/package.json` | `package.json`이 비었/깨짐 → 유효한 JSON이어야 함(이미 구성됨) |
| `--test-reporter=junit` 오류 | Node가 20.13 미만 → 업그레이드(내장 JUnit 리포터 필요) |
| `node: command not found` | PATH 미설정 → `export PATH="$PATH:/c/Program Files/nodejs"` |

> 참고: 이 테스트들은 `.vsix`가 실제로 설치/구동되는 환경(Extension Host)에서 확장이 VS Code에 내리는
> 명령을 **목으로 재현**해 검증한다. 실제 시연(아이콘 노출·웹뷰 렌더 등 R-EX-08류)은 사람이 확인한다.
