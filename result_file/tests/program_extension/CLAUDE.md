# CLAUDE.md

이 폴더의 테스트 작업 지침은 [`AGENTS.md`](AGENTS.md)에 있습니다.
Claude Code는 아래 import로 그 내용을 자동으로 불러옵니다.

@AGENTS.md

> 핵심만: 이 폴더는 VS Code 확장 `swbc-prompt-refiner`(코드: `../../src/program_extension`)의 요구사항
> **`R-EX-*`** 자동 테스트다. **절대 제약** — 테스트 제목은 `[R-EX-NN]`으로 시작(채점 매칭) / 실코드를
> 그대로 로드해 검증(사본 금지) / `require("vscode")`는 `_helpers/vscode-stub.js`로 주입(의존성 0) /
> 정제 서버는 로컬 `http`로 흉내(외부 네트워크 금지) / 결과는 `test-results/program_extension/`에만 /
> fail-open(`doesNotReject` + 자동 전송 0회)을 못 박는다. 실행은 git bash에서
> `npm run test:extension`(콘솔)·`npm run test:extension:junit`(JUnit XML). 자세한 내용·실행법은
> `AGENTS.md`·`RUN.md` 참고. 평가 기준은 루트 `project_assessment_agent_v1.0.md`.
