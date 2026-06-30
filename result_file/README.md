# Copilot Meta-Prompting 결과파일

본 결과파일은 Copilot 메타 프롬프팅 서비스를 재현하기 위한 소스 코드, 실행 문서, 의존성 목록, 검증 문서를 포함한다. 서비스는 세 프로그램으로 나뉜다.

| 프로그램 | 경로 | 역할 |
|---|---|---|
| `program_backend` | `src/program_backend` | FastAPI API 서버, RAG 파이프라인, Chroma 검색, 리랭킹, 웹 데모 |
| `program_AI` | `src/program_AI` | vLLM 기반 LLM/임베딩/리랭커 모델 서빙 스크립트 |
| `program_extension` | `src/program_extension` | VS Code Copilot Chat `@refine` 확장과 정제 내역 사이드바 |

## 핵심 기능

- `POST /refine` 전체 파이프라인: 원본 프롬프트 -> LLM 재작성 -> Chroma top-k 검색 -> 리랭커 top-n 선별 -> 최종 프롬프트 생성
- 단계별 API: `/rewrite`, `/search`, `/rerank`, `/generate`
- 웹 데모: `/`에서 4단계 파이프라인을 카드 형태로 시각화하고 템플릿 원문/최종 프롬프트 복사 기능 제공
- 모델 서빙: Qwen 계열 LLM, 임베딩, 리랭커를 vLLM OpenAI 호환 API로 실행하는 스크립트 제공
- VS Code 확장: `@refine` Chat Participant, 정제본 미리보기, 5개 액션 버튼, JSONL 기반 정제 내역 사이드바 제공

## 주요 파일

| 파일 | 설명 |
|---|---|
| `RUN.md` | 전체 서비스 설치, 설정, 실행, 검증 절차 |
| `requirements.txt` | Python 프로그램 의존성 모음 |
| `package.json` | VS Code 확장 패키징용 Node 의존성 |
| `git_log.txt` | 제출 시점 Git 히스토리 export |
| `src/program_backend/.env.example` | 백엔드 외부 모델 서버 환경변수 예시 |
| `src/program_backend/RUN.md` | 백엔드 단독 실행/배포 가이드 |

## 현재 구현 상태 메모

백엔드 RAG 정제 파이프라인은 API와 웹 데모로 구현되어 있다. VS Code 확장의 활성 `@refine` 경로는 현재 고정 문자열 정제 결과를 사용해 미리보기, 승인, 전송, 기록 흐름을 검증하는 구조이며, `refiner.js`와 `refine_copilot.py`에는 정제 서버 호출 헬퍼가 구현되어 있다. 서버 연동을 활성화하려면 해당 주석 처리된 서버 호출 경로를 실제 배포 URL에 맞춰 전환해야 한다.
