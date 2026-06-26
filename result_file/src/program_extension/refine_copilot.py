"""
refine_copilot.py - GitHub Copilot 프롬프트 정제 프록시 (mitmproxy 애드온)

VS Code의 GitHub Copilot Chat이 백엔드로 보내는 요청을 가로채서, "사람이 직접 입력한
프롬프트"(= <userRequest> 안쪽)만 정제된 문자열로 교체해 다시 흘려보낸다.
그 외(루프/툴 턴, 이미지 등 비-text 파트, 응답 스트림, 알 수 없는 형식)는 절대 건드리지 않는다.

────────────────────────────────────────────────────────────────────────────
구성(목차)
  1) CONFIG            : 환경변수로 바꾸는 모든 튜닝 지점(호스트/경로/로깅/교체값/서버주소)
  2) 로깅 유틸         : 콘솔 + observe-오늘날짜.log(JSONL) 누적. LOG_ENABLED로 온/오프.
  3) 핵심 로직(순수)   : <userRequest> 추출·교체, refine_text(교체값 결정), 커스텀 서버 호출
  4) mitmproxy 글루    : 요청/웹소켓 훅. 여기서만 flow에 접근한다.
────────────────────────────────────────────────────────────────────────────

대상 채널(고른 모델에 따라 다름) - 사람 입력은 셋 다 <userRequest>...</userRequest>로 들어온다:
  - Claude 모델 -> POST /v1/messages (Anthropic, SSE)          : HTTP request 훅에서 본문 교체
  - GPT 모델    -> /responses (WebSocket)                       : websocket_message 훅에서 프레임 교체
  - 공통/백그라운드 -> POST /chat/completions (NES·제목생성 등)  : <userRequest> 없으면 자동 무시

설계 원칙(절대 제약):
  - 어떤 에러에서도 fail-open. 의심스러우면 원본 그대로 통과시킨다.
  - allowlist 방식: <userRequest> 마커 + type=="text" 텍스트만 손댄다. 모르는 건 통과.
  - 응답(서버->클라) 스트림은 한 바이트도 수정하지 않는다.
  - '마지막 사람 입력 턴'만 교체한다. 마지막이 user가 아니면(루프/툴 턴) 손대지 않는다.

핵심 로직(extract/replace/refine 등)은 mitmproxy에 의존하지 않는 순수 함수라 테스트가 직접 import 가능.

────────────────────────────────────────────────────────────────────────────
전체 흐름 한눈에 (요청 1건이 거치는 길)
  1. VS Code가 Copilot 백엔드로 요청을 보냄  ->  mitmproxy(이 프록시)가 중간에서 가로챔.
  2. mitmproxy가 이 파일의 'request' 또는 'websocket_message' 함수를 자동으로 불러줌(4번 글루).
     (이 함수들은 우리가 직접 호출하지 않는다 - mitmproxy가 이름을 보고 알아서 부른다. = '훅').
  3. is_target()으로 "우리가 손댈 트래픽인가?"를 거른다. 아니면 그대로 통과.
  4. 본문(JSON)을 파싱해, '마지막 사람 입력' 안의 <userRequest>...</userRequest> 안쪽 텍스트를 찾는다(3번 순수 로직).
  5. 그 안쪽을 refine_text()가 정한 값(지금은 고정 문자열 "안녕,클로드")으로 바꾼다.
  6. 바뀐 본문을 다시 flow에 써서 서버로 흘려보내고, record_rewrite()로 1줄 로그를 남긴다(2번 로깅).
  * 위 어느 단계에서든 문제가 생기면 '원본 그대로 통과'가 기본값이다(fail-open).

읽는 순서 추천: 이 docstring -> 4번 글루(request/websocket_message: 진입점) -> 거기서 부르는
3번 순수 함수들 순으로 따라가면 한 요청이 처리되는 길을 그대로 짚을 수 있다.
────────────────────────────────────────────────────────────────────────────
"""

import os
import re
import json
import logging
import datetime
from typing import Any, List, Optional, Tuple

# ============================ 1) CONFIG (튜닝 지점) =========================
# 이 파일이 있는 폴더. 날짜별 로그 파일의 기본 저장 위치.
_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

