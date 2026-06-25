# AGENTS.md — AI 에이전트 작업 지침

이 저장소(`swbc-proxy`)에서 코드를 수정하는 **모든 AI 에이전트(Claude 등)**가 따라야 할 규칙입니다.
사람용 개요는 [`README.md`](README.md)를 보세요. 이 문서는 "건드리면 안 되는 것"과 "구조"에 집중합니다.

> **작업을 "완료"라고 보고하기 전에 반드시 [§7 작업 완료 정의](#7-작업-완료-정의-definition-of-done--문서를-코드와-함께-갱신)를 수행한다 — 변경에 맞춰 문서를 갱신한다.**
> **모든 쉘 명령은 git bash, 실행은 항상 `.venv`로 한다([§5](#5-작업-규칙)). 런처는 `run.sh`.**

---

## 0. 한 줄 요약

`refine_copilot.py`는 VS Code Copilot Chat 트래픽을 mitmproxy로 가로채, **사람이 친 프롬프트
(`<userRequest>` 안쪽)만** 정제 문자열로 교체하는 애드온이다. 나머지는 전부 그대로 통과시킨다.

---

## 1. 절대 규칙 (불변 — 깨면 안 됨)

이 5가지는 여러 세션에 걸쳐 확정된 안전 제약이다. **어떤 리팩터링도 이걸 위반하면 안 된다.**

1. **fail-open** — 모든 훅은 `try/except`로 감싸고, 어떤 에러에서도 원본을 그대로 통과시킨다.
   정제/파싱/직렬화 중 무엇이 실패해도 Copilot은 정상 동작해야 한다.
2. **응답 무수정** — 서버→클라(응답/SSE/WebSocket 서버 프레임)는 한 바이트도 수정하지 않는다.
3. **비-text 무수정** — `type=="text"`가 아닌 파트(`image_url` 등)는 절대 손대지 않는다.
4. **현재 턴만** — `messages[]`의 **마지막 항목이 `role=="user"`일 때만** 교체. 마지막이
   assistant/tool(루프·툴 턴)이면 무수정. 과거 턴의 `<userRequest>`도 건드리지 않는다.
5. **allowlist** — `<userRequest>` 마커가 있는 텍스트만 대상. 마커가 없으면(백그라운드/NES/제목생성)
   무조건 통과. 모르는 형식·스키마도 통과. **bypass 마커**(`BYPASS_MARKER`)가 안쪽에 있으면 "이미 처리됨"으로
   보고 정제를 건너뛰고 마커만 제거해 통과(allowlist의 연장 — `@refine` 확장과 이중 정제 방지, 아래 §2 참고).

> 의존성은 **mitmproxy만**. 정제 서버 호출도 표준 라이브러리 `urllib`로 한다(httpx 등 추가 금지 —
> 전역 파이썬에 httpx 미설치).

---

## 2. 코드 지도 (`refine_copilot.py`)

파일은 상단 주석의 목차대로 4섹션이다.

| 섹션 | 핵심 요소 |
|---|---|
| **1) CONFIG** | 모든 튜닝 지점(환경변수). `FIXED_REPLACEMENT`, `REFINE_API_URL`, `LOG_ENABLED`, `TARGET_PATHS` 등 |
| **2) 로깅 유틸** | `log()`(콘솔), `record_rewrite()`(콘솔 1줄 + `logs/observe-날짜.log`에 JSONL, 폴더 자동 생성), `_today_log_path()` |
| **3) 핵심 로직(순수)** | mitmproxy 비의존 → 테스트가 직접 import. 아래 표 참고 |
| **4) mitmproxy 글루** | `is_target`/`parse_body`/`load`/`request`/`websocket_message`. **여기서만 flow 접근** |

### 핵심 순수 함수 (섹션 3)

- `extract_user_request(text)` / `replace_user_request_block(text, new_inner)` — `<userRequest>` 추출·교체.
  교체는 `re.subn(lambda…)`라서 정제 결과에 `\1`·백슬래시가 있어도 리터럴로 안전하게 들어간다.
