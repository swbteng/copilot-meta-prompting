"""메타 프롬프팅 파이프라인 - 4단계 + 전체 실행.

  사용자 입력 -> (1) LLM 정제 -> (2) 벡터DB 검색 -> (3) 리랭킹 -> (4) LLM 최종 프롬프트 생성

각 단계는 독립 함수라 엔드포인트에서 따로 호출할 수 있고, run_full()이 전부 이어 붙인다.
- (1) rewrite / (4) generate: 루트 데모 스크립트(rewrite_prompt.py, pick_prompt.py)의 프롬프트와
  파싱 로직을 그대로 옮겨 온 것. 데모의 파일 저장/하드코딩 입력 같은 부작용은 제거했다.
- (2) search / (3) rerank: retrieval.py 의 자족 함수(program_db 에서 흡수)를 호출한다.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Optional

import requests

import config
from retrieval import rerank_candidates, search_chroma


def _require(**values: str) -> None:
    """.env 미설정(빈 값) 시 무엇을 채워야 하는지 명확히 알려준다."""
    missing = [name for name, value in values.items() if not value]
    if missing:
        raise RuntimeError(
            f"설정값이 비어 있습니다: {', '.join(missing)}. program_backend/.env 를 채우세요."
        )


# ============================ LLM 호출 헬퍼 ============================
def _chat(prompt: str) -> tuple[str, Optional[str]]:
    """OpenAI 호환 /v1/chat/completions 한 번 호출. (content, finish_reason) 반환.

    추론 모델은 최종 답변이 content, 생각 과정이 reasoning 필드로 분리되므로 content가 비면 reasoning을 쓴다.
    RunPod 등 인증이 필요한 엔드포인트를 위해 키가 있으면 Bearer 헤더를 붙인다(로컬 vLLM은 키가 비어 생략).
    """
    _require(LLM_BASE_URL=config.LLM_BASE_URL, LLM_MODEL=config.LLM_MODEL)
    headers = {}
    if config.LLM_API_KEY and config.LLM_API_KEY != "EMPTY":
        headers["Authorization"] = f"Bearer {config.LLM_API_KEY}"

    response = requests.post(
        f"{config.LLM_BASE_URL}/v1/chat/completions",
        json={
            "model": config.LLM_MODEL,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": config.LLM_MAX_TOKENS,
        },
        headers=headers,
        timeout=config.LLM_TIMEOUT,
    )
    response.raise_for_status()
    choice = response.json()["choices"][0]
    message = choice["message"]
    content = (message.get("content") or message.get("reasoning") or "").strip()
    return content, choice.get("finish_reason")


def _strip_code_fence(s: str) -> str:
    """```json ... ``` 같은 코드펜스로 감싸 온 경우 제거."""
    s = s.strip()
    if s.startswith("```"):
        s = s.split("\n", 1)[1] if "\n" in s else s
        if s.endswith("```"):
            s = s[:-3]
    return s.strip()


# ============================ (1) LLM 정제 (rewrite) ============================
def _rewrite_prompt(user_input: str) -> str:
    return f"""You are an expert prompt engineer. Your job is to take a rough, ambiguous user message and rewrite it into a clear, structured prompt that accurately reflects the user's true intent.

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


def rewrite(user_input: str) -> dict[str, Any]:
    """(1단계) 거칠고 모호한 사용자 입력을 명료한 영어 프롬프트로 재작성한다.

    반환: {"translated_input", "rewritten_prompt", "finish_reason"}.
    JSON 파싱 실패 시 원문을 rewritten_prompt에 담는다(데모 스크립트와 동일한 폴백).
    """
    content, finish_reason = _chat(_rewrite_prompt(user_input))
    try:
        parsed = json.loads(_strip_code_fence(content))
        translated_input = parsed["translated_input"].strip()
        rewritten_prompt = parsed["rewritten_prompt"].strip()
    except (json.JSONDecodeError, KeyError, AttributeError):
        translated_input = ""
        rewritten_prompt = content
    return {
        "translated_input": translated_input,
        "rewritten_prompt": rewritten_prompt,
        "finish_reason": finish_reason,
    }


# ============================ (2) 벡터DB 검색 (search) ============================
def search(query: str, top_k: Optional[int] = None) -> list[dict[str, Any]]:
    """(2단계) 쿼리를 임베딩해 Chroma에서 코사인 유사도 상위 top_k 후보를 반환한다.

    각 후보: {"chroma_rank", "id", "chroma_distance", "metadata", "document"}.
    """
    _require(EMBED_BASE_URL=config.EMBED_BASE_URL, EMBED_MODEL=config.EMBED_MODEL)
    return search_chroma(
        query=query,
        chroma_dir=Path(config.CHROMA_DIR),
        collection_name=config.CHROMA_COLLECTION_NAME,
        embed_model=config.EMBED_MODEL,
        embed_base_url=config.EMBED_BASE_URL,
        embed_api_key=config.EMBED_API_KEY,
        top_k=top_k or config.CHROMA_TOP_K,
    )


