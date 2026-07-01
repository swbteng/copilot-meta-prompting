"""파이프라인 순수 로직 단위 테스트 (외부 서버 불필요).

LLM 호출부(`pipeline._chat`)를 가짜 함수로 바꿔(monkeypatch), 서버 없이
우리 코드의 파싱/폴백/추출 로직만 검증한다.
각 테스트는 '입력 -> 출력'을 print 로 남긴다(=-s 옵션으로 실행하면 로그에 그대로 보인다).

대응 요구사항:
  R-05  (1단계 정제) 유효 JSON 응답을 translated_input / rewritten_prompt 로 파싱
  R-06  (정제 견고성) 코드펜스 제거 + JSON 파싱 실패 시 원문 폴백
  R-09  (4단계 생성) "final adapted prompt:" 라벨 뒤만 추출(없으면 전문)
  R-13  필수 .env 누락 시 누락 키를 알리는 오류
"""
import json

import pytest

import pipeline


# ----------------------------------------------------------------------------
# R-05: 정제 결과 JSON 파싱
# ----------------------------------------------------------------------------
def test_rewrite_parses_translated_and_rewritten(monkeypatch):
    """LLM이 올바른 JSON을 주면 두 필드를 그대로 뽑아낸다."""
    user_input = "1더하기1?"
    fake_json = json.dumps(
        {"translated_input": "What is 1+1?", "rewritten_prompt": "Compute 1 plus 1."}
    )
    # _chat 은 (content, finish_reason) 튜플을 반환한다 → 가짜로 대체
    monkeypatch.setattr(pipeline, "_chat", lambda prompt: (fake_json, "stop"))

    result = pipeline.rewrite(user_input)

    print(f"\n[R-05] INPUT(user) = {user_input!r}")
    print(f"[R-05] LLM_RAW     = {fake_json!r}")
    print(f"[R-05] OUTPUT      = translated_input={result['translated_input']!r}, "
          f"rewritten_prompt={result['rewritten_prompt']!r}")

    assert result["translated_input"] == "What is 1+1?"
    assert result["rewritten_prompt"] == "Compute 1 plus 1."
    assert result["finish_reason"] == "stop"


# ----------------------------------------------------------------------------
# R-06: 코드펜스 제거 + 파싱 실패 폴백
# ----------------------------------------------------------------------------
def test_strip_code_fence_removes_json_fence():
    """```json ... ``` 로 감싸 온 응답에서 펜스를 제거한다."""
    fenced = "```json\n{\"a\": 1}\n```"
    out = pipeline._strip_code_fence(fenced)
    print(f"\n[R-06] INPUT  = {fenced!r}")
    print(f"[R-06] OUTPUT = {out!r}")
    assert out == '{"a": 1}'


def test_rewrite_handles_fenced_json(monkeypatch):
    """코드펜스로 감싼 JSON도 정상 파싱돼야 한다(견고성)."""
    fenced = "```json\n" + json.dumps(
        {"translated_input": "hi", "rewritten_prompt": "say hi"}
    ) + "\n```"
    monkeypatch.setattr(pipeline, "_chat", lambda prompt: (fenced, "stop"))

    result = pipeline.rewrite("안녕")
    print(f"\n[R-06] INPUT(LLM_RAW) = {fenced!r}")
    print(f"[R-06] OUTPUT         = {result['translated_input']!r} / {result['rewritten_prompt']!r}")

    assert result["translated_input"] == "hi"
    assert result["rewritten_prompt"] == "say hi"


def test_rewrite_falls_back_when_not_json(monkeypatch):
    """JSON이 아니면 throw 없이 원문을 rewritten_prompt 로 담아 폴백한다."""
    raw = "그냥 평문 응답"
    monkeypatch.setattr(pipeline, "_chat", lambda prompt: (raw, "stop"))

    result = pipeline.rewrite("아무거나")
    print(f"\n[R-06] INPUT(LLM_RAW, JSON아님) = {raw!r}")
    print(f"[R-06] OUTPUT(폴백)             = translated_input={result['translated_input']!r}, "
          f"rewritten_prompt={result['rewritten_prompt']!r}")

    assert result["translated_input"] == ""           # 파싱 실패 → 번역 비움
    assert result["rewritten_prompt"] == raw            # 원문 폴백


# ----------------------------------------------------------------------------
# R-09: 최종 생성 라벨 추출
# ----------------------------------------------------------------------------
def test_generate_extracts_after_label(monkeypatch):
    """'final adapted prompt:' 라벨이 있으면 그 뒤 텍스트만 쓴다."""
    raw = "여기는 잡설.\nfinal adapted prompt: 진짜 최종 프롬프트"
    monkeypatch.setattr(pipeline, "_chat", lambda prompt: (raw, "stop"))

    result = pipeline.generate("orig", "rewritten", ["tpl1"])
    print(f"\n[R-09] INPUT(LLM_RAW) = {raw!r}")
    print(f"[R-09] OUTPUT         = {result['adapted_prompt']!r}")

    assert result["adapted_prompt"] == "진짜 최종 프롬프트"


def test_generate_uses_full_text_without_label(monkeypatch):
    """라벨이 없으면 전문을 그대로 사용한다."""
    raw = "라벨 없는 최종 프롬프트 전문"
    monkeypatch.setattr(pipeline, "_chat", lambda prompt: (raw, "stop"))

    result = pipeline.generate("orig", "rewritten", ["tpl1"])
    print(f"\n[R-09] INPUT(LLM_RAW, 라벨없음) = {raw!r}")
    print(f"[R-09] OUTPUT                   = {result['adapted_prompt']!r}")

    assert result["adapted_prompt"] == raw


# ----------------------------------------------------------------------------
# R-13: 필수 설정 누락 가드
# ----------------------------------------------------------------------------
def test_require_raises_with_missing_key_name():
    """빈 값이 있으면 어떤 키가 비었는지 메시지에 담아 RuntimeError."""
    with pytest.raises(RuntimeError) as exc_info:
        pipeline._require(LLM_BASE_URL="", LLM_MODEL="some-model")

    print(f"\n[R-13] INPUT  = LLM_BASE_URL='', LLM_MODEL='some-model'")
    print(f"[R-13] OUTPUT = RuntimeError: {exc_info.value}")

    assert "LLM_BASE_URL" in str(exc_info.value)       # 누락된 키 이름 노출
    assert "LLM_MODEL" not in str(exc_info.value)        # 채워진 키는 언급 안 함


def test_require_passes_when_all_present():
    """모두 채워져 있으면 아무 일도 일어나지 않는다(예외 없음)."""
    pipeline._require(A="x", B="y")  # 예외가 나지 않으면 통과
    print("\n[R-13] INPUT = A='x', B='y' -> OUTPUT = 예외 없음(통과)")
