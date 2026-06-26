# program_endpoint 실행 / 배포 가이드

## 1. 설치

백엔드 = endpoint + db 이므로 두 모듈의 의존성을 같이 설치합니다.

```bash
cd result_file/src/program_endpoint
python3 -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -r requirements.txt                       # fastapi, uvicorn, requests
.venv/bin/pip install -r ../program_db/requirements.deploy.txt  # chromadb, openai, requests, tqdm
```

## 2. 설정

```bash
cp .env.example .env
# .env 를 열어 LLM/EMBED/RERANK 의 BASE_URL·MODEL·(필요 시)KEY 를 채운다.
```

- **로컬 vLLM**(infra 3개 서버가 떠 있을 때): `LLM_BASE_URL=http://127.0.0.1:4000`,
  `EMBED_BASE_URL=http://127.0.0.1:4001/v1`, `RERANK_BASE_URL=http://127.0.0.1:4002`. 키는 비워둠.
- **RunPod**: 각 BASE_URL 을 RunPod 엔드포인트 URL 로, `RUNPOD_API_KEY` 를 채움.
- 임베딩 모델은 DB 구축에 쓴 `Qwen/Qwen3-Embedding-8B` 와 반드시 동일해야 합니다(벡터 호환).

## 3. 실행

```bash
cd result_file/src/program_endpoint
.venv/bin/uvicorn app:app --host 0.0.0.0 --port 8000
```

- `--host 0.0.0.0` 이어야 외부에서 접속됩니다(R-IN-02). 자동 문서는 `http://<host>:8000/docs`.

### 스모크 테스트

```bash
curl -s http://127.0.0.1:8000/health
curl -s -X POST http://127.0.0.1:8000/refine \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"AI 관련 자유 주제로 5분 발표 PPT 슬라이드 내용을 구성해줘"}'
```

> 모델 서버(vLLM/RunPod)가 떠 있어야 실제 응답이 나옵니다. 떠 있지 않으면 502/타임아웃 또는
> "설정값이 비어 있습니다" 에러로 어디가 비었는지 알려줍니다.

## 4. RunPod 외부 노출 — 변동 IP 문제

RunPod **Pod 는 stop→start 할 때마다 공인 TCP IP/포트가 바뀌지만**, Pod 마다 **고정 프록시 도메인**을 줍니다.
IP 대신 이 도메인을 쓰면 됩니다.

```
https://{POD_ID}-{INTERNAL_PORT}.proxy.runpod.net
# 예: 이 서버를 8000 포트로 띄웠다면  https://abc123def-8000.proxy.runpod.net
```

- `POD_ID` 는 Pod 생성 시 정해져 **stop/start 후에도 그대로** 유지됩니다(= 도메인 불변).
  Pod 를 **terminate 하고 새로 만들면** `POD_ID` 가 바뀌어 도메인도 바뀝니다.
- Pod 설정에서 해당 포트(예: 8000)를 HTTP 로 expose 하면 위 프록시 URL 이 자동 생성됩니다.
- 확장/프록시(`refine_copilot.py`)의 `REFINE_API_URL` 에 `https://{POD_ID}-8000.proxy.runpod.net/refine` 을 넣습니다.

### 주의: HTTP 프록시 100초 제한

RunPod 프록시(Cloudflare)는 **요청당 최대 ~100초**입니다. `/refine` 전체 파이프라인은 LLM 을 2번(정제+생성)
호출하므로 길어지면 100초를 넘을 수 있습니다. 대응:

- 단계 분리 호출(`/rewrite` → `/rerank` → `/generate`)로 각 호출을 짧게 가져가기, 또는
- 프록시 대신 **TCP 공인 포트**(IP:PORT, 단 stop/start 시 변동) 사용, 또는
- 모델 추론처럼 이 API 도 **RunPod Serverless**로 올리면 `*.api.runpod.ai` 고정 URL + 긴 실행 허용.

> 참고: 임베딩/리랭커/LLM 은 이미 RunPod Serverless(`*.api.runpod.ai`)로 고정 URL 을 갖고 있어
> IP 변동 문제가 없습니다. 변동 IP 는 "이 API 서버를 Pod 에 띄울 때"만 해당됩니다.

### 출처
- https://docs.runpod.io/pods/configuration/expose-ports
- https://www.runpod.io/blog/runpod-proxy-guide
- https://www.runpod.io/articles/guides/deploy-fastapi-applications-gpu-cloud
