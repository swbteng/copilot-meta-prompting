# tests/program_extension — VSCode Extension 테스트

`src/program_extension`(VS Code 확장 `swbc-prompt-refiner`)의 요구사항 `R-EX-*`에 대한 자동 테스트.

## 실행 방법

```bash
# 결과파일 루트(result_file/)에서
node --test --test-reporter=spec "tests/program_extension/src/*.test.js"          # 콘솔 확인
npm run test:extension                                                         # 위와 동일(스크립트)
npm run test:extension:junit                                                   # JUnit XML 생성
```

- **런타임/추가 의존성 0** — Node 내장 `node:test`(러너)와 내장 `junit` 리포터만 사용. `npm install` 불필요.
- 권장 Node ≥ 20.13(내장 JUnit 리포터). 검증 환경: Node v24.
- 테스트 결과(JUnit XML + 사람용 요약)는 `test-results/program_extension/`에 생성된다.
  ```bash
  node --test --test-reporter=junit --test-reporter-destination=test-results/program_extension/junit.xml "tests/program_extension/src/*.test.js"
  ```

## 설계 메모

- VS Code API(`require("vscode")`)는 Extension Host에서만 존재하므로, `_helpers/vscode-stub.js`가
  `Module._load`를 후킹해 경량 목을 주입한다. 테스트는 "우리 코드가 VS Code에 무엇을 시키는가"
  (전송 쿼리/`isPartialQuery`/등록한 참가자·명령)를 결정론적으로 검증한다.
- 정제 서버 호출은 로컬 `http` 서버(200/500/연결실패)로 흉내 내거나, `refine`를 가짜로 주입한다.
- 각 테스트 이름에 `[R-EX-NN]`을 박아 요구사항↔테스트↔결과를 한 줄로 추적할 수 있게 했다.

## 요구사항 ↔ 테스트 매핑 (검증 가능 / 사람 검증 구분)

| 요구사항 | 검증 방식 | 테스트 파일 |
|---|---|---|
| R-EX-01 @refine 가로채기 | ✅ 자동 | `chat.test.js` |
| R-EX-02 정제본 렌더링 + 5선택지 | ✅ 자동 | `chat.test.js` |
| R-EX-03 Allow | ✅ 자동 | `chat.test.js` |
| R-EX-04 Modify | ✅ 자동 | `chat.test.js` |
| R-EX-05 Try again | ✅ 자동 | `chat.test.js` |
| R-EX-06 Use original | ✅ 자동 | `chat.test.js` |
| R-EX-07 Cancel | ✅ 자동 | `chat.test.js` |
| **R-EX-08 액티비티 바 UI** | 🧑 **사람/시연 검증** (시각적 아이콘 노출·패널 오픈은 선언적 UI라 자동화 불가) | — |
| R-EX-09 수정 내역 로컬 저장(JSONL) | ✅ 자동 | `logger.test.js`, `config.test.js` |
| R-EX-10 히스토리 조회(시간순·최근 N) | ✅ 자동 (화면 '최신순 렌더'는 webview DOM이라 시연 검증) | `logReader.test.js` |
| R-EX-11 API 통신 실패 예외 + Fallback UI | ✅ 자동 | `refiner.test.js`(200/500/text500/연결실패/빈입력), `chat.test.js`(에러메시지 + Use original/재시도/Cancel) |

> 자동 검증 10개 / 사람(시연) 검증 1개(R-EX-08). 명세서에도 R-EX-08에 *사람/시연 검증* 표시를 달았다.
> 현재 스냅샷: **25개 테스트 전부 통과**(`test-results/program_extension/`의 `junit.xml`·`summary.txt`).

### R-EX-11(통신 실패 예외) 자동 검증 상세
명세는 "타임아웃/500 시 무한 로딩 없이 **에러 메시지 + Use original/Retry(재시도)/Cancel Fallback UI**"를 요구한다. 둘로 나눠 검증한다.
- **데이터 계층**(`refiner.test.js`): `refineDetailed()`가 500(JSON/`text/plain`)·연결실패·빈응답을 `{ok:false, text:원본}`으로, 200 성공을 `{ok:true, text:정제본}`으로 구분(상태코드 검사 포함).
- **UI 계층**(`chat.test.js`): `ok:false`/예외에서 핸들러가 throw 없이 `실패` 메시지와 `refineUseOriginal`·`refineTryAgain`·`refineCancel` 커맨드 링크를 렌더하고, 타겟 LLM으로 자동 전송하지 않음을 확인. **재시도**는 동일 원본으로 `@refine` 재요청, **취소**는 `@refine <원본>`을 입력창에 시드함도 검증.