# --- 엔드포인트 매칭 ---
# 호스트에 이 문자열이 포함되고(api.individual/enterprise/business.githubcopilot.com 전부 커버),
# 경로에 TARGET_PATHS 중 하나가 포함되는 POST 만 대상. 그 외 트래픽은 전부 통과.
HOST_SUBSTRING = os.environ.get("COPILOT_HOST_SUBSTRING", "githubcopilot.com")
TARGET_PATHS: Tuple[str, ...] = (
    "/chat/completions",   # 백그라운드(NES·제목생성). <userRequest> 없으면 자동 무시.
    "/v1/messages",        # Claude 모델의 진짜 대화 턴(HTTP).
    "/responses",          # GPT 모델의 진짜 대화 턴(보통 WebSocket).
)
# /responses(주로 GPT, WebSocket) 식별용 경로 조각. 이 경로는 messages가 아닌 input 스키마.
RESPONSES_PATH = os.environ.get("COPILOT_RESPONSES_PATH", "/responses")

# --- 로깅 (온/오프 + 날짜별 누적) ---
# LOG_ENABLED=0/false/off/no/빈값 이면 파일 로깅을 끈다(콘솔 교체 알림은 항상 표시).
LOG_ENABLED = os.environ.get("LOG_ENABLED", "1").strip().lower() not in ("0", "false", "off", "no", "")
# 로그 파일을 둘 폴더와 파일명 접두사. 파일명 = {접두사}{YYYY-MM-DD}.log
# 기본값: 프로젝트 루트가 아니라 전용 폴더 'logs/'. (LOG_DIR 환경변수로 다른 위치 지정 가능.)
LOG_DIR = os.environ.get("LOG_DIR", os.path.join(_SCRIPT_DIR, "logs"))
LOG_FILE_PREFIX = os.environ.get("LOG_FILE_PREFIX", "observe-")
# 로그에 남길 before/after 텍스트 최대 길이(과도하게 긴 입력 방어).
LOG_MAX_CHARS = int(os.environ.get("LOG_MAX_CHARS", "8000"))

# --- 교체값(정제 결과) 설정 ---
# [현재/테스트] refine_text()가 서버 호출 없이 돌려줄 고정 문자열. 전체 파이프라인 검증용.
FIXED_REPLACEMENT = os.environ.get("FIXED_REPLACEMENT", "안녕,클로드")
# [정식] 내가 따로 띄울 '정제 서버'의 엔드포인트. 확정되면 여기에 넣고 refine_text()의 주석을 해제.
#        지금은 공란 -> 어차피 refine_text()가 고정 문자열 경로를 쓰므로 영향 없음.
REFINE_API_URL = os.environ.get("REFINE_API_URL", "")          # 예: http://127.0.0.1:8000/refine (현재 공란)
REFINE_API_TIMEOUT = float(os.environ.get("REFINE_API_TIMEOUT", "20"))

# --- @refine 확장 bypass 마커 (P6) ---
# VS Code 확장의 '@refine' 참가자가 '이미 확정/정제된' 텍스트를 네이티브 Copilot에 보낼 때 맨 앞에 붙인다.
# 프록시는 <userRequest> 안쪽에서 이 마커를 보면 '이미 처리됨'으로 간주해 정제하지 않고, 마커만 떼어 통과시킨다
# (allowlist 철학의 연장: '표시된 것=통과'). 자동 Refiner가 켜져 있어도 '@refine로 보낸 메시지'만 이중 정제를 피한다.
# 눈에 안 띄는 zero-width 토큰이라 모델/사람 눈에 거의 안 보이고, 일반 프롬프트엔 결코 없을 희귀 시퀀스다.
# 마커 처리 중 무슨 일이 나도 원본을 통과시킨다(fail-open).
# ★ 확장 쪽(src/refiner.js)의 BYPASS_MARKER와 '정확히 같은' 코드포인트여야 한다:
#   U+200B U+2063 U+2060 U+2063 U+200B (전부 zero-width).
BYPASS_MARKER = os.environ.get("REFINE_BYPASS_MARKER", "​⁣⁠⁣​")
# ===========================================================================


# ============================ 2) 로깅 유틸 =================================
logger = logging.getLogger("refine_copilot")


