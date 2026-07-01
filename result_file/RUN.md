# 실행 및 재현 문서



## 1. 의존성 목록과 버전 고정

| 영역 | 파일 | 확인된 직접 의존성 |
|---|---|---|
| 전체 Python 참조 | `requirements.txt` | 프로그램별 requirements를 `-r`로 참조 |
| 백엔드 | `src/program_backend/requirements.txt` | `fastapi==0.138.1`, `uvicorn[standard]==0.49.0`, `requests==2.34.2`, `chromadb==1.5.9`, `openai==2.44.0`, `tqdm==4.68.3` |
| AI 서빙 | `src/program_AI/requirements.txt` | `vllm==0.19.1`, `requests==2.34.2` |
| 확장 Python 프록시 | `src/program_extension/requirements.txt` | `mitmproxy==12.2.3` |
| 테스트 | `tests/requirements-test.txt` | `fastapi==0.138.1`, `requests==2.34.2`, `chromadb==1.5.9`, `openai==2.44.0`, `pytest==9.1.1`, `httpx==0.28.1` |
| VS Code 확장 패키징 | `package.json` | `@vscode/vsce` 버전 `3.6.0` |
| VS Code 확장 매니페스트 | `src/program_extension/package.json` | VS Code engine `^1.90.0`, 런타임 Node 패키지 의존성 없음 |

Python 직접 의존성은 `==`로 고정되어 있다. Node 패키징 도구는 상위 `package.json`에 `@vscode/vsce: 3.6.0`으로 명시되어 있다. `package-lock.json`은 포함되어 있지 않으므로 Node 전이 의존성의 완전 고정 여부는 확인 필요하다.

## 2. 사전 준비

- Python과 `pip`
- Node.js. 확장 테스트의 JUnit 리포터는 Node 20.13 이상 권장
- VS Code 1.90 이상
- VS Code Copilot Chat 사용 가능 환경
- 로컬 vLLM 실행 시 GPU와 모델 다운로드 권한
- 외부 모델 서버를 쓰는 경우 LLM, 임베딩, 리랭커 OpenAI 호환 엔드포인트 및 API 키

민감한 API 키와 실제 `.env` 파일은 제출물에 포함하지 않는다. 설정 예시는 `src/program_backend/.env.example`만 사용한다.

## 3. 설치 방법

### 3.1 AI 모델 서빙 의존성

```bash
cd src/program_AI
python3 -m venv .venv
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -r requirements.txt
cd ../..
```

`vllm==0.19.1` 설치와 모델 다운로드는 GPU, CUDA, 네트워크, 모델 접근 권한에 영향을 받는다.

### 3.2 백엔드 의존성

```bash
cd src/program_backend
python3 -m venv .venv
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -r requirements.txt
cd ../..
```

### 3.3 테스트 의존성

Python 테스트 실행용 의존성은 런타임과 분리되어 있다.

```bash
python3 -m venv .venv-test
.venv-test/bin/python -m pip install --upgrade pip
.venv-test/bin/python -m pip install -r tests/requirements-test.txt
```

### 3.4 VS Code 확장 패키징 의존성

```bash
npm install
```

상위 `package.json`에는 `package:extension` 스크립트와 `@vscode/vsce==3.6.0`에 해당하는 devDependency가 있다.

## 4. AI 모델 서버 실행

로컬 GPU 환경에서 세 터미널을 열어 각각 실행한다. 스크립트 파일에 실행 비트가 없을 수 있으므로 `bash`로 실행한다.

```bash
cd src/program_AI
bash scripts/serve_llm.sh
```

```bash
cd src/program_AI
bash scripts/serve_embedding.sh
```

```bash
cd src/program_AI
bash scripts/serve_reranker.sh
```

| 서버 | 포트 | 모델 |
|---|---:|---|
| LLM | 4000 | `cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit` |
| 임베딩 | 4001 | `Qwen/Qwen3-Embedding-8B` |
| 리랭커 | 4002 | `Qwen/Qwen3-Reranker-4B` |

세 서버가 실행된 뒤 스모크 테스트를 실행한다.

```bash
cd src/program_AI
.venv/bin/python scripts/test_apis.py
cd ../..
```

성공 기준은 `[LLM]`, `[EMBED]`, `[RERANK]` 섹션이 모두 실패 없이 출력되는 것이다.

## 5. 백엔드 환경 변수 설정

```bash
cd src/program_backend
cp .env.example .env
```

