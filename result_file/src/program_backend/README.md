# program_backend — 메타 프롬프팅 API 서버

사용자 프롬프트를 받아 **정제 → 벡터 검색 → 리랭킹 → 최종 프롬프트 생성** 파이프라인을 실행하고
결과를 돌려주는 FastAPI 서버입니다. VSCode 확장이 이 서버의 `/refine` 로 요청을 보냅니다.

```
사용자 입력
   │
   ▼  (1) LLM 정제      /rewrite   rewrite_prompt 로직
translated_input · rewritten_prompt
   │
   ▼  (2) 벡터 검색      /search    retrieval.search_chroma (Chroma top-k)
   ▼  (3) 리랭킹         /rerank    retrieval.rerank_candidates (top-n)
top-n 템플릿
   │
   ▼  (4) LLM 최종 생성  /generate  pick_prompt 로직
최종 정제 프롬프트  →  /refine 응답의 "refined"
```

- **백엔드는 자족 모듈**입니다: API·파이프라인·검색/리랭킹(`retrieval.py`)·Chroma 데이터(`artifacts/`)가
  한 폴더에 있습니다. DB 구축 도구는 오프라인용이라 `indexing/` 으로 분리했습니다(런타임 서빙엔 불필요).
- 모델 추론(LLM/임베딩/리랭커)은 별도 서버(로컬 vLLM 또는 RunPod)의 OpenAI 호환 엔드포인트가 담당하고,
  이 서버는 그 주소/모델명을 `.env` 로만 받습니다(코드 하드코딩 없음).

## 엔드포인트

| 메서드 | 경로 | 입력 | 출력 |
| :-- | :-- | :-- | :-- |
| GET | `/health` | — | `{"status":"ok"}` |
| POST | `/refine` | `{"prompt", "chroma_top_k?", "top_n?"}` | `{"refined", "translated_input", "rewritten_prompt", "templates"}` |
| POST | `/rewrite` | `{"prompt"}` | `{"translated_input", "rewritten_prompt", "finish_reason"}` |
| POST | `/search` | `{"query", "top_k?"}` | `{"query", "results":[...]}` |
| POST | `/rerank` | `{"query", "chroma_top_k?", "top_n?"}` | `{"query", "results":[...]}` |
| POST | `/generate` | `{"translated_input", "rewritten_prompt", "templates":[...]}` | `{"adapted_prompt", "finish_reason"}` |

- `/refine` 가 전체 파이프라인이고, 나머지 4개는 각 단계를 따로 실행/디버깅하는 용도입니다.
- `/refine` 응답의 `refined` 키는 확장↔서버 계약(확장 `src/refiner.js`)에 맞춘 최종 결과입니다.
- 자동 문서: 서버 실행 후 `/docs` (Swagger UI).

## 설정 (.env)

모든 연결값은 `.env` 에서만 읽습니다. `.env.example` 을 복사해 채우세요(실제 `.env` 는 커밋 금지).

```bash
cp .env.example .env   # 값 채우기 (로컬 vLLM 또는 RunPod 주소/모델/키)
```

빈 값으로 두면 해당 요청이 명확한 에러(`설정값이 비어 있습니다: ...`)를 냅니다.

## 실행 / 배포

[RUN.md](RUN.md) 참고 (로컬 실행, 외부 노출, RunPod Pod 고정 도메인 포함).
