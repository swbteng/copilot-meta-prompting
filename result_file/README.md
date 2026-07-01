# Copilot 메타 프롬프팅 (copilot-meta-prompting)

> **SW Bootcamp 13기 C반 4팀 결과파일**
> 사용자가 막 던진 거친 프롬프트를 **RAG 기반 메타 프롬프팅**으로 정제해, 하위(저비용) 모델에서도
> 고품질 답변을 끌어내는 VS Code Copilot 보조 서비스.

---

## 1. 프로젝트 개요

### 무엇을, 왜
LLM 코딩 어시스턴트(Copilot)의 답 품질은 **프롬프트의 질**에 크게 좌우됩니다. 그러나 사용자는 보통
짧고 모호하게 묻습니다(예: `"정렬 코드 짜줘"`). 이 프로젝트는 사용자와 타겟 LLM 사이에 **정제 계층**을
끼워 넣어, 모호한 입력을 **구조적이고 구체적인 고품질 프롬프트로 자동 재작성**합니다.

- **문제** — 거칠고 모호한 프롬프트 → 빗나간 답 → 다시 묻는 비효율. 고품질 답을 얻으려고 비싼 상위 모델에 의존.
- **해법(메타 프롬프팅 + RAG)** — 고품질 프롬프트 템플릿 **651건**을 벡터 DB로 색인해 두고, 사용자의 입력과
  의미적으로 가장 가까운 템플릿을 검색·리랭킹해 **새로운 고품질 프롬프트를 합성**합니다.
- **효과(토큰 비용 절감)** — 잘 정제된 프롬프트는 **하위(저비용) 모델에서도** 양질의 결과를 내므로, 상위
  모델 의존도와 토큰 비용을 낮춥니다.
- **사용자 통제권** — 정제본을 곧바로 보내지 않고 **미리보기 + 5가지 선택지(승인 게이트)**를 거칩니다.

핵심 설계 철학은 **"끼어들되 가로막지 않는다"**입니다. 정제는 `@refine`로 **명시 호출**했을 때만 일어나고,
서버 장애·예외 등 어떤 문제에서도 **원본을 그대로 흘려보내(fail-open)** Copilot 흐름을 막지 않습니다.

---

## 2. 시스템 구성 (3개 프로그램)

결과파일은 가이드에 따라 **프로그램별(`program_역할`)**로 소스/테스트/결과를 분리했습니다.

| 프로그램 | 역할 | 스택 | 위치 |
|---|---|---|---|
| **program_extension** | VS Code 확장(프런트엔드). Copilot Chat에 `@refine`를 추가해 정제 미리보기 + 승인 게이트 + 정제 내역 사이드바 제공. | 순수 JavaScript (VS Code Extension API, 의존성 0) | `src/program_extension/` |
| **program_backend** | 메타 프롬프팅 API 서버(오케스트레이터). `정제→검색→리랭킹→생성` 파이프라인 실행 + 벡터 DB(Chroma) 보유 + 시각화 웹 데모. | Python (FastAPI, ChromaDB) | `src/program_backend/` |
| **program_AI** | 모델 서빙 인프라. LLM·임베딩·리랭커 3종을 vLLM(OpenAI 호환)으로 GPU 서빙. | Python (vLLM) | `src/program_AI/` |

### 아키텍처 (요청 흐름)

```
┌───────────────────────────┐   @refine <원본 프롬프트>
│  VS Code Copilot Chat      │ ─────────────────────────────┐
│  program_extension (FE)    │                              │  POST /refine {"prompt": ...}
│   · @refine 가로채기        │ ◀── 정제본 미리보기 + 5버튼 ──┐│
│   · 승인 게이트 / 사이드바   │                            ││
└───────────────────────────┘                            ││
                                                          ▼│
                              ┌──────────────────────────────────────────────┐
                              │  program_backend (FastAPI)  POST /refine       │
                              │                                                │
                              │  (1) /rewrite  LLM 정제(원본→영어 구조화 프롬프트)│
                              │  (2) /search   Chroma 코사인 유사도 Top-20      │
                              │  (3) /rerank   리랭커 재점수화 → Top-3          │
                              │  (4) /generate LLM 최종 프롬프트 합성            │
                              └───────┬─────────────────────────┬──────────────┘
                                      │ OpenAI 호환 호출          │ 로컬 벡터 검색
                                      ▼                         ▼
                       ┌──────────────────────────┐   ┌────────────────────────┐
                       │  program_AI (vLLM 3종)    │   │  Chroma DB (번들)        │
                       │   · LLM (생성/정제)        │   │  651개 템플릿 임베딩       │
                       │   · Embedding (검색)       │   │  artifacts/production... │
                       │   · Reranker (재점수)      │   └────────────────────────┘
                       └──────────────────────────┘
```