- `refine_text(original)` — **교체값을 결정하는 단일 지점**. 현재 상태는 §3 참고. 맨 앞에서 `strip_bypass_marker()`로
  bypass 마커를 먼저 검사한다(마커 있으면 정제 없이 마커만 떼어 통과).
- `strip_bypass_marker(text)` / `BYPASS_MARKER` — `@refine` 확장(P6)이 '이미 확정/정제한' 텍스트에 붙이는
  zero-width 마커(`U+200B U+2063 U+2060 U+2063 U+200B`)를 떼는 단일 지점. **확장 `extension/src/refiner.js`의
  `BYPASS_MARKER`와 코드포인트가 정확히 같아야 한다**(다르면 bypass가 무력화돼 이중 정제). fail-open.
- `call_refine_api(original)` — 정제 서버 호출(urllib, 캐시 `_refine_cache`, fail-open). 현재 호출부는 주석.
- **messages[] 경로**: `find_last_user_request()` → `apply_user_request_rewrite()` (마지막 user 턴, text 파트만).
- **input[]/제네릭 경로**: `_conversation_nodes()`(검색을 `input`/`messages`로 한정) →
  `_collect_userrequest_strings()` → `rewrite_json_user_request()` (마지막 `<userRequest>` = 현재 턴).
- **WebSocket**: `websocket_message()` → `_rewrite_ws_frame()` (클라→서버 프레임만, JSON parse→수정→재직렬화).

### 라우팅 (섹션 4, `request()`)

- 경로에 `/responses` 포함 → 제네릭(`rewrite_json_user_request`). (GPT는 보통 WebSocket으로 오므로 이쪽은 HTTP fallback.)
- 그 외(`/v1/messages`, `/chat/completions`) → `apply_user_request_rewrite(data["messages"])`.

---

## 3. `refine_text()` 현재 상태 (중요)

- **현재: 항상 고정 문자열 `FIXED_REPLACEMENT`("안녕,클로드")를 반환** — 서버 연동 전 전체
  파이프라인(가로채기→교체→재전송→로깅)을 검증하는 용도.
- **정식 경로(서버 호출)는 이미 다 구현돼 있고 `refine_text()` 안에서 주석 처리만 돼 있다.**
  `REFINE_API_URL` 설정 + 그 `[정식]` 블록 주석 해제 + 마지막 `return FIXED_REPLACEMENT` 제거 → 라이브 전환.
  서버 스키마가 다르면 `call_refine_api()`의 `(1) 요청` / `(2) 응답` 두 군데만 맞춘다.
- **임의로 둘을 바꾸지 말 것.** 사용자가 "고정 문자열로 먼저 테스트"를 명시적으로 요청한 상태다.

---

## 4. 로그 데이터 계약 (JSONL)

`record_rewrite()`는 교체 1건마다 전용 폴더 `logs/`의 `observe-YYYY-MM-DD.log`에 JSON 한 줄을 append 한다
(폴더는 `LOG_DIR` 기본값=`<스크립트폴더>/logs`, 없으면 자동 생성).
**이 포맷은 추후 VS Code 확장 사이드바가 파싱할 계약이므로 함부로 바꾸지 말 것.**
```json
{"ts": "...", "channel": "...", "model": "...", "before": "...", "after": "..."}
```

---

## 5. 작업 규칙

- **테스트 파일은 `_selftest_*.py`로 짓고, 삭제는 그 파일만.** 검증 후 정리한다.
- **사용자 데이터 파일은 절대 삭제 금지** — `logs/observe*.log`(전용 폴더) 포함. 이건 사용자의 관측 데이터다.
- **Windows 콘솔(cp949) 주의**: `—` `→` `⇒` `…` 같은 글자는 `UnicodeEncodeError`를 낸다.
  코드/로그 문자열엔 `-` `->` `...` 같은 ASCII만 쓴다. (데이터 안의 한글은 UTF-8 파일이라 무방.)
  셀프테스트는 `sys.stdout.reconfigure(encoding="utf-8", errors="replace")`로 시작.
