import os
import json
import requests
from pathlib import Path

HOST = os.environ.get("HOST", "127.0.0.1")
LLM = f"http://{HOST}:{os.environ.get('LLM_PORT', '4000')}"

# outputs/rewritten_prompts.jsonl 에서 마지막 레코드의 translated_input 로드
_jsonl_path = Path(__file__).parent / "outputs" / "rewritten_prompts.jsonl"
_last_line = _jsonl_path.read_text(encoding="utf-8").strip().splitlines()[-1]
user_original_request = json.loads(_last_line)["translated_input"]

template_1 = """Act as an Academic PowerPoint Presentation Designer. You are an expert in curriculum design and have extensive experience in crafting professional academic presentations.

Your task is to:
- Develop a comprehensive presentation on a specific topic using the provided content.
- Include clear learning objectives at the beginning of the presentation to enhance understanding and engagement.
- Organize content into structured units that facilitate easy following and comprehension.
- Ensure the presentation comprises 30 to 40 slides, balancing detailed explanation with conciseness.
- Design slides with a professional and uniform style focusing on clarity of text and ease of reading.
- Use appropriate visual elements such as tables, charts, and icons to illustrate information and enhance understanding.
- Maintain a balance between text and visuals to prevent cluttering slides.

Rules:
- Tailor the content to suit undergraduate and graduate university students and faculty members while maintaining a formal and educational tone.
- Add speaker notes to each slide to aid explanation during the presentation.
- Ensure the presentation is easily editable and customizable for future use."""

template_2 = """# IDENTITY AND PURPOSE

You are an expert presentation designer and technical communicator.
Your goal is to transform input content into an engaging, well-structured
Reveal.js HTML slideshow.

# STEPS

1. Analyze the input and identify the core message, key supporting points,
   and any data or examples worth visualizing.
2. Design a slide structure with a clear narrative arc:
   - Opening slide that frames the topic
   - Content slides (one idea per slide)
   - Closing slide with key takeaway or call to action
3. For each slide, determine the best visual representation:
   - Use inline SVG illustrations instead of placeholder images
   - Use minimal text (headlines + 3-5 bullet points max)
   - Include speaker notes with elaboration for the presenter
4. Generate a complete, self-contained Reveal.js HTML file.

# OUTPUT INSTRUCTIONS

- Output a single complete HTML file using Reveal.js from cdnjs
- Each slide should have minimal text and strong visual support via inline SVG
- Use a clean, modern dark theme
- Include speaker notes in <aside class="notes"> tags
- Do not include external image dependencies
- Ensure the slideshow is immediately presentable without modification"""

template_3 = """# IDENTITY AND PURPOSE

You are an expert in creating TED-style keynote presentations.
Your goal is to craft a compelling narrative-driven presentation
with a clear structure, impactful slides, and cohesive flow.

# STEPS

1. Identify the single core idea the presentation must convey.
2. Build a narrative arc:
   - Hook: an opening that grabs attention (story, question, or bold claim)
   - Problem / Tension: why this idea matters
   - Resolution: the key insight or solution
   - Call to Action: what the audience should think or do differently
3. Design slides that support the narrative, not replace it:
   - One concept per slide
   - Headlines as complete sentences where possible
   - Speaker notes for each slide with full talking points
4. Identify the top 3 takeaways the audience must leave with.

# OUTPUT INSTRUCTIONS

- Output the presentation as structured Markdown
- Include: Slide Title | Visual Suggestion | Speaker Notes | Talking Time
- Keep slide text minimal (≤ 10 words per slide where possible)
- Speaker notes should be written as full spoken sentences
- End with a TAKEAWAYS section listing the 3 core messages
- Do not output raw HTML unless explicitly asked"""

system_prompt = f"""You are an expert prompt engineer. Your task is to select the best matching 
prompt template for the user's request and adapt it precisely to their needs.

## User's Original Request
{user_original_request}

## Candidate Prompt Templates (Top 3 Most Relevant)

### Template 1
{template_1}

### Template 2
{template_2}

### Template 3
{template_3}

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

MODEL = "cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit"

l = requests.post(f"{LLM}/v1/chat/completions",
json={"model": MODEL,
"messages": [{"role": "user", "content": system_prompt}],
"max_tokens": 8192}, timeout=180)

print("llm:", l.status_code)
l.raise_for_status()

raw = (l.json()["choices"][0]["message"].get("content") or "").strip()
finish_reason = l.json()["choices"][0].get("finish_reason")

# "final adapted prompt:" 레이블 이후 텍스트만 추출
LABEL = "final adapted prompt:"
label_idx = raw.lower().find(LABEL)
if label_idx != -1:
    adapted_prompt = raw[label_idx + len(LABEL):].strip()
else:
    adapted_prompt = raw  # 레이블 없으면 전문 사용

print("adapted_prompt:\n", adapted_prompt)

# --- 저장 ---
import uuid
from datetime import datetime, timezone

record = {
    "id": str(uuid.uuid4()),
    "created_at": datetime.now(timezone.utc).isoformat(),
    "model": MODEL,
    "user_original_request": user_original_request,
    "adapted_prompt": adapted_prompt,
    "finish_reason": finish_reason,
}

out_dir = Path(__file__).parent / "outputs"
out_dir.mkdir(exist_ok=True)

jsonl_path = out_dir / "picked_prompts.jsonl"
with jsonl_path.open("a", encoding="utf-8") as f:
    f.write(json.dumps(record, ensure_ascii=False) + "\n")

txt_path = out_dir / f"picked_{record['id']}.txt"
txt_path.write_text(
    f"[user_original_request]\n{user_original_request}\n\n"
    f"[adapted_prompt]\n{adapted_prompt}\n",
    encoding="utf-8",
)

print(f"saved -> {jsonl_path} (id={record['id']})")
print(f"saved -> {txt_path}")