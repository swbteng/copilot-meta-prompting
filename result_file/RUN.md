# 실행 · 재현 가이드 (RUN)

이 문서는 **제출물만으로 서비스를 다시 띄울 수 있는가**를 기준(DevOps 8개)에 맞춰 정리합니다.
프로젝트는 **3개 프로그램**(모델 서빙 → 백엔드 → 확장)으로 구성되며, 아래 순서대로 기동합니다.

> 프로그램별 상세 실행은 각 폴더의 문서를 함께 보세요 —
> [`src/program_AI/README.md`](src/program_AI/README.md) ·
> [`src/program_backend/RUN.md`](src/program_backend/RUN.md) ·
> [`src/program_extension/RUN.md`](src/program_extension/RUN.md).

---

## 0. 한눈에 (의존 순서)

```
[GPU 머신] program_AI : vLLM 3종(LLM·임베딩·리랭커) 서빙
                │  (OpenAI 호환 /v1 엔드포인트)
                ▼
[서버]    program_backend : FastAPI(/refine) — .env에 위 3종 주소를 넣고 기동
                │  (POST /refine)
                ▼
[로컬]    program_extension : VS Code 확장 — REFINE_API_URL을 백엔드로 지정
```

- **최소 체험**(모델·GPU 없이): 확장만 `F5`로 띄우면 됩니다(정제 서버 없으면 fail-open으로 원본 전송).
- **전체 파이프라인 체험**: 3종 모델 서버(직접 GPU 또는 RunPod) + 백엔드가 떠 있어야 실제 정제본이 나옵니다.

---

## 1~2. 라이브러리 목록 · 버전 고정

라이브러리는 **프로그램별로 분리**되어 있으며, 버전을 고정(pin)했습니다.

| 프로그램 | 라이브러리 목록 파일 | 핵심 의존성(버전 고정) |
|---|---|---|
| program_AI | [`src/program_AI/requirements.txt`](src/program_AI/requirements.txt) | `vllm==0.19.1`, `requests==2.34.2` |
| program_backend | [`src/program_backend/requirements.txt`](src/program_backend/requirements.txt) | `fastapi==0.138.1`, `uvicorn[standard]==0.49.0`, `chromadb==1.5.9`, `openai==2.44.0`, `requests==2.34.2`, `tqdm==4.68.3`, `scikit-learn==1.9.0` |
| program_extension | [`src/program_extension/requirements.txt`](src/program_extension/requirements.txt) | **런타임 의존성 0** (순수 JS, Node 내장 모듈만). 패키징 도구 `@vscode/vsce`는 `npx`로 on-demand. |

> 루트 [`requirements.txt`](requirements.txt)는 위 분리 구조를 안내하는 인덱스입니다. 두 Python 프로그램은
> **서로 다른 환경(venv/머신)**에 설치합니다(백엔드 vs vLLM 스택은 함께 설치하지 않음).

---

## 3~4. 빌드·설치 / 실행·기동

### A) program_AI — 모델 서빙 (GPU 필요)

> GPU가 없거나 RunPod 등 외부 추론 엔드포인트를 쓸 경우 이 절은 건너뛰고, **6번 외부 자원**의 RunPod
> 주소를 백엔드 `.env`에 넣으면 됩니다.

```bash
cd src/program_AI
python3 -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -r requirements.txt        # vllm==0.19.1, requests==2.34.2

# 모델 3종 서빙(각각 별도 터미널 / GPU). OpenAI 호환 엔드포인트로 노출된다.
bash scripts/serve_llm.sh        # LLM       → :4000  (cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit)
bash scripts/serve_embedding.sh  # 임베딩     → :4001  (Qwen/Qwen3-Embedding-8B)
bash scripts/serve_reranker.sh   # 리랭커     → :4002  (Qwen/Qwen3-Reranker-4B)

# 기동 확인(스모크 테스트)
.venv/bin/python scripts/test_apis.py            # 3개 엔드포인트 응답 출력
```

