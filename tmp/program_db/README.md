# Program DB RAG 리랭킹 파이프라인

이 디렉터리는 코파일럿 메타 프롬프팅에서 사용할 TASK 프롬프트 템플릿 검색 파이프라인을 담고 있습니다. 현재 범위는 템플릿 수집, Chroma DB 구축, Chroma top-20 검색, reranker top-3 추출까지입니다. top-3 중 최종 템플릿을 LLM으로 선택하는 단계는 다음 작업 범위입니다.

## 포함된 내용

- `scripts/collect_production_templates.py`: GitHub 템플릿과 CSV 템플릿을 수집해 검색용 레코드로 정리합니다.
- `scripts/build_vector_db.py`: OpenAI-compatible embedding endpoint를 호출해 Chroma DB를 생성합니다.
- `scripts/search_vector_db.py`: Chroma 검색만 빠르게 확인하는 스모크 테스트입니다.
- `scripts/rerank_vector_db.py`: Chroma top-20 후보를 reranker로 재점수화하고 top-3를 출력합니다.
- `scripts/inspect_vector_db.py`: 저장된 Chroma DB의 count, metadata, preview를 확인합니다.
- `contests/llm_scripts.py`: 로컬 vLLM LLM, embedding, reranker endpoint 호출 예시입니다.
- `artifacts/production_task_templates/`: 정제된 production 템플릿 레코드입니다.
- `artifacts/production_chroma_qwen3_8b/`: 커밋에 포함된 production Chroma DB입니다.
- `docs/rag_reranking.md`: 함수와 데이터 흐름을 설명하는 작업 인수인계 문서입니다.

## 환경변수와 키 관리

실제 API key는 Git에 올리지 않습니다. 로컬 실행 시 `.env.example`을 복사해서 `.env`를 만들고 값을 채우면 됩니다.

```bash
cp .env.example .env
```

`.env`는 `.gitignore`에 포함되어 커밋되지 않습니다. 서버나 RunPod endpoint를 쓸 때도 실제 키는 `.env` 또는 프로세스 환경변수로만 주입합니다.

주요 환경변수:

```text
RUNPOD_API_KEY=
EMBED_BASE_URL=http://127.0.0.1:4001/v1
EMBED_MODEL=Qwen/Qwen3-Embedding-8B
RERANK_BASE_URL=http://127.0.0.1:4002
RERANK_MODEL=Qwen/Qwen3-Reranker-4B
CHROMA_DIR=artifacts/production_chroma_qwen3_8b
CHROMA_COLLECTION_NAME=production_task_prompt_templates
```

## 설치

기존 프로젝트 환경을 써도 되고, 별도 가상환경을 만들어도 됩니다.

```bash
python3 -m venv /opt/program-db-venv
/opt/program-db-venv/bin/python -m pip install --upgrade pip
/opt/program-db-venv/bin/pip install -r requirements.deploy.txt
```

## DB 확인

커밋된 Chroma DB가 정상적으로 열리는지 확인합니다.

```bash
/opt/program-db-venv/bin/python scripts/inspect_vector_db.py \
  --chroma-dir artifacts/production_chroma_qwen3_8b \
  --collection-name production_task_prompt_templates \
  --limit 2
```

현재 production DB 기준:

- 레코드 수: `651`
- 임베딩 모델: `Qwen/Qwen3-Embedding-8B`
- 임베딩 차원: `4096`
- Chroma collection: `production_task_prompt_templates`

## 리랭킹 실행 예시

아래 명령은 질의를 embedding한 뒤 Chroma에서 top-20을 검색하고, reranker가 20개 query-document pair를 재점수화해 top-3를 반환합니다.

```bash
/opt/program-db-venv/bin/python scripts/rerank_vector_db.py \
  "Python 서비스 CI/CD 품질 게이트 설계" \
  --preview-chars 300
```

예상 출력은 JSON이며, 각 결과에는 `rerank_rank`, `rerank_score`, `chroma_rank`, `chroma_distance`, `id`, `metadata`, `document_preview`가 포함됩니다.

후속 LLM 선택 단계에서 전체 템플릿 본문이 필요하면 `--include-full-documents` 옵션을 사용합니다.

```bash
/opt/program-db-venv/bin/python scripts/rerank_vector_db.py \
  "업무 PPT 만들어줘" \
  --include-full-documents
```

## 템플릿 재수집과 DB 재생성

템플릿을 다시 수집할 때는 `selected_prompts.csv` 경로가 필요합니다. 기본값은 현재 디렉터리의 `selected_prompts.csv`이며, 다른 위치라면 환경변수로 지정합니다.

```bash
export SELECTED_PROMPTS_CSV=/path/to/selected_prompts.csv
/opt/program-db-venv/bin/python scripts/collect_production_templates.py
```

DB 재생성:

```bash
/opt/program-db-venv/bin/python scripts/build_vector_db.py \
  --artifact-dir artifacts/production_task_templates \
  --chroma-dir artifacts/production_chroma_qwen3_8b \
  --collection-name production_task_prompt_templates \
  --model-name Qwen/Qwen3-Embedding-8B \
  --base-url http://127.0.0.1:4001/v1 \
  --batch-size 8
```

DB 생성에 사용한 embedding 모델과 검색 시 query embedding 모델은 반드시 같아야 합니다.

## Git 브랜치

이 작업은 원격 `main`에서 분기한 `rag` 브랜치에 로컬 커밋으로 준비되어 있습니다. 원격에 올릴 때는 아래처럼 push하면 GitHub 웹에서도 브랜치 이름이 `rag`로 보입니다.

```bash
git push -u origin rag
```