로컬 AI 서버를 쓰는 경우 `.env`에 다음 값을 채운다.

```text
LLM_BASE_URL=http://127.0.0.1:4000
LLM_MODEL=cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit
LLM_API_KEY=

EMBED_BASE_URL=http://127.0.0.1:4001/v1
EMBED_MODEL=Qwen/Qwen3-Embedding-8B
EMBED_API_KEY=

RERANK_BASE_URL=http://127.0.0.1:4002
RERANK_MODEL=Qwen/Qwen3-Reranker-4B
RERANK_API_KEY=

RUNPOD_API_KEY=
CHROMA_DIR=
CHROMA_COLLECTION_NAME=
CHROMA_TOP_K=
RERANK_TOP_N=
LLM_TIMEOUT=
LLM_MAX_TOKENS=
RERANK_TIMEOUT=
```

`CHROMA_DIR`와 `CHROMA_COLLECTION_NAME`을 비우면 코드 기본값으로 제출물에 포함된 Chroma DB와 `production_task_prompt_templates` 컬렉션을 사용한다. 외부 OpenAI 호환 서버를 쓰는 경우 각 `*_BASE_URL`, `*_MODEL`, `*_API_KEY` 또는 공통 `RUNPOD_API_KEY`를 해당 서비스 값으로 변경한다.

## 6. 백엔드 실행

```bash
cd src/program_backend
.venv/bin/python -m uvicorn app:app --host 0.0.0.0 --port 80
```

다른 터미널에서 확인한다.

```bash
curl -s http://127.0.0.1:80/health
```

정상 상태 응답 기대값은 다음과 같다.

```json
{"status":"ok"}
```

전체 파이프라인은 모델 서버와 `.env` 설정이 준비된 뒤 확인한다.

```bash
curl -s -X POST http://127.0.0.1:80/refine   -H 'Content-Type: application/json'   -d '{"prompt":"AI 관련 자유 주제로 5분 발표 PPT 슬라이드 내용을 구성해줘"}'
```

웹 데모와 API 문서는 다음 URL에서 확인한다.

- 웹 데모: `http://127.0.0.1:80/`
- Swagger 문서: `http://127.0.0.1:80/docs`

## 7. VS Code 확장 실행

```bash
cd src/program_extension
code .
```

VS Code에서 `F5`를 눌러 Extension Development Host를 연다. 새 창의 Copilot Chat에 다음처럼 입력한다.

```text
@refine 발표 자료를 5장으로 구성해줘
```

현재 활성 정제 함수는 `src/refiner.js`의 고정 문자열 테스트 모드이다. 따라서 미리보기의 정제본은 백엔드 결과가 아니라 `안녕,클로드`로 표시되는 것이 현재 코드 기준 동작이다. `REFINE_API_URL`과 `callRefineApi()`는 구현되어 있지만 서버 호출 블록이 주석 처리되어 있어, 환경변수만으로 백엔드 연동이 활성화되지는 않는다.

확장 설정은 `src/program_extension/package.json`에 정의되어 있다.

| 설정 키 | 기본값 | 설명 |
|---|---|---|
| `swbcPromptRefiner.logDir` | 빈 문자열 | 비우면 VS Code `globalStorage/logs`에 `observe-YYYY-MM-DD.log`를 저장하고, 값이 있으면 지정한 절대경로를 사용 |
| `swbcPromptRefiner.maxEntries` | `200` | 사이드바에 표시할 최근 정제 내역 개수. 최소 `10`, 최대 `5000` |

확인할 항목은 다음과 같다.

- `@refine` 입력 시 정제본 미리보기와 5개 버튼이 보이는지
- `전송 (allow)` 클릭 시 Copilot Chat 입력으로 전달되는지
- Activity Bar의 `Prompt Refiner` 사이드바에 원본/정제본 카드가 추가되는지
- 검색, 차이 강조, 복사, 긴 본문 펼치기/접기가 동작하는지

## 8. VSIX 패키징

결과파일 루트에서 실행한다.

```bash
npm run package:extension
```

이 명령은 `src/program_extension`에서 `npx --yes @vscode/vsce@3.6.0 package --allow-missing-repository`를 실행한다. 성공 시 `src/program_extension` 아래에 `.vsix` 파일이 생성된다.

## 9. 테스트 실행 및 재현

### 9.1 Python 테스트 실행

```bash
PYTHON=.venv-test/bin/python bash tests/run_tests.sh backend --save
PYTHON=.venv-test/bin/python bash tests/run_tests.sh ai --save
```