### B) program_backend — 메타 프롬프팅 API 서버

```bash
cd src/program_backend
python3 -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -r requirements.txt        # fastapi/uvicorn/chromadb/openai/...

cp .env.example .env                             # 5번 참고해 모델 주소/모델명 입력
.venv/bin/uvicorn app:app --host 0.0.0.0 --port 80
#  → http://<host>:80/         파이프라인 시각화 웹 데모
#  → http://<host>:80/docs     Swagger UI(자동 문서)
```

- 벡터 DB(Chroma)는 `artifacts/`에 **번들**돼 있어 별도 구축 없이 그대로 검색됩니다(651개 템플릿).
- 시각화 지도(`artifacts/viz_layout.json`)도 커밋돼 있어 바로 보입니다(DB 재빌드 시에만 재생성).

### C) program_extension — VS Code 확장

```bash
# (개발 실행) VS Code로 src/program_extension/ 폴더를 열고 F5 → Extension Development Host
#   → 우측 Copilot Chat에서:  @refine 헝가리의 수도가 어디야?

# (패키징/설치) git bash + Node
cd src/program_extension
./build.sh --install     # .env의 REFINE_API_URL을 vsix에 구워 넣고 설치
```

- 확장은 **의존성 0**이라 `npm install` 없이 바로 뜹니다. 코드 변경은 `Ctrl+R`로 즉시 반영.
- 확장이 백엔드를 호출하도록 `REFINE_API_URL`을 백엔드 `/refine` 주소로 지정합니다(5번 참고).

---

## 5. 환경 변수 · 설정 파일

설정값은 코드에 하드코딩하지 않고 `.env`(또는 프로세스 환경변수)로만 주입합니다. 템플릿은 각 프로그램의
`.env.example`을 복사해 채웁니다(실제 `.env`는 커밋 금지 — `.gitignore`).

### program_backend (`src/program_backend/.env.example` → `.env`)

| 키 | 설명 | 예시 |
|---|---|---|
| `LLM_BASE_URL` / `LLM_MODEL` | 정제·생성 LLM(OpenAI 호환) 주소/모델명 | `http://127.0.0.1:4000` / `cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit` |
| `EMBED_BASE_URL` / `EMBED_MODEL` | 임베딩 주소(끝 `/v1` 자동보정)/모델명 | `http://127.0.0.1:4001/v1` / `Qwen/Qwen3-Embedding-8B` |
| `RERANK_BASE_URL` / `RERANK_MODEL` | 리랭커 주소/모델명 | `http://127.0.0.1:4002` / `Qwen/Qwen3-Reranker-4B` |
| `*_API_KEY` / `RUNPOD_API_KEY` | 인증이 필요한 엔드포인트(RunPod 등)에만. 로컬 vLLM은 비움. | — |
| `CHROMA_DIR` / `CHROMA_COLLECTION_NAME` | 비우면 번들 DB 경로/이름으로 폴백 | (비움) |
| `CHROMA_TOP_K` / `RERANK_TOP_N` | 검색 후보 수 / 최종 템플릿 수 | `20` / `3` |
| `LLM_TIMEOUT` / `LLM_MAX_TOKENS` / `RERANK_TIMEOUT` | 운영 파라미터(비우면 기본값) | `180` / `8192` / `120` |

> 임베딩 모델은 DB 구축에 쓴 `Qwen/Qwen3-Embedding-8B`와 **반드시 동일**해야 벡터가 호환됩니다.
> 연결값이 비면 해당 요청이 `설정값이 비어 있습니다: ...` 에러로 무엇을 채울지 알려줍니다.

### program_extension (`src/program_extension/.env.example` → `.env`)

| 키 | 설명 |
|---|---|
| `REFINE_API_URL` | 정제 서버(백엔드 `/refine`) 주소. 우선순위: OS 환경변수 > `.env` 굽기 > 코드 내장 기본값. |