def log(msg: str, level: int = logging.INFO) -> None:
    """mitmproxy는 표준 logging 레코드를 캡처해 mitmdump 출력에 보여준다.
    (윈도우 cp949 콘솔이 깨지는 -, ->, ... 같은 ASCII 기호만 쓴다.)"""
    logger.log(level, msg)


def preview(text: Any, n: int = 160) -> str:
    """텍스트를 한 줄로 펴고 앞 n자만 잘라 콘솔 미리보기 문자열로."""
    s = text if isinstance(text, str) else str(text)
    one_line = s.replace("\n", "\\n").replace("\r", "")
    if len(one_line) > n:
        return f'"{one_line[:n]}...(총 {len(s)}자)"'
    return f'"{one_line}"'


def _today_log_path() -> str:
    """오늘 날짜의 로그 파일 경로. 날짜가 바뀌면 자동으로 새 파일에 쌓인다."""
    today = datetime.date.today().isoformat()      # 'YYYY-MM-DD'
    return os.path.join(LOG_DIR, f"{LOG_FILE_PREFIX}{today}.log")


def _truncate(s: Any, n: int = LOG_MAX_CHARS) -> Any:
    if isinstance(s, str) and len(s) > n:
        return s[:n] + f"...(총 {len(s)}자)"
    return s


