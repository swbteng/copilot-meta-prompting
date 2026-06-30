# program_backend 실행 / 배포 가이드

## 1. 설치

```bash
cd result_file/src/program_backend
python3 -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -r requirements.txt
```

## 2. 설정

```bash
cp .env.example .env
```

로컬 vLLM 기본 예시:

```text
LLM_BASE_URL=http://127.0.0.1:4000
LLM_MODEL=cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit
EMBED_BASE_URL=http://127.0.0.1:4001/v1
EMBED_MODEL=Qwen/Qwen3-Embedding-8B
RERANK_BASE_URL=http://127.0.0.1:4002
RERANK_MODEL=Qwen/Qwen3-Reranker-4B
```

RunPod 또는 다른 외부 OpenAI 호환 엔드포인트를 사용하는 경우 각 `*_BASE_URL`, `*_MODEL`, API 키 값을 해당 서비스 값으로 변경한다.

## 3. 실행

```bash
.venv/bin/uvicorn app:app --host 0.0.0.0 --port 8000
```

- 웹 데모: `http://127.0.0.1:8000/`
- API 문서: `http://127.0.0.1:8000/docs`
- 상태 확인: `http://127.0.0.1:8000/health`

## 4. 스모크 테스트

```bash
curl -s http://127.0.0.1:8000/health
curl -s -X POST http://127.0.0.1:8000/refine \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"AI 관련 자유 주제로 5분 발표 PPT 슬라이드 내용을 구성해줘"}'
```

모델 서버가 떠 있지 않거나 `.env` 필수 값이 비어 있으면 `/refine`은 HTTP 500과 함께 어떤 설정값이 부족한지 detail로 반환한다.

## 5. DevOps 기준 체크

| 기준 | program_backend 대응 |
|---|---|
| 라이브러리 목록 | `requirements.txt` |
| 버전 고정 | 모든 직접 의존성 버전 고정 |
| 설치 방법 | `python3 -m venv`, `pip install -r requirements.txt` |
| 실행 방법 | `uvicorn app:app --host 0.0.0.0 --port 8000` |
| 환경 변수 | `.env.example`, `config.py` |
| 외부 자원 | LLM/Embedding/Reranker OpenAI 호환 서버, Chroma DB |
| 설치 검증 | 패키지 설치 후 `uvicorn` 실행 |
| 기동 검증 | `/health`, `/docs`, `/refine` 호출 |
