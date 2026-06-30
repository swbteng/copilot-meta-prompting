# program_backend 테스트 안내

테스트 코드는 제출 제외 요청에 따라 추가하지 않았다. 대신 아래 명령으로 요구사항을 수동/스모크 검증한다.

## 검증 대상 요구사항

- R-01: `/health` 상태 확인
- R-02: `/refine` 전체 파이프라인
- R-03: `/rewrite` 재작성 단계
- R-04: `/search` Chroma 검색 단계
- R-05: `/rerank` 리랭킹 단계
- R-06: `/generate` 최종 생성 단계
- R-07, R-08: 웹 데모 렌더링과 단계별 표시
- R-09, R-10, R-21: 환경 설정, 데이터 포함, 예외 처리

## 사전 조건

`src/program_AI`의 LLM, 임베딩, 리랭커 서버가 실행되어 있거나 `.env`에 외부 RunPod/OpenAI 호환 엔드포인트가 설정되어 있어야 한다.

## 실행 예시

```bash
cd result_file/src/program_backend
.venv/bin/uvicorn app:app --host 0.0.0.0 --port 8000
curl -s http://127.0.0.1:8000/health
curl -s -X POST http://127.0.0.1:8000/rewrite -H 'Content-Type: application/json' -d '{"prompt":"발표 자료 만들어줘"}'
curl -s -X POST http://127.0.0.1:8000/refine -H 'Content-Type: application/json' -d '{"prompt":"AI 관련 자유 주제로 5분 발표 PPT 슬라이드 내용을 구성해줘"}'
```

웹 데모는 브라우저에서 `http://127.0.0.1:8000/` 접속 후 입력창에 프롬프트를 넣고 `정제하기`를 클릭해 확인한다.