def record_rewrite(channel: str, model: Any, before: str, after: str) -> None:
    """교체 1건을 기록한다.
      - 콘솔: 교체가 실제로 일어났는지 항상 한 줄로 보여준다(운영 확인용).
      - 파일: LOG_ENABLED면 observe-오늘날짜.log 에 JSONL 한 줄을 append 한다.
              (한 줄 = 하나의 JSON 객체 -> 사람이 읽기도 좋고, 추후 VS Code 확장이 파싱하기도 좋다.)
    로깅 실패가 프록시 흐름을 깨면 안 되므로 전부 try/except로 보호한다(fail-open)."""
    try:
        log(f"[교체] {channel} model={model} : {preview(before)} -> {preview(after)}")
    except Exception:
        pass

    if not LOG_ENABLED:
        return
    record = {
        "ts": datetime.datetime.now().isoformat(timespec="seconds"),
        "channel": channel,
        "model": model,
        "before": _truncate(before),
        "after": _truncate(after),
    }
    try:
        line = json.dumps(record, ensure_ascii=False)
        os.makedirs(LOG_DIR, exist_ok=True)   # 전용 로그 폴더(logs/)가 없으면 자동 생성
        with open(_today_log_path(), "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception as e:
        try:
            log(f"로그 파일 기록 실패(무시): {e!r}", logging.WARNING)
        except Exception:
            pass


# ============================ 3) 핵심 로직 (순수) ==========================
# 관찰(2026-06-23): VS Code Copilot Chat은 사람이 친 문장을 '마지막 user 입력'의 text 안에
# <userRequest>...</userRequest> 로 감싸 보낸다(앞에 <context> 등 스캐폴딩 동반). 그래서 재작성은
# text 전체가 아니라 이 태그 '안쪽'만 교체한다. 태그가 없으면(=백그라운드 호출/NES/제목생성)
# 아무것도 하지 않는다 - 이 마커 자체가 안전한 allowlist 역할을 한다.

# <userRequest>와 </userRequest> 사이의 내용을 뽑아내는 정규식.
#   (.*?)   : 두 태그 사이의 '안쪽' 전부를 포착(괄호=캡처 그룹 1번). ? 때문에 '최소 매칭'이라
#             첫 </userRequest>에서 멈춘다(여러 개 있어도 욕심내지 않음).
#   re.DOTALL: 보통 '.'은 줄바꿈을 못 넘지만, 이 옵션이면 여러 줄에 걸친 내용도 한 덩어리로 잡는다.
_USER_REQUEST_RE = re.compile(r"<userRequest>(.*?)</userRequest>", re.DOTALL)


def extract_user_request(text: Any) -> Optional[str]:
    """text 안의 첫 <userRequest>...</userRequest> 안쪽 문자열을 반환(없으면 None)."""
    if not isinstance(text, str):
        return None
    m = _USER_REQUEST_RE.search(text)
    if not m:
        return None
    return m.group(1).strip()


def replace_user_request_block(text: str, new_inner: str) -> Tuple[str, int]:
    """text의 <userRequest>...</userRequest> 블록 안쪽을 new_inner로 교체.
    반환: (새 text, 교체 횟수).
    람다 치환이라 new_inner 안에 \\1 같은 역참조/백슬래시가 있어도 그대로 들어간다
    (서버가 정제해 준 임의의 문자열을 안전하게 끼워 넣기 위함)."""
    block = "<userRequest>\n" + new_inner + "\n</userRequest>"
    return _USER_REQUEST_RE.subn(lambda _m: block, text)


# ----- 정제 서버 호출(정식 경로) — 엔드포인트만 확정하면 바로 쓸 수 있게 미리 구현 -----
# 같은 원본 입력이면 서버를 다시 부르지 않도록 캐시. (현재는 고정 문자열 경로라 사용되지 않음.)
_refine_cache: dict = {}


def call_refine_api(original: str) -> Optional[str]:
    """내가 따로 띄운 '정제 서버'(REFINE_API_URL)에 원본 프롬프트를 보내고, 정제된 프롬프트를 받아온다.
    실패하면 None을 돌려준다(-> 호출 측에서 원본 유지 = fail-open).
    표준 라이브러리(urllib)만 사용 - mitmdump 환경에 추가 패키지 설치가 필요 없다.

    !!! 서버가 확정되면 아래 (1) 요청 스키마와 (2) 응답 파싱만 실제 서버에 맞추면 된다 !!!
    지금은 흔한 형태(요청 {"prompt": ...} / 응답 {"refined": ...} 등)를 관대하게 가정해 둔 상태."""
    if not REFINE_API_URL:
        return None
    import urllib.request  # 표준 라이브러리, 항상 사용 가능

    # ── (1) 요청 스키마: 서버 확정 시 여기를 맞추기 ───────────────────────────
    payload = {"prompt": original}
    # ─────────────────────────────────────────────────────────────────────────
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        REFINE_API_URL, data=body, method="POST",
        headers={"Content-Type": "application/json; charset=utf-8"},
    )
    try:
        with urllib.request.urlopen(req, timeout=REFINE_API_TIMEOUT) as resp:
            raw = resp.read()
            ctype = (resp.headers.get("content-type") or "").lower()
    except Exception as e:
        log(f"정제 API 호출 실패 - 원본 유지(fail-open): {e!r}", logging.WARNING)
        return None

    try:
        text = raw.decode("utf-8")
    except Exception:
        log("정제 API 응답 디코드 실패 - 원본 유지", logging.WARNING)
        return None

    # ── (2) 응답 스키마: 서버 확정 시 여기를 맞추기 ───────────────────────────
    if "json" not in ctype:
        return text or None  # 평문(text/plain)으로 정제 결과를 그대로 주는 서버면 이걸로 끝.
    try:
        data = json.loads(text)
    except Exception as e:
        log(f"정제 API 응답 JSON 파싱 실패 - 원본 유지: {e!r}", logging.WARNING)
        return None
    if isinstance(data, str):
        return data
    if isinstance(data, dict):
        for key in ("refined", "text", "result", "output", "response", "content", "message"):
            v = data.get(key)
            if isinstance(v, str) and v.strip():
                return v
    log("정제 API 응답에서 텍스트 키를 못 찾음 - 원본 유지", logging.WARNING)
    return None
    # ─────────────────────────────────────────────────────────────────────────


def strip_bypass_marker(text: Any) -> Tuple[Any, bool]:
    """text 안에 BYPASS_MARKER가 있으면 (마커 제거된 text, True), 없으면 (원본, False).
    절대 예외를 던지지 않는다(fail-open). @refine 확장이 붙인 'bypass(정제 건너뛰기)' 표식을 떼는 단일 지점."""
    try:
        if isinstance(text, str) and BYPASS_MARKER and BYPASS_MARKER in text:
            return text.replace(BYPASS_MARKER, ""), True
    except Exception:
        pass
    return text, False


