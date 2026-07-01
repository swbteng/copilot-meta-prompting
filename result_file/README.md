# Copilot Meta-Prompting 결과파일 README


## 프로젝트 개요
### 배경
LLM 코딩 어시스턴트(Copilot)의 답 품질은 프롬프트의 질에 크게 좌우됩니다. 그러나 사용자는 보통 짧고 모호하게 묻습니다(예: "정렬 코드 짜줘"). 이 프로젝트는 사용자와 타겟 LLM 사이에 정제 계층을 끼워 넣어, 모호한 입력을 구조적이고 구체적인 고품질 프롬프트로 자동 재작성합니다.

- **문제** : 거칠고 모호한 프롬프트 → 빗나간 답 → 다시 묻는 비효율. 고품질 답을 얻으려고 비싼 상위 모델에 의존.
- **해법**(메타 프롬프팅 + RAG) : 고품질 프롬프트 템플릿을  벡터 DB로 색인해 두고, 사용자의 입력과 의미적으로 가장 가까운 템플릿을 검색·리랭킹해 새로운 고품질 프롬프트를 합성합니다.
- **효과**(토큰 비용 절감) : 잘 정제된 프롬프트는 하위(저비용) 모델에서도 양질의 결과를 내므로, 상위 모델 의존도와 토큰 비용을 낮춥니다.
- **사용자 통제권** : 정제본을 곧바로 보내지 않고 미리보기 + 5가지 선택지(승인 게이트)를 거칩니다.


Copilot Meta-Prompting은 사용자가 작성한 짧거나 모호한 프롬프트를 더 구조화된 프롬프트로 정제하기 위한 서비스이다. 결과파일은 세 프로그램으로 구성된다.

| 프로그램 | 경로 | 역할 |
|---|---|---|
| AI 모델 서빙 | `src/program_AI` | vLLM 기반 LLM, 임베딩, 리랭커 모델 서빙 스크립트 |
| 백엔드/API | `src/program_backend` | FastAPI API, RAG 검색, 리랭킹, 웹 데모 |
| VS Code 확장 | `src/program_extension` | Copilot Chat `@refine` Chat Participant와 정제 내역 사이드바 |

## 목적

사용자가 Copilot Chat 또는 웹 데모에서 입력한 원본 프롬프트를 다음 흐름으로 정제하는 것이 목적이다.

1. 원본 프롬프트를 영어 번역 및 검색용 프롬프트로 재작성한다.
2. 벡터 DB에서 관련 프롬프트 템플릿 후보를 검색한다.
3. 리랭커로 후보를 재점수화해 상위 템플릿을 선별한다.
4. 선택된 템플릿과 사용자 의도를 합성해 최종 한국어 프롬프트를 생성한다.

## 문제 정의

일반 사용자의 프롬프트는 목적, 맥락, 제약 조건이 충분히 드러나지 않아 LLM 응답 품질이 불안정할 수 있다. 이 프로젝트는 다음 문제를 해결하기 위한 구조를 구현한다.

- 모호한 사용자 요청을 검색 가능한 프롬프트로 재작성한다.
- Chroma 벡터 DB에서 유사한 고품질 프롬프트 템플릿을 찾는다.
- 리랭커로 검색 후보를 재정렬해 최종 생성에 사용할 템플릿을 줄인다.
- 웹 데모와 VS Code 확장으로 정제 흐름을 확인하고 Copilot Chat 사용 흐름에 연결한다.

## 주요 기능

### `program_backend`

- `GET /health`: 서버 상태 확인
- `GET /`: 4단계 파이프라인을 보여주는 웹 데모
- `POST /rewrite`: LLM으로 원본 프롬프트를 영어 번역 및 검색용 프롬프트로 재작성
- `POST /search`: 임베딩 모델과 Chroma DB를 이용한 top-k 템플릿 검색
- `POST /rerank`: 검색 후보를 리랭커 API로 재점수화하고 top-n 반환
- `POST /generate`: 번역본, 정제 프롬프트, 선택 템플릿을 이용해 최종 한국어 프롬프트 생성
- `POST /refine`: `rewrite -> search -> rerank -> generate` 전체 파이프라인 실행 후 `refined` 반환
- CORS 허용 설정으로 확장 또는 외부 클라이언트 호출 가능

