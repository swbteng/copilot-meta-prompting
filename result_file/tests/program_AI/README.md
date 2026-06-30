# program_AI 테스트 안내

테스트 코드는 제출 제외 요청에 따라 추가하지 않았다. `scripts/test_apis.py`는 모델 서버 상태를 확인하는 스모크 테스트 스크립트로 제공된다.

## 검증 대상 요구사항

- R-11: vLLM LLM/임베딩/리랭커 서버 실행
- R-12: 세 모델 API 호출 가능 여부

## 실행 예시

```bash
cd result_file/src/program_AI
./scripts/serve_llm.sh
./scripts/serve_embedding.sh
./scripts/serve_reranker.sh
.venv/bin/python scripts/test_apis.py
```

원격 서버를 검증할 때는 다음 환경변수를 설정한다.

```bash
HOST=<서버 주소> LLM_PORT=4000 EMBED_PORT=4001 RERANK_PORT=4002 .venv/bin/python scripts/test_apis.py
```

성공 기준은 LLM 응답 텍스트, 임베딩 벡터 차원, 리랭커 점수순 결과가 모두 출력되는 것이다.