> 응답의 `refined` 키가 확장이 읽는 최종 정제 프롬프트입니다. 확장은 이를 미리보기로 보여주고, 사용자가
> **전송(allow)**을 누르면 네이티브 Copilot에 그대로 제출합니다.

---

## 3. 처리 파이프라인 (4단계)

| 단계 | 엔드포인트 | 하는 일 | 사용 모델/자원 |
|---|---|---|---|
| (1) 정제 | `POST /rewrite` | 거칠고 모호한 입력을 의미 보존하며 **명료한 영어 구조화 프롬프트**로 재작성(+영어 번역). | LLM |
| (2) 검색 | `POST /search` | 정제 프롬프트를 임베딩해 Chroma에서 **코사인 유사도 Top-20** 템플릿 후보를 추출. | 임베딩 + Chroma |
| (3) 리랭킹 | `POST /rerank` | Top-20 후보를 리랭커로 **재점수화해 Top-3** 선별. | 리랭커 |
| (4) 생성 | `POST /generate` | Top-3 템플릿을 **참고만** 하여 사용자 의도에 맞는 **새 고품질 프롬프트(한국어)**를 합성. | LLM |
| 전체 | `POST /refine` | (1)~(4)를 한 번에 실행하고 최종 `refined`를 반환. | 위 전부 |

자세한 단계별 설명은 [`src/program_backend/README.md`](src/program_backend/README.md),
RAG·리랭킹 근거는 [`src/program_backend/docs/rag_reranking.md`](src/program_backend/docs/rag_reranking.md) 참고.

---

## 4. 기술 스택 · 모델

| 분류 | 내용 |
|---|---|
| 프런트엔드 | VS Code Extension API, Chat Participant API, Webview, **순수 JS(런타임 의존성 0)** |
| 백엔드 | Python 3, FastAPI, Uvicorn, **ChromaDB**(영속 벡터 DB), OpenAI 호환 클라이언트 |
| 모델 서빙 | **vLLM** (OpenAI 호환 `/v1/...` 엔드포인트), GPU |
| LLM (정제/생성) | `cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit` (MoE, AWQ 4-bit) |
| 임베딩 (검색) | `Qwen/Qwen3-Embedding-8B` (4096차원) |
| 리랭커 (재점수) | `Qwen/Qwen3-Reranker-4B` |
| 벡터 DB | Chroma, 컬렉션 `production_task_prompt_templates`, **651개 템플릿**, 코사인 거리 |
| 템플릿 출처 | GitHub `aj-geddes/useful-ai-prompts`(433건) + 선별 CSV 프롬프트(218건) |

---

## 5. 디렉터리 구조

```
result_file/                         # ← 결과파일.zip 루트
├─ README.md                         # (이 문서) 프로젝트 개요
├─ RUN.md                            # 전체 실행·재현 가이드(DevOps 8개 기준)
├─ package.json                      # 루트 매니페스트 + 테스트 스크립트
├─ requirements.txt                  # 라이브러리 목록(프로그램별 파일 안내)
├─ src/
│  ├─ program_extension/             # VS Code 확장 (FE) — 자체 README/RUN/AGENTS
│  │  ├─ src/ · media/ · package.json · build.sh · .env.example · docs/
│  ├─ program_backend/              # 메타 프롬프팅 API 서버 (Python)
│  │  ├─ app.py · pipeline.py · retrieval.py · config.py
│  │  ├─ static/                     # 파이프라인 시각화 웹 데모
│  │  ├─ indexing/                   # (오프라인) 템플릿 수집·DB 구축·시각화 레이아웃
│  │  ├─ data/                       # 템플릿 원천 데이터(md/csv)
│  │  ├─ artifacts/                  # 번들 Chroma DB + viz_layout.json
│  │  └─ docs/ · .env.example · requirements.txt · README.md · RUN.md
│  └─ program_AI/                    # vLLM 모델 서빙 (Python)
│     ├─ scripts/                    # serve_*.sh (LLM/임베딩/리랭커) + test_apis.py
│     └─ requirements.txt · README.md
├─ tests/
│  ├─ program_extension/             # 확장 자동 테스트(Node, 25개) + _helpers
│  ├─ program_backend/               # 검증 방식 안내(README)
│  └─ program_AI/                    # 검증 방식 안내(README)
└─ test-results/
   ├─ program_extension/             # junit.xml + summary.txt (25 pass)
   ├─ program_backend/               # 결과 안내(README)
   └─ program_AI/                    # 결과 안내(README)
```