- **모든 쉘 명령은 git bash로 통일한다**(PowerShell/cmd 아님). 런처는 `run.sh`.
- **항상 `.venv`의 인터프리터로 실행한다** — 전역 파이썬 금지. venv: `.venv/Scripts/python.exe`,
  mitmdump: `.venv/Scripts/mitmdump.exe`. 의존성은 `requirements.txt`(mitmproxy==12.2.3)로 고정.
  (venv 기반 파이썬: 3.13.13)
- 순수 함수(섹션 3)는 mitmproxy 없이 import 가능 → 테스트는 `import refine_copilot` 후 직접 호출.
- **`refine_copilot.py`의 정본은 저장소 루트 하나뿐.** VS Code 확장 P5에서 `extension/engine/`에
  `refine_copilot.py`와 standalone `mitmdump.exe`를 **동봉**하는데, 그 `engine/` 폴더는 **`extension/build.sh`가
  만드는 빌드 산출물(gitignore 대상)**이다. 애드온을 고칠 땐 **루트 `refine_copilot.py`만 수정**하고
  `engine/` 사본은 직접 건드리지 않는다(다음 `./build.sh`가 루트본을 다시 복사한다).

### 실행 / 테스트 (항상 git bash + .venv 사용)
```bash
# 최초 1회: 가상환경 + 의존성
python -m venv .venv
./.venv/Scripts/python.exe -m pip install -r requirements.txt

# 실행 (venv mitmdump를 쓰는 런처)
./run.sh

# 빠른 import.로직 점검
./.venv/Scripts/python.exe -c "import refine_copilot as R; print(R.refine_text('테스트'))"   # -> 안녕,클로드

# 셀프테스트도 venv 파이썬으로 (_selftest_*.py 만들고 -> 실행 -> 그 파일만 삭제)
./.venv/Scripts/python.exe _selftest_xxx.py
```

---

## 6. 하지 말 것

- 응답/비-text/과거 턴/루프 턴을 건드리는 변경.
- `refine_text()`를 고정 문자열에서 멋대로 서버 호출로 전환(사용자 지시 없이).
- JSONL 로그 스키마 변경(확장 계약 깨짐).
- mitmproxy 외 런타임 의존성 추가.
- `observe*.log` 등 사용자 데이터 삭제/덮어쓰기.
- 확정되지 않은 사실을 추측으로 코드에 반영 — 애매하면 사용자에게 먼저 확인한다.

---

## 7. 작업 완료 정의 (Definition of Done) — 문서를 코드와 함께 갱신

많은 팀이 그러듯, 이 저장소는 **문서 갱신을 "완료"의 일부로 본다(docs-as-code).**
코드/동작이 바뀌었는데 문서가 그대로면 그 작업은 **미완성**이다. 작업을 끝났다고 보고하기 **전에**,
같은 작업 안에서 아래를 점검하고 닿는 문서를 모두 갱신한다.

- [ ] **README.md** — 동작/셋업/실행법/환경변수/설정/구조가 바뀌었으면 갱신.
- [ ] **AGENTS.md** — 구조/절대규칙/핵심 함수/라우팅/JSONL 데이터 계약이 바뀌었으면 갱신.
- [ ] **docs/WORKLOG-YYYY-MM-DD.md** — 오늘 의미 있는 변경을 했으면 **오늘 날짜 파일**에 항목 추가
      (그 파일이 없으면 새로 만든다). "한 일 / 결정 / 남은 일"을 누적 기록한다.
- [ ] **docs/VSCODE_EXTENSION_PLAN.md** — 확장 계획·데이터 계약에 영향을 주면 갱신.
- [ ] **(Claude Code 한정)** 다음 세션에 필요한 비자명한 사실이 생겼으면 프로젝트 메모리도 갱신.

원칙:
- 문서 변경을 별도 작업으로 미루지 말고, **그 코드 변경과 한 묶음**으로 처리한다.
- WORKLOG는 **날짜별 누적** — 덮어쓰지 말고 그날 파일에 항목을 더한다. (오늘 = `WORKLOG-2026-06-23.md`)
- 무엇을/왜 바꿨는지 한 줄이라도 남긴다. "나중에 보면 알겠지"는 금지.
