# program_AI 테스트 결과

현재 제출 환경에서는 vLLM 모델 다운로드와 GPU 실행이 필요하므로 자동 실행 결과 파일은 포함하지 않았다. 대신 `scripts/test_apis.py`로 동일 검증을 재현할 수 있다.

## 확인된 정적 검증

- `serve_llm.sh`가 `cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit`를 4000 포트로 실행하도록 구성되어 있다.
- `serve_embedding.sh`가 `Qwen/Qwen3-Embedding-8B`를 4001 포트 OpenAI 호환 임베딩 API로 실행하도록 구성되어 있다.
- `serve_reranker.sh`가 `Qwen/Qwen3-Reranker-4B`를 4002 포트 리랭커 API로 실행하도록 구성되어 있다.
- `scripts/test_apis.py`가 세 서버를 호출하고 응답을 출력한다.

## 성공 기준

`test_apis.py` 실행 시 `[LLM]`, `[EMBED]`, `[RERANK]` 섹션이 모두 실패 없이 출력된다.
