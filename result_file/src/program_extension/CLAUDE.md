# CLAUDE.md

이 저장소의 에이전트 작업 지침은 [`AGENTS.md`](AGENTS.md)에 있습니다.
Claude Code는 아래 import로 그 내용을 자동으로 불러옵니다.

@AGENTS.md

> 핵심만: 이 제품은 **VS Code 확장 단독**이다. 확장이 Copilot Chat에 `@refine`를 추가해 **명시 호출한
> 프롬프트만** 정제한다(미리보기 + 5버튼 확인 후 네이티브 Copilot에 전송). **절대 제약** — fail-open /
> `@refine` 현재 요청만 정제(그 외 무수정) / `refine()`는 정제 서버 호출(기본, `REFINE_API_URL`), 실패 시
> 원본·URL 미설정 시 고정문자열 폴백 / `${question}` 등 자리표시자 채움은 **BE 서버 책임**(확장 측
> `appendQuestionDefinition`은 주석/보류) / JSONL 스키마 동결 / 의존성 0(순수 JS). 테스트 파일은
> `_selftest_*`로 짓고 그것만 삭제하며, **사용자 데이터(`observe*.log`)는 절대 삭제하지 않는다.**
> **작업 종료 전 `docs/WORKLOG-<날짜>.md` 작성은 필수**(AGENTS §7). 자세한 내용은 `AGENTS.md` 참고.
