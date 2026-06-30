# program_AI - vLLM 모델 서빙

`program_AI`는 메타 프롬프팅 백엔드가 호출하는 세 가지 OpenAI 호환 모델 서버를 실행하기 위한 스크립트 묶음이다.

| 스크립트 | 포트 | 모델 | 역할 |
|---|---:|---|---|
| `scripts/serve_llm.sh` | 4000 | `cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit` | 프롬프트 재작성 및 최종 생성 |
| `scripts/serve_embedding.sh` | 4001 | `Qwen/Qwen3-Embedding-8B` | Chroma 검색용 쿼리 임베딩 |
| `scripts/serve_reranker.sh` | 4002 | `Qwen/Qwen3-Reranker-4B` | 검색 후보 재점수화 |

## 설치

```bash
cd result_file/src/program_AI
python3 -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -r requirements.txt
```

`requirements.txt`에는 `vllm==0.19.1`, `requests==2.34.2`가 고정되어 있다. 모델 다운로드가 필요한 경우 Hugging Face 접근 권한과 충분한 GPU 메모리가 필요하다.

## 실행

각 스크립트는 `CUDA_VISIBLE_DEVICES`를 지정하고 vLLM 서버를 실행한다. GPU 배치가 다른 환경에서는 스크립트의 GPU 번호를 환경에 맞게 조정한다.

```bash
./scripts/serve_llm.sh
./scripts/serve_embedding.sh
./scripts/serve_reranker.sh
```

## 검증

```bash
.venv/bin/python scripts/test_apis.py
```

기본 호스트는 `127.0.0.1`이며, `HOST`, `LLM_PORT`, `EMBED_PORT`, `RERANK_PORT` 환경변수로 변경할 수 있다. 성공 시 LLM 응답 텍스트, 임베딩 차원, 리랭커 점수순 결과가 출력된다.