def refine_text(original: str) -> str:
    """사람이 친 프롬프트(<userRequest> 안쪽) 한 덩어리를 '정제된' 문자열로 바꿔 돌려준다.
    절대 예외를 던지지 않는다(fail-open: 문제가 생기면 원본을 그대로 반환).

    [정식 동작 — 엔드포인트 확정 후]
        내 커스텀 서버(REFINE_API_URL)에 원본을 보내고, 응답으로 받은 '정제된 프롬프트'를
        대신 끼워 넣는다. 아래 블록의 주석을 해제하면 즉시 전환된다(call_refine_api 등은 이미 구현됨).

    [현재 동작 — 테스트용]
        서버 연동 전에 전체 파이프라인(가로채기 -> 교체 -> 재전송 -> 로깅)을 먼저 검증할 수 있도록,
        무조건 고정 문자열 FIXED_REPLACEMENT("안녕,클로드")로 교체한다.
    """
    if not isinstance(original, str) or not original.strip():
        return original

    # [bypass] @refine 확장이 '이미 확정/정제'한 텍스트엔 마커가 붙어 온다 -> 정제하지 않고 마커만 제거해 통과.
    #          (allowlist 철학의 연장: '표시된 것=이미 처리됨=통과'. 자동 Refiner와 깨끗이 공존.)
    cleaned, bypass = strip_bypass_marker(original)
    if bypass:
        return cleaned if (isinstance(cleaned, str) and cleaned.strip()) else original

    # ───────────────────────────────────────────────────────────────────────
    # [정식] 커스텀 서버 호출로 정제 — 엔드포인트(REFINE_API_URL) 확정 후 아래 주석을 해제.
    #
    # if original in _refine_cache:
    #     return _refine_cache[original]
    # refined = call_refine_api(original)                                   # 서버에 원본을 보내고 정제본 수신
    # result = refined if (isinstance(refined, str) and refined.strip()) else original  # 실패 시 원본 유지
    # _refine_cache[original] = result
    # return result
    # ───────────────────────────────────────────────────────────────────────

    # [현재/테스트] 고정 문자열로 교체. (위 정식 블록을 살리면 이 줄은 도달하지 않는다.)
    return FIXED_REPLACEMENT


# 사람 입력을 찾아 교체하는 길은 두 갈래다 - 요청 본문의 '모양(스키마)'이 모델마다 다르기 때문.
#   (A) messages[] 스키마(Claude /v1/messages, /chat/completions): 역할(role)이 명확하므로
#       "마지막 항목의 role이 user인가?"를 정확히 따져 현재 턴만 고른다. -> 아래 (A) 함수들.
#   (B) input[] 등 그 외 스키마(GPT /responses): 구조 세부를 다 알 필요 없이, 대화 배열을 훑어
#       <userRequest> 마커가 든 마지막 문자열을 현재 턴으로 본다. -> 더 아래 (B) 함수들.
# 두 길 모두 결국 같은 순수 함수(extract/replace/refine_text)로 '안쪽'만 바꾼다.

# ----- (A) messages[] 구조 처리: /v1/messages, /chat/completions -----

def find_last_user_request(messages: Any) -> List[Tuple[Optional[int], str, str]]:
    """'마지막 user 메시지'에서 <userRequest>가 든 텍스트 위치를 찾는다. 순수 함수.
    반환: [(part_index 또는 None, 원본 text, 추출된 inner), ...]. 대상 없으면 [].
    오직 마지막 메시지만 본다(과거 턴의 <userRequest>는 건드리지 않는다).
    마지막이 user가 아니면(assistant/tool = 루프/툴 턴) 빈 목록을 돌려준다."""
    if not isinstance(messages, list) or not messages:
        return []
    last = messages[-1]
    if not isinstance(last, dict) or last.get("role") != "user":
        return []
    content = last.get("content")
    found: List[Tuple[Optional[int], str, str]] = []
    if isinstance(content, str):
        inner = extract_user_request(content)
        if inner is not None:
            found.append((None, content, inner))
    elif isinstance(content, list):
        # 멀티파트: type=="text" 파트만 후보. 나머지(image_url 등)는 절대 손대지 않는다.
        for pi, part in enumerate(content):
            if isinstance(part, dict) and part.get("type") == "text":
                inner = extract_user_request(part.get("text", ""))
                if inner is not None:
                    found.append((pi, part.get("text", ""), inner))
    return found


