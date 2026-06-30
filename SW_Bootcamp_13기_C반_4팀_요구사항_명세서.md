# SW_Bootcamp_13기_C반_4팀 요구사항 명세서

## 1. 프로젝트 개요

본 프로젝트는 사용자가 Copilot Chat 또는 웹 데모에 입력한 원본 프롬프트를 더 명확하고 실행 가능한 프롬프트로 정제하는 메타 프롬프팅 서비스이다. 구현 범위는 FastAPI 기반 RAG 정제 서버, vLLM 모델 서빙 스크립트, Chroma 벡터 DB 및 리랭킹 파이프라인, VS Code Copilot Chat 확장 프로그램으로 구성된다.

요구사항은 제출 코드에 구현되어 있거나 실행 문서로 재현 가능한 기능을 중심으로 작성했다. VS Code 확장의 현재 활성 정제 경로는 고정 문자열 기반 미리보기/승인 흐름이며, RAG 백엔드 정제 서버는 독립 API와 웹 데모로 구현되어 있다. 확장 내 서버 호출 헬퍼는 구현되어 있으나 현재 활성화 주석 전 상태이므로, 요구사항에는 활성 동작과 구현된 백엔드 API를 분리해 명시한다.

## 2. 요구사항 목록

| 요구사항 ID | 요구사항 내용 | 검증 기준 (완료 조건) | 시연 타임스탬프 |
|---|---|---|---|
| R-01 | API 서버는 상태 확인 엔드포인트를 제공한다 | `GET /health` 호출 시 HTTP 200과 `{"status":"ok"}`를 반환한다 | N/A (API 상태 확인) |
| R-02 | API 서버는 전체 프롬프트 정제 파이프라인을 제공한다 | `POST /refine`에 `{"prompt":"..."}`를 보내면 `refined`, `translated_input`, `rewritten_prompt`, `templates` 키가 포함된 JSON을 반환한다 | N/A (백엔드 API) |
| R-03 | 원본 프롬프트를 검색용 영어 프롬프트로 재작성한다 | `POST /rewrite` 호출 시 `translated_input`, `rewritten_prompt`, `finish_reason`을 반환하고 JSON 파싱 실패 시에도 텍스트 폴백을 반환한다 | N/A (백엔드 내부 단계) |
| R-04 | Chroma 벡터 DB에서 유사 프롬프트 템플릿을 검색한다 | `POST /search` 호출 시 기본 20개 또는 요청 `top_k` 개수의 후보를 `chroma_rank`, `id`, `chroma_distance`, `metadata`, `document`와 함께 반환한다 | N/A (백엔드 내부 단계) |
| R-05 | 검색 후보를 리랭커 모델로 재정렬한다 | `POST /rerank` 호출 시 Chroma 후보를 `/v1/rerank`로 재점수화하고 기본 상위 3개 또는 요청 `top_n` 개수를 `rerank_score` 포함 결과로 반환한다 | N/A (백엔드 내부 단계) |
| R-06 | 최종 프롬프트를 한국어로 생성한다 | `POST /generate` 호출 시 번역 입력, 재작성 프롬프트, 후보 템플릿을 조합해 `adapted_prompt`와 `finish_reason`을 반환한다 | N/A (백엔드 내부 단계) |
| R-07 | 웹 데모는 파이프라인 단계를 순서대로 시각화한다 | 루트 경로 `/`에서 입력, rewrite, search, rerank, generate 단계가 카드로 표시되고 각 단계의 성공/실패 상태가 화면에 반영된다 | N/A (웹 데모 실행 화면) |
| R-08 | 웹 데모는 검색/리랭킹 후보 템플릿 확인 기능을 제공한다 | 검색 또는 리랭킹 후보 행 클릭 시 원본 템플릿 모달이 열리고, 최종 생성 결과는 복사 버튼으로 클립보드에 복사할 수 있다 | N/A (웹 데모 실행 화면) |
| R-09 | 외부 모델 서버 연결 정보는 환경변수로 관리한다 | LLM, 임베딩, 리랭커 URL/모델/API 키가 `.env.example`에 문서화되어 있고 `config.py`가 `.env` 또는 프로세스 환경변수에서만 값을 읽는다 | N/A (설정 파일 검증) |
| R-10 | 템플릿 데이터와 벡터 DB를 결과파일에 포함한다 | `src/program_backend/data/md`, `artifacts/production_task_templates`, `artifacts/production_chroma_qwen3_8b`가 포함되어 검색 재현에 필요한 데이터가 제출된다 | N/A (파일 구성 검증) |
| R-11 | vLLM 기반 모델 서빙 스크립트를 제공한다 | `serve_llm.sh`, `serve_embedding.sh`, `serve_reranker.sh`가 각각 텍스트 생성, 임베딩, 리랭커 모델을 OpenAI 호환 API 포트로 실행한다 | N/A (GPU 서버 실행 자원) |
| R-12 | 모델 서버 스모크 테스트 스크립트를 제공한다 | `scripts/test_apis.py` 실행 시 LLM `/v1/chat/completions`, 임베딩 `/v1/embeddings`, 리랭커 `/v1/rerank` 호출 결과를 출력한다 | N/A (GPU 서버 검증) |
| R-13 | VS Code 확장은 Copilot Chat에 `@refine` 참가자를 등록한다 | VS Code 1.90 이상에서 확장 활성화 시 `swbc.refine` Chat Participant가 등록되고 `@refine <프롬프트>` 입력을 처리한다 | 00:15 |
| R-14 | `@refine` 입력은 정제본 미리보기와 5개 액션을 제공한다 | 채팅 응답 스트림에 정제본 미리보기, 원본 텍스트, `전송`, `다시 정제`, `원본 전송`, `수정`, `취소` 버튼이 렌더링된다 | 00:22 |
| R-15 | 전송 액션은 최종 프롬프트를 Copilot에 전달하고 로그를 남긴다 | `전송 (allow)` 실행 시 `workbench.action.chat.open`으로 정제본을 보내고 `observe-YYYY-MM-DD.log`에 `ts`, `channel`, `before`, `after`를 JSONL로 append한다 | 00:30 |
| R-16 | 다시 정제 액션은 동일 원본으로 새 정제 턴을 만든다 | `다시 정제 (try again)` 실행 시 `@refine <원본>` 쿼리로 Chat Participant를 재호출한다 | 01:05 |
| R-17 | 원본 전송, 수정, 취소 액션을 제공한다 | 원본 전송은 원문을 즉시 Copilot에 보내고, 수정은 정제본을 입력창에 partial query로 채우며, 취소는 원문을 입력창에 복원한다 | 01:20 |
| R-18 | VS Code Activity Bar에 정제 내역 사이드바를 제공한다 | `swbcPromptRefiner` Activity Bar 아이콘과 `정제 내역` WebviewView가 등록되고 로그 폴더의 JSONL 기록을 카드로 표시한다 | 01:50 |
| R-19 | 사이드바는 검색, 차이 강조, 복사, 펼치기 기능을 제공한다 | 원본/정제본/모델/채널 검색, 단어 단위 diff 토글, 블록별 복사, 긴 프롬프트 접기/펼치기가 동작한다 | 02:00 |
| R-20 | 확장 프로그램은 VSIX 패키징이 가능해야 한다 | `src/program_extension/build.sh` 실행 시 `npx --yes @vscode/vsce package --allow-missing-repository`로 `.vsix` 파일을 생성한다 | N/A (빌드 산출물) |
| R-21 | 실패 상황에서도 사용자 흐름을 중단하지 않는다 | 백엔드 요청 실패는 HTTP 500 detail로 반환되고, 확장 정제/로그/전송 오류는 fail-open 처리되어 원본 입력 또는 경고 메시지로 흐름을 유지한다 | N/A (예외 처리 검증) |

## 3. 산출물 매핑

| 산출물 위치 | 내용 |
|---|---|
| `result_file/src/program_backend` | FastAPI API 서버, RAG 파이프라인, Chroma 검색/리랭킹, 웹 데모, 데이터/벡터 DB |
| `result_file/src/program_AI` | vLLM 기반 LLM/임베딩/리랭커 모델 서빙 스크립트와 API 스모크 테스트 |
| `result_file/src/program_extension` | VS Code Copilot Chat `@refine` 확장, 정제 내역 사이드바, VSIX 패키징 스크립트 |
| `result_file/tests` | 요구사항별 검증 절차 README |
| `result_file/test-results` | 제출 환경 기준 테스트 결과 및 미실행 사유 README |
| `result_file/README.md`, `result_file/RUN.md` | 결과파일 전체 개요와 실행·재현 절차 |
