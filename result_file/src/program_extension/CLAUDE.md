# CLAUDE.md

이 저장소의 에이전트 작업 지침은 [`AGENTS.md`](AGENTS.md)에 있습니다.
Claude Code는 아래 import로 그 내용을 자동으로 불러옵니다.

@AGENTS.md

> 핵심만: `refine_copilot.py`는 Copilot 트래픽에서 `<userRequest>` 안쪽(사람 입력)만 교체하는
> mitmproxy 애드온이다. **절대 제약** — fail-open / 응답·비-text·과거/루프 턴 무수정 / `<userRequest>`
> 마커 allowlist / 의존성은 mitmproxy만. 테스트 파일은 `_selftest_*`로 짓고 그것만 삭제하며,
> **사용자 데이터(`observe*.log` 등)는 절대 삭제하지 않는다.** 자세한 내용은 `AGENTS.md` 참고.