VS Code 설정: `swbcPromptRefiner.logDir`(정제 내역 로그 폴더 절대경로, 비우면 `globalStorage/logs`),
`swbcPromptRefiner.maxEntries`(사이드바 표시 상한, 기본 200).

---

## 6. 외부 서비스 · 자원

| 자원 | 용도 | 안내 |
|---|---|---|
| **GPU** | vLLM로 LLM/임베딩/리랭커 서빙 | 서빙 모델 크기에 맞는 VRAM 필요(예: A40 등). 스크립트에 `gpu-memory-utilization` 지정. |
| **모델 가중치** | Hugging Face에서 자동 다운로드 | LLM `cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit`, 임베딩 `Qwen/Qwen3-Embedding-8B`, 리랭커 `Qwen/Qwen3-Reranker-4B` |
| **RunPod**(선택) | GPU 없이 추론 엔드포인트로 대체 | 각 `*_BASE_URL`을 RunPod URL로, `RUNPOD_API_KEY` 설정. Pod **고정 프록시 도메인** `https://{POD_ID}-{PORT}.proxy.runpod.net` 사용(IP 변동 회피). 상세: [`src/program_backend/RUN.md`](src/program_backend/RUN.md) §4. |
| **Chroma DB** | 템플릿 벡터 검색 | **번들 제공**(`artifacts/production_chroma_qwen3_8b`) — 외부 DB 불필요. |
| **API 키** | LLM 키 등 | 코드에 없음. `.env`로만 주입(커밋 금지). |

> 주의(RunPod 프록시 100초 제한): `/refine` 전체 파이프라인은 LLM을 2번 호출하므로 길어질 수 있습니다.
> 단계 분리 호출(`/rewrite`→`/rerank`→`/generate`)이나 TCP 포트/Serverless로 회피합니다(백엔드 RUN.md 참고).

---

## 7~8. 설치 성공 / 기동 확인 (스모크 테스트)

### program_AI
```bash
.venv/bin/python scripts/test_apis.py
# [LLM] ... / [EMBED] dim=4096 ... / [RERANK] 점수순: ...  → 3종 모두 응답하면 정상
```

### program_backend
```bash
curl -s http://127.0.0.1:80/health
# {"status":"ok"}

curl -s -X POST http://127.0.0.1:80/refine \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"AI 관련 자유 주제로 5분 발표 PPT 슬라이드 내용을 구성해줘"}'
# {"refined":"<최종 정제 프롬프트>", "translated_input":..., "rewritten_prompt":..., "templates":[...]}
```
> 모델 서버(vLLM/RunPod)가 떠 있어야 실제 응답이 나옵니다. 안 떠 있으면 타임아웃 또는
> "설정값이 비어 있습니다" 에러로 어디가 비었는지 알려줍니다.

### program_extension (자동 테스트)
```bash
export PATH="$PATH:/c/Program Files/nodejs"   # 새 셸이면 1회
# 결과파일 루트(result_file/)에서
npm run test:extension          # 콘솔(spec) — 25개
npm run test:extension:junit    # JUnit XML + 요약을 test-results/program_extension/에 재생성
```
- 권장 Node ≥ 20.13(내장 JUnit 리포터). 검증 환경: Node v24.
- 최신 스냅샷: **25개 전부 통과**([`test-results/program_extension/summary.txt`](test-results/program_extension/summary.txt)).

---

## 부록. 벡터 DB 재구축(선택, 오프라인)

번들 DB로 충분하지만, 템플릿을 새로 색인하려면(임베딩 서버 필요):

```bash
cd src/program_backend
.venv/bin/python indexing/collect_production_templates.py   # 템플릿 수집 → artifacts/...templates
.venv/bin/python indexing/build_vector_db.py                # 임베딩 → Chroma 적재(EMBED_BASE_URL 필요)
.venv/bin/python indexing/build_viz_layout.py               # 2D 시각화 레이아웃(t-SNE+KMeans, 임베딩 불필요)
```
