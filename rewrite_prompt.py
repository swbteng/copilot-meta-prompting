import os
import requests
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

# 로컬 vLLM 서버. 호스트/포트는 환경변수 HOST, LLM_PORT 로 덮어쓸 수 있음.
HOST = os.environ.get("HOST", "127.0.0.1")
LLM = f"http://{HOST}:{os.environ.get('LLM_PORT', '4000')}"

user_input = "AI관련 자유 주제로 5분 발표 ppt 슬라이드 내용을 구성해줘."
 
system_prompt = f"""You are an expert prompt engineer. Your job is to take a rough, ambiguous user message and rewrite it into a clear, structured prompt that accurately reflects the user's true intent.
 
Follow this process:
 
1. Identify the core TASK the user wants to accomplish
 
2. Infer the likely CONTEXT (domain, background, goal)
 
3. Extract any implicit CONSTRAINTS or requirements
 
4. Rewrite as a precise, self-contained prompt
 
Rules:

- Do NOT add information the user didn't imply

- Preserve the user's original intent exactly — clarify, don't embellish

- Use clear, imperative language

- If the domain is ambiguous, pick the most probable one based on context clues

- If the user's input is not in English, translate it to English, then write the rewritten prompt in English regardless

- Output ONLY a single JSON object, no explanation, no markdown code fences, no preamble. The JSON object must have exactly these two string fields:
  - "translated_input": a faithful English translation of the user's original input (if the input is already English, copy it as-is)
  - "rewritten_prompt": the clear, structured, self-contained prompt in English

User's rough input:

"{user_input}"

JSON output:"""
 
MODEL = "cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit"

l = requests.post(f"{LLM}/v1/chat/completions",
json={"model": MODEL,
"messages": [{"role": "user", "content": system_prompt}],
"max_tokens": 8192}, timeout=180)

print("llm:", l.status_code)
l.raise_for_status()

choice = l.json()["choices"][0]
msg = choice["message"]
# 추론 모델: 최종 답변은 content, 생각 과정은 reasoning 필드로 분리됨
content = (msg.get("content") or msg.get("reasoning") or "").strip()
finish_reason = choice.get("finish_reason")

# 모델이 JSON 으로 응답하도록 했으므로 파싱한다.
# 혹시 ```json ... ``` 같은 코드펜스로 감싸 오는 경우를 대비해 정리한다.
def _strip_code_fence(s: str) -> str:
    s = s.strip()
    if s.startswith("```"):
        # 첫 줄(``` 또는 ```json)과 마지막 ``` 제거
        s = s.split("\n", 1)[1] if "\n" in s else s
        if s.endswith("```"):
            s = s[: -3]
    return s.strip()

try:
    parsed = json.loads(_strip_code_fence(content))
    translated_input = parsed["translated_input"].strip()
    rewritten_prompt = parsed["rewritten_prompt"].strip()
except (json.JSONDecodeError, KeyError, AttributeError) as e:
    # 파싱 실패 시 원문을 그대로 rewritten_prompt 에 담아 둔다.
    print("warning: JSON 파싱 실패, 원문을 그대로 사용합니다:", e)
    translated_input = ""
    rewritten_prompt = content

print("translated_input:\n", translated_input)
print("rewritten_prompt:\n", rewritten_prompt)
 
# --- 저장 ---
# 다음 단계(임베딩 -> 벡터DB 유사도 계산)를 위해 본문 + 메타데이터를 함께
# JSONL 로 저장한다. 한 줄 = 한 레코드라 누적(append)과 재처리가 쉽다.
record = {
    "id": str(uuid.uuid4()),
    "created_at": datetime.now(timezone.utc).isoformat(),
    "model": MODEL,
    "user_input": user_input,        # 원본 입력 (payload 용)
    "translated_input": translated_input,  # 원본 입력의 영어 번역
    "rewritten_prompt": rewritten_prompt,  # 임베딩할 본문
    "finish_reason": finish_reason,
}
 
out_dir = Path(__file__).parent / "outputs"
out_dir.mkdir(exist_ok=True)
 
# 1) 파이프라인용: JSONL (append)
jsonl_path = out_dir / "rewritten_prompts.jsonl"
with jsonl_path.open("a", encoding="utf-8") as f:
    f.write(json.dumps(record, ensure_ascii=False) + "\n")
 
# 2) 사람이 보기용: 개별 txt (번역 + 대답 본문)
txt_path = out_dir / f"{record['id']}.txt"
txt_path.write_text(
    f"[translated_input]\n{translated_input}\n\n"
    f"[rewritten_prompt]\n{rewritten_prompt}\n",
    encoding="utf-8",
)
 
print(f"saved -> {jsonl_path} (id={record['id']})")
print(f"saved -> {txt_path}")
 