def apply_user_request_rewrite(messages: Any, refiner) -> List[Tuple[Optional[int], str, str]]:
    """'마지막 user 메시지'의 <userRequest> 안쪽만 refiner 결과로 교체(messages 제자리 수정).
    반환: 변경 목록 [(part_index, before_inner, after_inner), ...] (빈 목록 = 수정 없음).
    어떤 경우에도 예외를 던지지 않는다(fail-open)."""
    targets = find_last_user_request(messages)
    if not targets:
        return []
    last = messages[-1]
    content = last.get("content")
    changes: List[Tuple[Optional[int], str, str]] = []
    for (pi, original_text, inner) in targets:
        try:
            new_inner = refiner(inner)
        except Exception as e:  # refiner 실패 -> 이 파트는 건드리지 않음
            log(f"refiner 예외(이 파트 건너뜀): {e!r}", logging.WARNING)
            continue
        if not isinstance(new_inner, str) or not new_inner.strip():
            continue  # 빈/이상 결과 -> 원본 유지
        new_text, n = replace_user_request_block(original_text, new_inner)
        if n == 0 or new_text == original_text:
            continue
        if pi is None:
            last["content"] = new_text
        else:
            content[pi]["text"] = new_text
        changes.append((pi, inner, new_inner))
    return changes


# ----- (B) 스키마 비의존 제네릭 처리: /responses(GPT, input[] 스키마) 등 -----
# Responses API(GPT)는 messages가 아니라 input[] 스키마를 쓴다. 구조 세부를 몰라도 동작하도록,
# 대화 배열을 순회해 <userRequest>가 든 문자열을 찾는다. 마커가 사람 입력에만 붙으므로 안전.

def _conversation_nodes(obj: Any) -> Any:
    """마커 검색 범위를 '대화 배열'로 좁힌다: Responses API(GPT)는 obj['input'], chat 계열은
    obj['messages']. 둘 다 없으면 obj 전체.
    -> 프레임 뒤쪽의 tools[]나 시스템 프롬프트에 우연히 <userRequest>가 섞여도 현재 턴이 아닌
       곳을 건드리지 않게 한다. (2026-06-23 GPT /responses 관찰로 input 스키마 확정.)"""
    if isinstance(obj, dict):
        if isinstance(obj.get("input"), list):
            return obj["input"]
        if isinstance(obj.get("messages"), list):
            return obj["messages"]
    return obj


def _collect_userrequest_strings(obj: Any) -> List[Tuple[Any, Any, str]]:
    """JSON 구조에서 '<userRequest>'가 든 모든 (컨테이너, 키/인덱스, text)를 문서 순서로 수집. 읽기 전용."""
    matches: List[Tuple[Any, Any, str]] = []

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            for k, v in node.items():
                if isinstance(v, str):
                    if "<userRequest>" in v:
                        matches.append((node, k, v))
                elif isinstance(v, (dict, list)):
                    walk(v)
        elif isinstance(node, list):
            for i, v in enumerate(node):
                if isinstance(v, str):
                    if "<userRequest>" in v:
                        matches.append((node, i, v))
                elif isinstance(v, (dict, list)):
                    walk(v)

    try:
        walk(obj)
    except Exception as e:  # 깊은/이상 구조에서도 죽지 않게
        log(f"_collect_userrequest_strings 순회 예외(무시): {e!r}", logging.WARNING)
    return matches


def rewrite_json_user_request(obj: Any, refiner) -> Tuple[bool, Optional[str], Optional[str]]:
    """대화 배열에서 '마지막'(=문서 순서상 가장 뒤 = 보통 현재 턴) <userRequest> 안쪽만 refiner
    결과로 교체(obj 제자리 수정). 반환: (교체했는가, before_inner, after_inner).
    어떤 경우에도 예외를 던지지 않는다(fail-open)."""
    matches = _collect_userrequest_strings(_conversation_nodes(obj))
    if not matches:
        return (False, None, None)
    container, key, text = matches[-1]
    inner = extract_user_request(text)
    if inner is None:
        return (False, None, None)
    try:
        new_inner = refiner(inner)
    except Exception as e:
        log(f"refiner 예외(무수정): {e!r}", logging.WARNING)
        return (False, None, None)
    if not isinstance(new_inner, str) or not new_inner.strip():
        return (False, None, None)
    new_text, n = replace_user_request_block(text, new_inner)
    if n == 0 or new_text == text:
        return (False, None, None)
    container[key] = new_text
    return (True, inner, new_inner)


