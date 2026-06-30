# program_backend - 메타 프롬프팅 API 서버

사용자 프롬프트를 받아 `정제 -> 벡터 검색 -> 리랭킹 -> 최종 프롬프트 생성` 파이프라인을 실행하는 FastAPI 서버이다. 루트 경로에서는 같은 파이프라인을 단계별로 보여주는 웹 데모를 제공한다.

## 파이프라인

```text
사용자 입력
  -> /rewrite   LLM으로 영어 번역 및 검색용 프롬프트 재작성
  -> /search    Chroma production DB에서 top-k 템플릿 검색
  -> /rerank    리랭커 모델로 후보 재점수화 후 top-n 선별
  -> /generate  선택 템플릿과 사용자 의도를 합성해 최종 한국어 프롬프트 생성
```

`/refine`은 위 네 단계를 한 번에 실행하고, VS Code 확장 또는 외부 클라이언트가 사용하기 쉬운 `refined` 키를 포함해 반환한다.

## 엔드포인트

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/` | 파이프라인 시각화 웹 데모 |
| GET | `/health` | 서버 상태 확인 |
| POST | `/refine` | 전체 파이프라인 실행 |
| POST | `/rewrite` | LLM 재작성 단계 실행 |
| POST | `/search` | Chroma 벡터 검색 단계 실행 |
| POST | `/rerank` | 검색+리랭킹 단계 실행 |
| POST | `/generate` | 최종 프롬프트 생성 단계 실행 |

자동 API 문서는 서버 실행 후 `/docs`에서 확인한다.

## 데이터와 검색 자원

- `data/md`: 고품질 프롬프트 템플릿 원천 데이터
- `artifacts/production_task_templates`: 정규화된 템플릿 레코드와 manifest
- `artifacts/production_chroma_qwen3_8b`: `Qwen/Qwen3-Embedding-8B` 기준으로 구축된 Chroma DB
- `retrieval.py`: Chroma 검색과 리랭커 호출을 담당하는 런타임 모듈
- `indexing/`: 템플릿 수집과 벡터 DB 재구축용 오프라인 도구

## 설정

```bash
cp .env.example .env
```

`.env`에서 LLM, 임베딩, 리랭커의 URL/모델/API 키를 설정한다. 비어 있는 필수 연결값은 요청 시 명확한 오류로 반환된다.

## 실행

자세한 절차는 `RUN.md`를 따른다.

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app:app --host 0.0.0.0 --port 8000
```

확인:

```bash
curl -s http://127.0.0.1:8000/health
```
