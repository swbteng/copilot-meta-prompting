# 실행·재현 문서

이 문서는 결과파일 기준으로 Copilot Meta-Prompting 서비스를 재현하는 절차를 설명한다. 전체 서비스는 모델 서빙(`program_AI`), API 서버(`program_backend`), VS Code 확장(`program_extension`)으로 구성된다.

## 1. 의존성 목록과 버전 고정

Python 의존성은 다음 파일에 고정되어 있다.

- `requirements.txt`: 결과파일 전체 의존성 참조
- `src/program_backend/requirements.txt`: FastAPI, Chroma, OpenAI client 등 백엔드 의존성
- `src/program_AI/requirements.txt`: vLLM, requests 등 모델 서빙 의존성
- `src/program_extension/requirements.txt`: 레거시 mitmproxy 프록시 실행용 의존성

Node/VS Code 확장 패키징 의존성은 다음 파일에 고정되어 있다.

- `package.json`
- `src/program_extension/package.json`

## 2. 모델 서버 실행

GPU 서버에서 vLLM 가상환경을 준비한다.

```bash
cd result_file/src/program_AI
python3 -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -r requirements.txt
```

세 모델 서버를 각각 실행한다.

```bash
./scripts/serve_llm.sh        # 0.0.0.0:4000, cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit
./scripts/serve_embedding.sh  # 0.0.0.0:4001, Qwen/Qwen3-Embedding-8B
./scripts/serve_reranker.sh   # 0.0.0.0:4002, Qwen/Qwen3-Reranker-4B
```

스모크 테스트:

```bash
.venv/bin/python scripts/test_apis.py
```

## 3. 백엔드 API 서버 실행

```bash
cd result_file/src/program_backend
python3 -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -r requirements.txt
cp .env.example .env
```

`.env`에 모델 서버 정보를 입력한다.

```text
LLM_BASE_URL=http://127.0.0.1:4000
LLM_MODEL=cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit
EMBED_BASE_URL=http://127.0.0.1:4001/v1
EMBED_MODEL=Qwen/Qwen3-Embedding-8B
RERANK_BASE_URL=http://127.0.0.1:4002
RERANK_MODEL=Qwen/Qwen3-Reranker-4B
```

RunPod 등 외부 엔드포인트를 사용하는 경우 각 `*_BASE_URL`과 `RUNPOD_API_KEY` 또는 개별 API 키를 채운다.

서버 실행:

```bash
.venv/bin/uvicorn app:app --host 0.0.0.0 --port 8000
```

확인:

```bash
curl -s http://127.0.0.1:8000/health
curl -s -X POST http://127.0.0.1:8000/refine \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"AI 관련 자유 주제로 5분 발표 PPT 슬라이드 내용을 구성해줘"}'
```

웹 데모는 `http://127.0.0.1:8000/`에서 확인한다. Swagger 문서는 `http://127.0.0.1:8000/docs`에서 확인한다.

## 4. VS Code 확장 실행

개발 실행:

```bash
cd result_file/src/program_extension
```

VS Code에서 이 폴더를 열고 `F5`를 누르면 Extension Development Host가 실행된다. 새 창의 Copilot Chat에서 다음처럼 사용한다.

```text
@refine 1+1이 뭐야?
```

패키징:

```bash
./build.sh
./build.sh --install
```

현재 활성 확장 정제 경로는 `src/refiner.js`의 고정 문자열 미리보기 모드이다. 백엔드 API와 직접 연동하려면 `REFINE_API_URL`을 실제 `/refine` URL로 지정하고 `src/refiner.js`의 서버 호출 블록을 활성화한다.

## 5. 환경 변수와 외부 자원

| 구분 | 필요 값 | 설명 |
|---|---|---|
| LLM | `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY` 또는 `RUNPOD_API_KEY` | `/v1/chat/completions` 호환 텍스트 생성 |
| 임베딩 | `EMBED_BASE_URL`, `EMBED_MODEL`, `EMBED_API_KEY` 또는 `RUNPOD_API_KEY` | Chroma 검색용 쿼리 임베딩 |
| 리랭커 | `RERANK_BASE_URL`, `RERANK_MODEL`, `RERANK_API_KEY` 또는 `RUNPOD_API_KEY` | `/v1/rerank` 호환 후보 재점수화 |
| Chroma | `CHROMA_DIR`, `CHROMA_COLLECTION_NAME` | 비우면 제출물에 포함된 production DB 경로 사용 |
| 확장 | `swbcPromptRefiner.logDir`, `swbcPromptRefiner.maxEntries` | 정제 내역 저장 위치와 표시 개수 |

실제 `.env`와 API 키는 제출물에 포함하지 않는다. 예시는 `src/program_backend/.env.example`에 문서화되어 있다.

## 6. DevOps 8개 기준 대응

| 기준 | 대응 |
|---|---|
| 라이브러리 목록 | `requirements.txt`, 각 프로그램별 `requirements.txt`, `package.json` |
| 버전 고정 | Python/Node 의존성 버전 명시 |
| 빌드·설치 방법 | 본 문서 2~4장과 각 프로그램 README |
| 실행·기동 방법 | vLLM 스크립트, `uvicorn`, VS Code F5/VSIX 패키징 명시 |
| 환경 변수·설정 파일 | `src/program_backend/.env.example`, 확장 설정 키 문서화 |
| 외부 서비스·자원 | vLLM/RunPod, API 키, Chroma DB 안내 |
| 설치 성공성 | 명령 순서대로 가상환경 설치 후 실행 가능하도록 경로 기준 작성 |
| 애플리케이션 기동 | `/health`, `/refine`, `/`, `@refine` 검증 절차 제공 |