# ============================ 4) mitmproxy 글루 ============================
# 여기서만 flow에 접근한다. 모든 훅은 try/except로 감싸 어떤 에러에서도 무수정 통과(fail-open).
#
# [mitmproxy 훅이란?] mitmproxy는 이 파일을 애드온으로 읽은 뒤, '정해진 이름'의 함수를 사건마다
#   자동으로 호출한다. 우리가 직접 부르지 않는다 - 이름이 곧 약속이다:
#     - load(loader)            : 애드온이 처음 로드될 때 1회.
#     - request(flow)           : HTTP 요청이 들어올 때마다.
#     - websocket_message(flow) : WebSocket 프레임이 오갈 때마다.
#   이름을 바꾸면 mitmproxy가 못 알아보고 호출하지 않는다(=동작 안 함).
#
# [flow란?] 요청/응답 한 쌍을 담은 객체. flow.request로 요청에 접근하고, flow.request.text에
#   새 문자열을 써 넣으면 그게 서버로 전송된다(우리가 본문을 바꾸는 방법). 이 객체는 mitmproxy
#   세계에서만 의미가 있어, 테스트하기 쉽도록 3번의 순수 로직과 격리해 여기(4번)에만 모아 둔다.

def is_target(flow) -> bool:
    """호스트에 githubcopilot.com 포함 + 경로에 TARGET_PATHS 중 하나 포함 + POST 인가."""
    req = flow.request
    if req.method != "POST":
        return False
    if HOST_SUBSTRING not in (req.pretty_host or ""):
        return False
    path = req.path or ""
    return any(t in path for t in TARGET_PATHS)


def parse_body(flow) -> Optional[dict]:
    """요청 본문을 JSON dict로 파싱. 실패하면 None(-> 통과). 절대 예외를 던지지 않는다."""
    try:
        raw = flow.request.get_text(strict=False)
    except Exception:
        return None
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except Exception:
        return None
    return data if isinstance(data, dict) else None


def load(loader) -> None:
    """애드온 로드 시 1회. 현재 활성 동작을 찍어 헷갈리지 않게 한다."""
    log("refine_copilot 로드됨 - 사람 입력(<userRequest> 안쪽)만 교체, 그 외 전부 통과")
    log(f"  대상  : host~={HOST_SUBSTRING!r}  paths~={TARGET_PATHS!r}")
    # 현재 교체값: refine_text()에서 서버 호출이 주석 처리돼 있어 '항상 고정 문자열'로 교체한다.
    log(f"  교체값: 고정 문자열 {FIXED_REPLACEMENT!r}  "
        f"(서버 API 호출 코드는 준비됨/주석 상태, REFINE_API_URL={REFINE_API_URL!r})")
    log(f"  bypass: @refine 마커({len(BYPASS_MARKER)} zero-width chars) 감지 시 해당 턴은 정제 건너뜀")
    if LOG_ENABLED:
        log(f"  로깅  : ON  -> {_today_log_path()}  (JSONL, 날짜별 누적)")
    else:
        log("  로깅  : OFF (LOG_ENABLED=0)")