### `program_AI`

- `scripts/serve_llm.sh`: `cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit` 모델을 4000 포트로 서빙
- `scripts/serve_embedding.sh`: `Qwen/Qwen3-Embedding-8B` 모델을 4001 포트 `/v1/embeddings` 호환 API로 서빙
- `scripts/serve_reranker.sh`: `Qwen/Qwen3-Reranker-4B` 모델을 4002 포트 `/v1/rerank` 호환 API로 서빙
- `scripts/test_apis.py`: 세 모델 서버를 호출하는 스모크 테스트 스크립트

### `program_extension`

- VS Code `swbc.refine` Chat Participant 등록
- `@refine <프롬프트>` 입력 시 정제본 미리보기 렌더링
- `전송`, `다시 정제`, `원본 전송`, `수정`, `취소` 5개 액션 버튼 제공
- 승인 시 `workbench.action.chat.open` 명령으로 Copilot Chat에 텍스트 전달
- `observe-YYYY-MM-DD.log` JSONL 형식으로 원본/정제본 기록
- Activity Bar `Prompt Refiner` 사이드바에서 정제 내역 조회, 검색, 단어 단위 차이 강조, 복사, 펼치기/접기 제공



## 시스템 구조

```text
사용자
  ├─ 웹 브라우저
  │    └─ program_backend GET / 웹 데모
  │         └─ /rewrite -> /search -> /rerank -> /generate
  │              ├─ LLM 서버: program_AI 4000
  │              ├─ 임베딩 서버: program_AI 4001
  │              ├─ 리랭커 서버: program_AI 4002
  │              └─ Chroma DB: src/program_backend/artifacts/production_chroma_qwen3_8b
  └─ VS Code Copilot Chat
       └─ program_extension @refine
            ├─ 현재: 고정 문자열 정제 미리보기
            ├─ 승인 시 Copilot Chat 입력 전달
            └─ observe-YYYY-MM-DD.log 기록 및 사이드바 표시
```

백엔드는 `.env` 또는 프로세스 환경변수에서 LLM, 임베딩, 리랭커 엔드포인트를 읽는다. Chroma 설정이 비어 있으면 `config.py` 기본값에 따라 제출물에 포함된 Chroma DB와 `production_task_prompt_templates` 컬렉션을 사용한다.

## 주요 디렉터리 구조

```text
result_file/
├── README.md
├── RUN.md
├── requirements.txt
├── package.json
├── git_log.txt
├── src/
│   ├── program_AI/
│   │   ├── requirements.txt
│   │   └── scripts/
│   ├── program_backend/
│   │   ├── app.py
│   │   ├── config.py
│   │   ├── pipeline.py
│   │   ├── retrieval.py
│   │   ├── .env.example
│   │   ├── artifacts/
│   │   ├── data/
│   │   ├── indexing/
│   │   └── static/
│   └── program_extension/
│       ├── package.json
│       ├── build.sh
│       ├── requirements.txt
│       ├── src/
│       └── media/
├── tests/
│   ├── requirements-test.txt
│   ├── run_tests.sh
│   ├── program_AI/
│   │   ├── conftest.py
│   │   └── test_serving.py
│   ├── program_backend/
│   │   ├── conftest.py
│   │   ├── test_api.py
│   │   ├── test_integration.py
│   │   ├── test_pipeline.py
│   │   └── test_retrieval.py
│   └── program_extension/
│       ├── RUN.md
│       ├── _helpers/vscode-stub.js
│       └── src/*.test.js
└── test-results/
    ├── program_AI/README.md
    ├── program_backend/README.md
    └── program_extension/README.md
```

## 핵심 구현 내용