# ============================ (3) 리랭킹 (rerank) ============================
def rerank(
    query: str,
    chroma_top_k: Optional[int] = None,
    top_n: Optional[int] = None,
) -> list[dict[str, Any]]:
    """(3단계) Chroma top-k 후보를 리랭커로 재점수화하고 상위 top_n을 반환한다.

    각 결과에는 search 후보 필드 + "rerank_score" 가 더해진다.
    """
    _require(RERANK_BASE_URL=config.RERANK_BASE_URL, RERANK_MODEL=config.RERANK_MODEL)
    candidates = search(query, top_k=chroma_top_k or config.CHROMA_TOP_K)
    ranked = rerank_candidates(
        query=query,
        candidates=candidates,
        rerank_base_url=config.RERANK_BASE_URL,
        rerank_api_key=config.RERANK_API_KEY,
        rerank_model=config.RERANK_MODEL,
        timeout=config.RERANK_TIMEOUT,
    )
    return ranked[: (top_n or config.RERANK_TOP_N)]


# ============================ (4) LLM 최종 프롬프트 생성 (generate) ============================
def _generate_prompt(user_request: str, templates: list[str]) -> str:
    blocks = "\n\n".join(f"### Template {i + 1}\n{tpl}" for i, tpl in enumerate(templates))
    return f"""You are an expert prompt engineer. Your task is to select the best matching
prompt template for the user's request and adapt it precisely to their needs.

## User's Original Request
{user_request}

## Candidate Prompt Templates (Top {len(templates)} Most Relevant)

{blocks}

## Instructions
1. Analyze the user's original request carefully, identifying:
   - Core task and goal
   - Key constraints and requirements explicitly stated
   - Implicit requirements not directly stated

2. Evaluate each template against the user's request:
   - Relevance: How well does it match the core task?
   - Completeness: Does it cover all key requirements?
   - Adaptability: How easily can it be adjusted to fit?

3. Select the single best-matching template and adapt it by:
   - Filling in or replacing placeholders with specifics from the user's request
   - Removing irrelevant sections
   - Adding any missing critical elements specific to this request
   - Keeping the structure and quality of the original template intact

## Output Format
First, reason through your template selection silently (do not print this reasoning).

Then output the result using EXACTLY this label on its own line, followed by the adapted prompt:

final adapted prompt:
<the fully adapted prompt in Korean>

Do not include anything after the adapted prompt."""


def generate(user_request: str, templates: list[str]) -> dict[str, Any]:
    """(4단계) 사용자 요청과 후보 템플릿들로 최종 적응 프롬프트를 생성한다.

    반환: {"adapted_prompt", "finish_reason"}.
    "final adapted prompt:" 레이블 뒤 텍스트만 추출하고, 레이블이 없으면 전문을 사용한다.
    """
    raw, finish_reason = _chat(_generate_prompt(user_request, templates))
    label = "final adapted prompt:"
    idx = raw.lower().find(label)
    adapted_prompt = raw[idx + len(label):].strip() if idx != -1 else raw
    return {"adapted_prompt": adapted_prompt, "finish_reason": finish_reason}


# ============================ 전체 파이프라인 (run_full) ============================
def run_full(
    user_input: str,
    chroma_top_k: Optional[int] = None,
    top_n: Optional[int] = None,
) -> dict[str, Any]:
    """1~4단계를 모두 이어 실행하고 최종 정제 프롬프트를 반환한다.

    검색 쿼리는 정제된 영어 프롬프트(rewritten_prompt)를 쓰고, 생성 단계의 사용자 요청은
    번역본(translated_input)을 쓴다 - 둘 다 비면 원문으로 폴백한다.
    응답의 "refined" 가 확장이 읽는 최종 결과이고, 나머지는 디버깅/투명성용 중간 산출물이다.
    """
    rw = rewrite(user_input)
    query = rw["rewritten_prompt"] or rw["translated_input"] or user_input

    ranked = rerank(query, chroma_top_k=chroma_top_k, top_n=top_n)
    templates = [item["document"] for item in ranked]

    gen = generate(rw["translated_input"] or user_input, templates)

    return {
        "refined": gen["adapted_prompt"],
        "translated_input": rw["translated_input"],
        "rewritten_prompt": rw["rewritten_prompt"],
        "templates": [
            {
                "id": item["id"],
                "title": (item.get("metadata") or {}).get("title"),
                "rerank_score": item.get("rerank_score"),
            }
            for item in ranked
        ],
    }