> **프로그램이 3개**이므로 가이드대로 `src/`·`tests/`·`test-results/` 아래를 `program_역할`로 나눴습니다.

---

## 6. 빠른 시작

전체 재현(모델 서빙 → 백엔드 → 확장)은 **[RUN.md](RUN.md)** 에 DevOps 8개 기준에 맞춰 정리돼 있습니다.
프로그램별 상세는 각 폴더의 문서를 보세요.

| 프로그램 | 개요 | 실행 |
|---|---|---|
| 확장 | [`src/program_extension/README.md`](src/program_extension/README.md) | [`RUN.md`](src/program_extension/RUN.md) |
| 백엔드 | [`src/program_backend/README.md`](src/program_backend/README.md) | [`RUN.md`](src/program_backend/RUN.md) |
| 모델 서빙 | [`src/program_AI/README.md`](src/program_AI/README.md) | (README 내 실행 절 참고) |

가장 빠른 체험은 **확장만** 띄우는 것입니다 — VS Code로 `src/program_extension/`를 열고 `F5` →
`@refine 1+1이 뭐야?`. 정제 서버에 붙지 않아도 fail-open으로 동작합니다(원본 그대로 전송).

---

## 7. 테스트

| 프로그램 | 검증 방식 | 결과 |
|---|---|---|
| program_extension | **Node 자동 테스트 25개**(요구사항 `R-15`~`R-24` 매핑). 외부 의존성 0. | **25/25 통과** — [`test-results/program_extension/`](test-results/program_extension/) |
| program_backend | 스모크 테스트(`/health`·`/refine` curl). 실모델 서버 필요. | [`tests/program_backend/README.md`](tests/program_backend/README.md) |
| program_AI | 스모크 테스트(`scripts/test_apis.py`). GPU·서빙 모델 필요. | [`tests/program_AI/README.md`](tests/program_AI/README.md) |

확장 테스트 재실행:
```bash
npm run test:extension          # 콘솔(spec)
npm run test:extension:junit    # JUnit XML + 요약 재생성
```

---

## 8. 협업 (Git)

- **Git 저장소**: `swbteng/copilot-meta-prompting` — 기능별 브랜치(`rag`/`extension`/`endpoint`/`web`/`report`)와
  **Pull Request 머지**(#5~#15)로 협업했습니다.
- **기여**: 팀원 전원이 본인 계정으로 커밋(임베딩/리랭킹·백엔드·확장·인프라·문서 영역 분담).
- 협업 분석을 위해 **`.git` 히스토리를 결과파일에 포함**하세요(가이드 7번). `.git` 동봉이 어려우면
  `git log` export(`git_log.txt`)를 함께 넣습니다.

---

## 9. 핵심 설계 원칙

- **fail-open** — 정제/통신/로깅의 어떤 실패에서도 throw하지 않고 **원본을 흘려보내** Copilot 흐름을 보존.
- **명시 호출만** — `@refine`로 부른 현재 요청만 정제. 그 외 트래픽은 무수정.
- **승인 게이트** — 정제본은 사용자가 눈으로 보고 고른 뒤에만 전송(자동 치환 강요 없음).
- **설정 외부화** — 모델/엔드포인트 주소·키는 코드 하드코딩 없이 `.env`로만 주입.
- **자족 백엔드** — API·파이프라인·검색/리랭킹·벡터 DB가 한 폴더에 번들되어 그대로 서빙 가능.