- `src/program_backend/app.py`: FastAPI 앱, API 스키마, `/health`, `/refine`, `/rewrite`, `/search`, `/rerank`, `/generate`, `/` 라우트 구현
- `src/program_backend/pipeline.py`: LLM 호출, JSON 파싱 폴백, 검색/리랭킹/최종 생성 단계, 전체 `run_full()` 파이프라인 구현
- `src/program_backend/retrieval.py`: OpenAI 호환 임베딩 클라이언트, Chroma PersistentClient, 컬렉션 캐시, `/v1/rerank` 호출 및 점수 정렬 구현
- `src/program_backend/config.py`: `.env` 로딩, 모델 연결값, API 키, Chroma 기본 경로, top-k/top-n/timeout 설정
- `src/program_backend/indexing/`: 템플릿 수집, Chroma 벡터 DB 재구축, DB 검사 도구
- `src/program_backend/static/`: 웹 데모. API 단계별 호출, 후보 템플릿 원문 모달, 최종 프롬프트 복사 기능 제공
- `src/program_AI/scripts/`: vLLM 기반 LLM/임베딩/리랭커 서빙 명령과 스모크 테스트
- `src/program_extension/src/chat.js`: `@refine` 처리, 정제 미리보기, 5개 버튼, Copilot Chat 전달 명령
- `src/program_extension/src/refiner.js`: 현재 고정 문자열 정제 함수와 비활성 상태의 백엔드 API 호출 헬퍼
- `src/program_extension/src/logger.js`, `src/logReader.js`, `media/main.js`: JSONL 기록, 로그 파싱, 사이드바 카드 렌더링, 검색, diff, 복사, 펼치기/접기

## 테스트 구현 및 결과 상태


| 대상 | 테스트 파일 | 검증 내용 |
|---|---|---|
| AI 모델 서빙 | `tests/program_AI/test_serving.py` | LLM, 임베딩, 리랭커 실제 엔드포인트 통합 테스트. 서버가 없으면 skip |
| 백엔드 API/파이프라인 | `tests/program_backend/test_api.py`, `test_pipeline.py`, `test_retrieval.py`, `test_integration.py` | FastAPI 엔드포인트, 파이프라인 파싱/폴백, 리랭킹 정렬, 실제 모델 연동 통합 테스트 |
| VS Code 확장 | `tests/program_extension/src/*.test.js` | `@refine` 채팅 동작, 버튼 커맨드, 로그 저장/조회, 설정, refiner 통신 실패 처리 |



## 데이터와 설정 자원

- `src/program_backend/artifacts/production_task_templates/manifest.json`
  - `record_count`: 651
  - GitHub에서 수집한 프롬프트 템플릿과 `selected_prompts.csv` 기반 레코드가 포함되어 있다.
- `src/program_backend/artifacts/production_task_templates/vector_db_manifest.json`
  - `vector_db`: Chroma
  - `embedding_model`: `Qwen/Qwen3-Embedding-8B`
  - `embedding_dim`: 4096
  - `collection_name`: `production_task_prompt_templates`
- `src/program_backend/.env.example`
  - 모델 서버 URL, 모델명, API 키, Chroma 경로, top-k/top-n, timeout 설정 예시 포함
- `requirements.txt`, 각 프로그램별 `requirements.txt`, `tests/requirements-test.txt`, `package.json`
  - 런타임 및 테스트 의존성 목록과 버전 정보 포함
- `git_log.txt`
  - 제출 시점 Git 히스토리 export 포함

## 평가 목적과 평가 대상

이 결과파일은 평가 Agent와 평가자가 다음 항목을 확인할 수 있도록 구성되어 있다.

- 기능 구현 평가: `src/program_backend`, `src/program_AI`, `src/program_extension`의 실제 코드와 스크립트
- 실행 재현성 평가: `RUN.md`, `requirements.txt`, 프로그램별 의존성 파일, `.env.example`, 모델 서빙 스크립트
- 테스트 및 검증 평가: `tests/`, `test-results/`, `tests/run_tests.sh`, 확장 Node 테스트 직접 실행 명령
- 데이터/검색 자원 평가: Chroma DB, 템플릿 manifest, `data/csv/selected_prompts.csv`, `data/md`
- 협업/Git 기록 평가: `git_log.txt`