- 저장 위치: `test-results/program_backend/`, `test-results/program_AI/`
- backend 단위 테스트는 외부 모델 서버 없이 실행되도록 작성되어 있다.
- backend 통합 테스트와 AI 테스트는 실제 모델 서버가 없으면 skip되도록 작성되어 있다.
- 문서 작성 중 현재 환경에서는 `pytest`가 없어 Python 테스트를 실행하지 못했다. 위 3.3 설치 후 재실행해야 한다.

### 9.2 VS Code 확장 Node 테스트 실행

현재 상위 `package.json`에는 `test:extension` 계열 npm script가 없으므로 직접 Node 테스트 명령을 사용한다.

```bash
node --test --test-reporter=spec tests/program_extension/src/*.test.js
```

JUnit XML이 필요하면 다음처럼 실행한다.

```bash
mkdir -p test-results/program_extension
node --test \
  --test-reporter=junit \
  --test-reporter-destination=test-results/program_extension/junit.xml \
  --test-reporter=spec \
  tests/program_extension/src/*.test.js
```

문서 작성 중 직접 실행한 결과는 25개 중 16개 통과, 9개 실패였다. 주요 실패 항목은 다음과 같다.

- `R-EX-02`: 미리보기 액션 버튼 기대값과 현재 렌더링 결과 불일치
- `R-EX-07`: Cancel 동작에서 `@refine` 접두어 기대값과 현재 구현 불일치
- `R-EX-11`: 실패 UI, 서버 성공/실패 시 refiner 동작, `refineDetailed` export 기대값과 현재 구현 불일치

현재 `test-results/`에는 README 안내 문서만 있고, `junit.xml` 또는 `output.txt` 실행 산출물은 포함되어 있지 않다. `--save` 또는 JUnit 명령으로 생성할 수 있다.

## 10. DevOps 8개 기준 대응

| 번호 | 기준 | 제출물 기준 대응 | 상태 |
|---:|---|---|---|
| 1 | 사용한 라이브러리 목록 명시 | `requirements.txt`, 프로그램별 `requirements.txt`, `tests/requirements-test.txt`, `package.json` | 명시됨 |
| 2 | 라이브러리 버전 고정 | Python 직접 의존성은 `==` 고정, `@vscode/vsce`는 `3.6.0` 명시. Node lockfile은 없음 | 부분 충족 |
| 3 | 빌드·설치 방법 문서화 | 본 문서 3장에 AI, 백엔드, 테스트, Node 설치 절차 작성 | 문서화됨 |
| 4 | 실행·기동 방법 문서화 | AI vLLM 스크립트, 백엔드 uvicorn, VS Code F5, VSIX 패키징 절차 작성 | 문서화됨 |
| 5 | 환경 변수·설정 파일 문서화 | `src/program_backend/.env.example`, `.env` 작성 예시, 확장 설정 키 설명 | 문서화됨 |
| 6 | 외부 서비스·자원 안내 | GPU/모델 접근 권한, 외부 OpenAI 호환 엔드포인트, API 키, VS Code/Copilot, Chroma 번들 DB 안내 | 문서화됨 |
| 7 | 빌드·설치가 문서대로 성공하는가 | 설치 절차는 문서화되어 있으나 제출물에 설치 성공 로그는 없음 | 확인 필요 |
| 8 | 애플리케이션이 실행·기동되는가 | `/health`, `/refine`, 웹 데모, `@refine`, VSIX, 테스트 실행 검증 절차 제공. 실제 저장된 실행 로그는 없음 | 확인 필요 |

## 11. 현재 확인된 제한 사항

- `test-results`에는 현재 README 안내 문서만 있고 자동 생성된 JUnit/콘솔 로그 파일은 없다.
- AI 서버 실행은 GPU, CUDA, 모델 다운로드, 모델 접근 권한에 의존한다.
- 백엔드 `/refine`은 LLM, 임베딩, 리랭커 서버와 `.env` 설정이 준비되어야 성공한다.
- VS Code 확장의 현재 활성 정제 경로는 고정 문자열 테스트 모드이다.
- 확장 Node 테스트는 현재 코드 기준 25개 중 9개가 실패한다.
- `tests/run_tests.sh`의 `extension` 대상은 `npm run test:extension`을 호출하지만, 현재 상위 `package.json`에는 해당 script가 없어 직접 `node --test ...` 명령을 사용해야 한다.
