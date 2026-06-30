# program_backend 테스트 결과

현재 제출 환경에서는 외부 LLM/임베딩/리랭커 서버와 GPU 자원이 항상 보장되지 않으므로 자동 테스트 로그 대신 재현 가능한 검증 절차를 첨부한다.

## 확인된 정적 검증

- `app.py`에 `/health`, `/refine`, `/rewrite`, `/search`, `/rerank`, `/generate`, `/` 라우트가 구현되어 있다.
- `pipeline.py`가 rewrite, search, rerank, generate, run_full 단계를 분리해 제공한다.
- `retrieval.py`가 Chroma 검색과 `/v1/rerank` 호출을 구현한다.
- `.env.example`에 LLM, 임베딩, 리랭커, Chroma 설정값이 문서화되어 있다.
- `artifacts/production_chroma_qwen3_8b`와 템플릿 데이터가 결과파일에 포함되어 있다.

## 실행 결과 기록 방법

평가 환경에서 모델 서버를 연결한 뒤 아래 명령의 출력 결과를 이 폴더에 추가하면 된다.

```bash
curl -s http://127.0.0.1:8000/health
curl -s -X POST http://127.0.0.1:8000/refine -H 'Content-Type: application/json' -d '{"prompt":"AI 발표 자료 구성"}'
```