def request(flow) -> None:
    """HTTP 요청 진입점. Claude(/v1/messages)·백그라운드(/chat/completions)와, 혹시 HTTP로 오는
    /responses(GPT)를 처리한다. (GPT /responses가 WebSocket이면 아래 websocket_message가 처리.)"""
    try:
        if not is_target(flow):
            return  # 우리 대상이 아닌 트래픽 -> 통과
        data = parse_body(flow)
        if data is None:
            return  # 본문 파싱 실패 -> 흐름 방해 금지, 통과

        path = flow.request.path or ""
        model = data.get("model")

        # 라우팅: /responses(GPT)는 input[] 스키마 -> 제네릭. 그 외는 messages[] -> 마지막 user 턴.
        if RESPONSES_PATH in path:
            changed, before, after = rewrite_json_user_request(data, refine_text)
            changes = [(before, after)] if changed else []
        else:
            changes = [(b, a) for (_pi, b, a) in apply_user_request_rewrite(data.get("messages"), refine_text)]

        if not changes:
            return  # <userRequest> 없음(백그라운드/NES/제목생성 등) -> 무수정 통과

        try:
            new_body = json.dumps(data, ensure_ascii=False)
        except Exception as e:  # 직렬화 실패 -> 아직 flow를 안 건드렸으니 원본 그대로 전송
            log(f"[REWRITE] 본문 직렬화 실패 - 원본 통과(fail-open): {e!r}", logging.ERROR)
            return
        flow.request.text = new_body  # mitmproxy가 Content-Length 자동 갱신
        for (before, after) in changes:
            record_rewrite(path, model, before, after)

    except Exception as e:  # 최후의 fail-open 방어선
        log(f"request 훅 예외 - 통과(fail-open): {e!r}", logging.ERROR)


# ----- WebSocket: GPT 모델의 /responses는 WebSocket으로 흐른다 -----
#   '클라->서버'(VS Code->서버 = 사람 입력 방향) 프레임의 <userRequest>만 교체한다.
#   '서버->클라'(응답 스트림) 프레임은 어떤 경우에도 건드리지 않는다.

def _ws_host_matches(flow) -> bool:
    req = getattr(flow, "request", None)
    return bool(req) and HOST_SUBSTRING in (req.pretty_host or "")


def _ws_decode(content) -> Optional[str]:
    """프레임 바이트를 UTF-8 텍스트로. 바이너리/비-UTF8이면 None."""
    if isinstance(content, str):
        return content
    if not isinstance(content, (bytes, bytearray)):
        return None
    try:
        return bytes(content).decode("utf-8")
    except Exception:
        return None


def websocket_message(flow) -> None:
    """WebSocket 프레임 1개 수신 시 호출. 클라->서버 프레임만 검사/교체하고, 서버->클라는 통과."""
    try:
        if not _ws_host_matches(flow):
            return
        ws = getattr(flow, "websocket", None)
        if ws is None or not getattr(ws, "messages", None):
            return
        msg = ws.messages[-1]                       # 가장 최근 프레임
        if not bool(getattr(msg, "from_client", False)):
            return  # 서버->클라(응답) 프레임 -> 무수정
        content = getattr(msg, "content", b"") or b""
        _rewrite_ws_frame(msg, content, flow.request.path or "")
    except Exception as e:
        log(f"websocket_message 예외 - 무수정 통과(fail-open): {e!r}", logging.ERROR)


def _rewrite_ws_frame(msg, content, path: str) -> None:
    """클라->서버 WS 프레임 안의 <userRequest>만 교체. JSON으로 안전히 파싱될 때만 손댄다.
    (JSON 파싱 없이 정규식으로 직접 치환하면 줄바꿈 등 이스케이프가 깨질 수 있어 무수정 통과한다.)"""
    raw = bytes(content) if isinstance(content, (bytes, bytearray)) else None
    if raw is not None and b"<userRequest>" not in raw:
        return  # 마커 없음 -> 우리 대상 아님(빠른 무수정)
    text = _ws_decode(content)
    if text is None or "<userRequest>" not in text:
        return
    try:
        data = json.loads(text)
    except Exception:
        log(f"[REWRITE/WS] {path}: <userRequest>는 있으나 JSON 파싱 실패 - 무수정(fail-open)", logging.WARNING)
        return
    changed, before, after = rewrite_json_user_request(data, refine_text)
    if not changed:
        return
    try:
        new_text = json.dumps(data, ensure_ascii=False)
    except Exception as e:
        log(f"[REWRITE/WS] 직렬화 실패 - 무수정(fail-open): {e!r}", logging.ERROR)
        return
    try:
        msg.content = new_text.encode("utf-8")      # WebSocket은 길이 변경에 관대(프레임 자동 재구성)
    except Exception as e:
        log(f"[REWRITE/WS] content 설정 실패 - 무수정(fail-open): {e!r}", logging.ERROR)
        return
    model = data.get("model") if isinstance(data, dict) else None
    record_rewrite(f"{path}(ws)", model, before, after)
