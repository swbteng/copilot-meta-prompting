# program_AI — 모델 서빙 인프라 (vLLM)

메타 프롬프팅 파이프라인이 호출하는 **3종 모델**(LLM·임베딩·리랭커)을 **vLLM**으로 GPU 서빙하는 영역입니다.
모든 모델은 **OpenAI 호환 엔드포인트**로 노출되어, 백엔드(`program_backend`)가 주소/모델명만 알면 그대로
호출합니다(코드 하드코딩 없음).

```
program_backend (FastAPI)                  program_AI (vLLM, GPU)
   │  POST /v1/chat/completions   ───────▶  LLM       :4000  cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit
   │  POST /v1/embeddings         ───────▶  Embedding :4001  Qwen/Qwen3-Embedding-8B
   │  POST /v1/rerank             ───────▶  Reranker  :4002  Qwen/Qwen3-Reranker-4B
```

---

## 1. 모델 구성

| 역할 | 모델 | 포트 | 파이프라인 단계 | API |
|---|---|---|---|---|
| **LLM** (텍스트 생성) | `cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit` (MoE, AWQ 4-bit) | `4000` | (1) 정제 · (4) 최종 생성 | `/v1/chat/completions` |
| **임베딩** | `Qwen/Qwen3-Embedding-8B` (4096차원) | `4001` | (2) 벡터 검색 쿼리 임베딩 | `/v1/embeddings` |
| **리랭커** | `Qwen/Qwen3-Reranker-4B` | `4002` | (3) Top-20 후보 재점수화 | `/v1/rerank`, `/v1/score` |

> **임베딩 모델은 벡터 DB 구축에 사용한 모델과 반드시 동일**해야 합니다(`Qwen/Qwen3-Embedding-8B`).
> 모델이 다르면 임베딩 공간이 달라 검색 품질이 무너집니다.

---

## 2. 디렉터리 구조

```
program_AI/
├─ scripts/
│  ├─ serve_llm.sh         # LLM 서빙 (GPU 0, :4000) — AWQ MoE, reasoning-parser qwen3
│  ├─ serve_embedding.sh   # 임베딩 서빙 (GPU 1, :4001) — --runner pooling
│  ├─ serve_reranker.sh    # 리랭커 서빙 (:4002) — Qwen3ForSequenceClassification 오버라이드
│  └─ test_apis.py         # 3종 엔드포인트 스모크 테스트(requests)
├─ requirements.txt        # vllm==0.19.1, requests==2.34.2 (버전 고정)
└─ README.md               # (이 문서)
```

---

## 3. 설치

```bash
cd src/program_AI
python3 -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -r requirements.txt     # vllm==0.19.1, requests==2.34.2
```

- `vllm` 설치 시 호환되는 `torch`/`transformers`/`fastapi` 등이 함께 설치됩니다(참고 버전은
  `requirements.txt` 주석 참조).
- **GPU + CUDA 환경**이 필요합니다. 모델 가중치는 최초 실행 시 Hugging Face에서 자동 다운로드됩니다.

---

## 4. 실행 (서빙)

각 모델을 별도 터미널(또는 별도 GPU)에서 띄웁니다. 모든 스크립트는 `--host 0.0.0.0`으로 노출됩니다.

```bash
bash scripts/serve_llm.sh        # → http://0.0.0.0:4000
bash scripts/serve_embedding.sh  # → http://0.0.0.0:4001
bash scripts/serve_reranker.sh   # → http://0.0.0.0:4002
```

서빙 파라미터(요지):

| 스크립트 | 주요 옵션 |
|---|---|
| `serve_llm.sh` | `--max-model-len 32768`, `--gpu-memory-utilization 0.92`, `--reasoning-parser qwen3` (AWQ는 모델 설정에서 자동 감지) |
| `serve_embedding.sh` | `--runner pooling`, `--gpu-memory-utilization 0.65` |
| `serve_reranker.sh` | `--max-model-len 4096`, `--hf-overrides`로 causal LM을 시퀀스 분류 스코어러로 변환 |

> 캐시 경로(`VLLM_CACHE_ROOT`/`TRITON_CACHE_DIR`/`TORCH_HOME`)는 스크립트에서 `/workspace/.cache/*`로
> 지정합니다. GPU 인덱스(`CUDA_VISIBLE_DEVICES`)와 메모리 비율은 하드웨어에 맞게 조정하세요.

---

## 5. 기동 확인 (스모크 테스트)

```bash
.venv/bin/python scripts/test_apis.py
```

- 출력 예: `[LLM] <자기소개 한 문장>` / `[EMBED] dim=4096 head=[...]` / `[RERANK] 점수순: ...`
- 호스트/포트는 환경변수로 덮어쓸 수 있습니다: `HOST`, `LLM_PORT`, `EMBED_PORT`, `RERANK_PORT`.
- 검증 관점·요구사항 매핑은 [`../../tests/program_AI/README.md`](../../tests/program_AI/README.md) 참고.

---

## 6. RunPod 등 외부 추론으로 대체

GPU를 직접 운용하지 않을 경우, 동일한 OpenAI 호환 스펙을 제공하는 **RunPod**(또는 호환 서비스)에 모델을
올리고, 백엔드 `.env`의 `LLM_BASE_URL`/`EMBED_BASE_URL`/`RERANK_BASE_URL`과 `RUNPOD_API_KEY`만 그쪽
주소/키로 바꾸면 됩니다. 백엔드 코드는 수정할 필요가 없습니다(주소/모델명은 전부 `.env`로 주입).

> 관련: 요구사항 **R-IN-01**(vLLM 기반 고품질 프롬프트 생성 서빙), **R-IN-02**(모듈 간 네트워크 통신).
