# swbc-proxy — GitHub Copilot 프롬프트 정제 프록시

VS Code의 **GitHub Copilot Chat**이 백엔드로 보내는 요청을 로컬에서 가로채,
**사람이 직접 입력한 프롬프트만** 정제된 문장으로 바꿔치기한 뒤 다시 흘려보내는
[mitmproxy](https://mitmproxy.org/) 애드온입니다. 일종의 **메타프롬프팅(meta-prompting) 프록시**예요.

> 사용자는 평소처럼 Copilot에 질문하지만, 모델에 도달하기 직전에 그 질문이
> 자동으로 더 좋은 프롬프트로 다듬어집니다. Copilot/모델/확장은 아무것도 수정할 필요가 없습니다.

---

## 무엇을 하나

VS Code Copilot은 사람이 친 문장을 다른 스캐폴딩과 함께 `<userRequest>…</userRequest>`로 감싸서 보냅니다.
이 프록시는 **그 태그 안쪽만** 교체합니다.

```
[사용자가 입력]   자료구조가 뭔지 3줄로 설명해줘
        │
        ▼  VS Code Copilot이 백엔드로 전송 (스캐폴딩 + 마커)
   …<context>…</context>
   <userRequest>
   자료구조가 뭔지 3줄로 설명해줘     ← 이 안쪽만
   </userRequest>
        │
        ▼  swbc-proxy 가로채기 → refine_text()로 교체
   <userRequest>
   안녕,클로드                        ← 교체됨 (현재: 테스트용 고정 문자열)
   </userRequest>
        │
        ▼  모델은 교체된 프롬프트를 받음
```

현재는 **검증용으로 고정 문자열 `"안녕,클로드"`** 를 넣습니다. 별도로 띄울 **정제 서버**의
엔드포인트를 연결하면, 사람 입력을 그 서버로 보내 **정제된 프롬프트를 받아 끼워 넣는** 동작으로
한 줄 주석 해제만으로 전환됩니다 (아래 [정제 서버 연결](#정제-서버-연결로-전환) 참고).

---

## 동작 원리

고른 모델에 따라 트래픽 경로가 갈리며, 사람 입력 위치는 셋 다 `<userRequest>` 마커로 동일합니다.

| 모델 | 경로 | 전송 방식 | 처리 훅 |
|---|---|---|---|
| Claude 계열 | `/v1/messages` | HTTP (SSE) | `request()` |
| GPT 계열 | `/responses` | **WebSocket** (단일 JSON 프레임) | `websocket_message()` |
| 공통/백그라운드 | `/chat/completions` | HTTP | `request()` — 마커 없으면 자동 무시 |

`/chat/completions`는 자동완성(NES)·대화 제목 생성 같은 백그라운드 호출이라 `<userRequest>`가 없고,
따라서 **마커의 존재 자체가 "사람 입력"을 가려내는 안전한 allowlist** 역할을 합니다.

### 안전 설계 (절대 제약)

- **fail-open** — 어떤 에러에서도 원본을 그대로 통과시킵니다. 정제가 실패해도 Copilot은 정상 동작.
- **응답 무수정** — 서버→클라(응답/SSE) 스트림은 한 바이트도 건드리지 않습니다.
- **비-text 무수정** — 이미지(`image_url`) 등 텍스트가 아닌 파트는 절대 손대지 않습니다.
- **현재 턴만** — 마지막 입력이 사람(user)이 아닌 루프/툴 턴이면 건드리지 않습니다. 과거 턴도 보존.
- **마커+텍스트만** — `<userRequest>` 안쪽 + `type=="text"`인 텍스트만 교체. 모르는 형식은 통과.

---

## 빠른 시작

> **모든 명령은 git bash에서 실행합니다.** (Windows라면 "Git Bash" 터미널을 여세요. PowerShell/cmd 아님.)
> 1~3번은 **최초 1회만**, 4번은 **프록시를 쓸 때마다** 실행합니다.

### 1) 가상환경(.venv) 만들고 mitmproxy 설치 — 최초 1회
이 프로젝트는 전역 파이썬이 아니라 **프로젝트 안의 `.venv`** 위에서 돕니다.
프로젝트 폴더(`swbc-proxy/`)에서 git bash를 열고:
```bash
python -m venv .venv                                          # .venv 폴더 생성 (이미 있으면 건너뜀)
./.venv/Scripts/python.exe -m pip install -r requirements.txt # mitmproxy 설치
```
> `python`이 안 잡히면 `py -m venv .venv`로 시도하세요. 설치가 끝나면 `.venv/Scripts/mitmdump.exe`가 생깁니다.

### 2) mitmproxy 인증서를 만들고 Node가 신뢰하게 하기 — 최초 1회 (→ VS Code 재시작 1회 필요)
Copilot은 VS Code 확장 호스트(Node.js)의 TLS로 통신합니다. 그래서 **Node가 mitmproxy의 CA 인증서를
신뢰**하게 만들어야 가로챌 수 있습니다.

먼저 인증서를 한 번 생성합니다(프록시를 잠깐 띄웠다 끄면 자동 생성됨):
```bash
./run.sh        # 떴다가 'q' Enter 또는 Ctrl+C로 종료 — ~/.mitmproxy/ 에 인증서가 생깁니다
```
그다음 그 인증서를 Node와 Windows에 등록합니다:
```bash
# 인증서 경로를 Windows 형식 문자열로 변환
cert_pem=$(cygpath -w "$HOME/.mitmproxy/mitmproxy-ca-cert.pem")
cert_cer=$(cygpath -w "$HOME/.mitmproxy/mitmproxy-ca-cert.cer")

# (가장 중요) Node가 mitmproxy CA를 신뢰하도록 영구 설정 — 다음에 새로 뜨는 프로세스부터 적용됨
setx NODE_EXTRA_CA_CERTS "$cert_pem"
export NODE_EXTRA_CA_CERTS="$cert_pem"        # 지금 이 git bash 세션에도 즉시 적용

# Windows 사용자 신뢰 루트에도 등록 (보조 수단, 관리자 권한 불필요)
certutil -user -f -addstore Root "$cert_cer"
```
> `http.proxyStrictSSL: false`만으로는 **부족합니다.** Copilot은 VS Code 프록시 설정을 무시하는 자체 TLS
> 스택을 쓰기 때문에 `NODE_EXTRA_CA_CERTS`가 핵심입니다.
> **이 단계를 마친 뒤 VS Code를 완전히 껐다 켜세요(재시작 1회).** `NODE_EXTRA_CA_CERTS`는 프로세스가
> 뜰 때 한 번만 읽히므로, 재시작 전에는 적용되지 않습니다.

### 3) VS Code가 프록시를 거치도록 설정 — 최초 1회
VS Code에서 `Ctrl+Shift+P` → **"Preferences: Open User Settings (JSON)"** → 아래 두 줄 추가:
```json
{
  "http.proxy": "http://127.0.0.1:8080",
  "http.proxyStrictSSL": false
}
```

### 4) 프록시 실행 — 쓸 때마다
git bash에서:
```bash
./run.sh
```
`run.sh`는 `.venv`의 mitmdump로 애드온을 띄웁니다
(내부적으로 `.venv/Scripts/mitmdump.exe -s refine_copilot.py --allow-hosts 'githubcopilot\.com'` 실행).
`--allow-hosts` 덕분에 **Copilot 호스트만** 가로채고 나머지 트래픽은 손대지 않고 그대로 흘려보냅니다.

**잘 됐는지 확인:** 이 상태로 VS Code Copilot Chat에 아무거나 물어보세요. git bash 콘솔에 `[교체] …`
한 줄이 뜨고, 모델은 질문이 아니라 **`"안녕,클로드"`** 에 답하면 성공입니다(현재는 테스트용 고정 문자열).

**동작 조정(선택):** 환경변수를 앞에 붙여 실행합니다.
```bash
LOG_ENABLED=0 ./run.sh                    # 날짜별 파일 로깅 끄기
./run.sh --listen-port 8081               # mitmdump에 추가 인자 전달 (포트 변경 시 3번 설정도 같이 변경)
```

**끄기:** git bash 창에서 `q` 뒤 Enter, 또는 `Ctrl+C`. 안 쓸 땐 3번의 `http.proxy`를 비워두지 않으면
프록시가 꺼진 동안 Copilot이 동작하지 않을 수 있습니다(아래 [주의](#주의) 참고).

---

## 설정 (환경변수)

모든 튜닝 지점은 환경변수로 조정합니다 (코드 상단 `1) CONFIG` 블록).

| 변수 | 기본값 | 설명 |
|---|---|---|
| `FIXED_REPLACEMENT` | `안녕,클로드` | 정제 서버 연결 전, 교체에 쓸 고정 문자열 |
| `REFINE_API_URL` | `""`(공란) | 정제 서버 엔드포인트. 채우고 `refine_text()` 주석 해제 시 라이브 정제 |
| `REFINE_API_TIMEOUT` | `20` | 정제 서버 호출 타임아웃(초) |
| `LOG_ENABLED` | `1`(on) | 날짜별 파일 로깅 온/오프 (`0/false/off/no`=off) |
| `LOG_DIR` | `logs/`(스크립트 폴더 아래) | 로그 파일을 둘 전용 폴더 (없으면 자동 생성) |
| `LOG_FILE_PREFIX` | `observe-` | 로그 파일명 접두사 |
| `LOG_MAX_CHARS` | `8000` | 로그에 남길 before/after 최대 길이 |
| `COPILOT_HOST_SUBSTRING` | `githubcopilot.com` | 가로챌 호스트 문자열 |
| `COPILOT_RESPONSES_PATH` | `/responses` | GPT(WebSocket) 식별 경로 |

---

## 로그 보기

`LOG_ENABLED`가 켜져 있으면 교체 1건마다 전용 폴더 **`logs/`** 안 **날짜별 파일**에 **JSONL 한 줄**이 쌓입니다.

- 위치: **`logs/` 폴더** (없으면 자동 생성, `LOG_DIR`로 변경 가능).
- 파일명: `observe-YYYY-MM-DD.log` (예: `logs/observe-2026-06-24.log`) — 날짜가 바뀌면 자동으로 새 파일.
- 한 줄 = 완결된 JSON 객체:
```json
{"ts":"2026-06-23T15:04:05","channel":"/responses(ws)","model":"gpt-5-mini","before":"자료구조가 뭔지 3줄로 설명해줘","after":"안녕,클로드"}
```
사람이 읽기에도, 추후 VS Code 확장이 파싱하기에도 좋은 형식입니다.

---

## VS Code 확장으로 보기 (개발 중)

위 로그를 **좌측 사이드바에서 카드로** 보여주는 동반 확장이 [`extension/`](extension/)에 있습니다
(순수 JavaScript, 의존성 0). Copilot의 **답장은 Copilot 채팅 패널에 그대로** 두고, 이 확장은
**원본 -> 정제본**만 보여줍니다("대안 A").

- **개발 실행(Node 불필요)**: VS Code로 **`extension/` 폴더**를 열고 `F5` -> 새로 뜬 창에서
  swbc-proxy 폴더를 열면 **엔진(mitmdump)을 자동 시작**한다(상태바 `Refiner: 켜짐`). 좌측
  **Prompt Refiner** 아이콘 클릭 -> Copilot 채팅을 보내면 카드가 실시간으로 쌓인다.
  - ⚠️ 확장이 엔진을 직접 켜므로 **`run.sh`를 동시에 켜두지 말 것**(포트 8080 충돌).
- **최초 셋업(자동)**: 확장이 처음 뜨면 셋업 안내가 나온다. **[셋업 실행]** 한 번이면
  CA 신뢰(`certutil`/`setx NODE_EXTRA_CA_CERTS`) + `http.proxy` 설정을 자동으로 해 준다.
  마지막에 **VS Code를 완전히 종료 후 재시작 1회**만 사용자가 한다(env가 시작 시 1회만 읽히기 때문).
  즉 위 "빠른 시작"의 2~3번 **수동 셋업을 손으로 할 필요가 없다**(수동 절차는 원리 이해/디버깅용으로 유지).
  - 제목줄 톱니(⚙) 또는 명령 팔레트 `Prompt Refiner: 셋업 실행/상태 보기/되돌리기`로도 실행한다.
- **로그 위치**: 기본은 **확장 전역 저장소**(`globalStorage/logs`) — 엔진과 뷰어가 공유. 다른 위치는
  설정 `swbcPromptRefiner.logDir`로 지정.
- **배포**: **VSIX 사설 공유**(마켓플레이스 아님). `extension/`에서 `./build.sh` 한 줄이면 **standalone
  mitmdump + 애드온을 동봉한 ~26MB 자기완결 `.vsix`**가 만들어진다 — 받는 사람은 파이썬/저장소 없이
  "Install from VSIX" -> 셋업 -> 재시작이면 끝.
- 자세한 사용법은 [`extension/README.md`](extension/README.md), 설계/단계는
  [`docs/VSCODE_EXTENSION_PLAN.md`](docs/VSCODE_EXTENSION_PLAN.md) 참고.

> 현재 **P1(뷰어)+P2(엔진 자동 관리)+P3(셋업 마법사)+P4(UX 다듬기)+P5(엔진 동봉/패키징)+P6(`@refine` 참가자)** 완료. 확장을
> 쓰면 위 "빠른 시작"의 수동 셋업 없이 **[셋업 실행] + 재시작 1회**로 트래픽이 흐른다(아래 "빠른 시작"은
> 프록시를 직접 다루는 경우/원리 이해용). 사이드바 카드는 **차이 강조 토글·긴 본문 펼치기/접기·채널 색
> 구분**을 지원한다.

---

## 정제 서버 연결로 전환

지금은 누가 봐도 동작을 확인할 수 있게 고정 문자열을 넣지만, 실제 정제는 **따로 띄운 서버**가 합니다.
`refine_copilot.py`의 `refine_text()` 안에 두 경로가 있습니다.

1. `REFINE_API_URL`에 서버 주소를 넣습니다.
2. `refine_text()` 안의 **`[정식]` 주석 블록을 해제**하고, 그 아래 `return FIXED_REPLACEMENT` 줄을 제거합니다.
3. 서버 스키마가 다르면 `call_refine_api()` 안의 `(1) 요청` / `(2) 응답` 두 군데만 맞춥니다.

호출은 표준 라이브러리(`urllib`)만 사용하며, 실패 시 원본을 유지합니다(fail-open). 의존성 추가가 없습니다.

---

## 프로젝트 구조

```
swbc-proxy/
├─ refine_copilot.py            # 프록시 본체 (mitmproxy 애드온)
├─ requirements.txt             # 런타임 의존성 (mitmproxy)
├─ run.sh                       # .venv 위에서 프록시 실행하는 런처 (git bash)
├─ .venv/                       # 가상환경 (커밋 제외 권장)
├─ README.md                    # 이 문서
├─ AGENTS.md                    # AI 에이전트용 작업 지침 (Claude 등)
├─ CLAUDE.md                    # Claude Code 자동 로드용 포인터
├─ logs/                        # 날짜별 교체 로그 전용 폴더 (자동 생성, 커밋 제외 권장)
│  └─ observe-YYYY-MM-DD.log    #   교체 1건 = JSONL 한 줄
├─ extension/                   # VS Code 동반 확장(뷰어 + 엔진관리 + 셋업, 순수 JS) - 개발 중
│  ├─ package.json              #   매니페스트(사이드바/명령/설정)
│  ├─ src/                      #   extension.js(진입점)·engine.js(엔진)·config.js(경로)·setup.js(셋업)·logReader.js(JSONL)
│  ├─ media/                    #   icon.svg · main.css · main.js(카드 렌더)
│  └─ .vscodeignore             #   .vsix 패키징 제외 목록(개발엔 영향 없음)
└─ docs/
   ├─ WORKLOG-2026-06-23.md     # 작업 요약(날짜별)
   ├─ WORKLOG-2026-06-24.md
   └─ VSCODE_EXTENSION_PLAN.md  # VS Code 확장 마이그레이션 계획
```

## 기여 / 문서 규칙

이 저장소는 **문서 갱신을 "작업 완료"의 일부로** 취급합니다(docs-as-code). 코드를 바꾸면 같은 작업에서
관련 문서(README · `AGENTS.md` · 날짜별 `docs/WORKLOG-*.md`)도 갱신합니다. 자세한 체크리스트는
[`AGENTS.md`](AGENTS.md)의 "작업 완료 정의(Definition of Done)"를 참고하세요.

---

## 로드맵

- [x] 사람 입력(`<userRequest>`) 가로채기 + 교체 (Claude HTTP / GPT WebSocket)
- [x] 날짜별 JSONL 로깅 (온/오프)
- [x] 정제 서버 호출 배관 (엔드포인트 확정 시 주석 해제)
- [ ] **VS Code 확장으로 패키징** — 사이드바에서 교체 내역 확인 + 원클릭 셋업.
  - [x] P1: 사이드바 뷰어(원본 -> 정제본 카드, JSONL 읽기) — [`extension/`](extension/)
  - [x] P2: 엔진(mitmdump) 자동 기동/종료 + 상태바 토글
  - [x] P3: 셋업 마법사(CA 신뢰 + `http.proxy` 자동 설정 + 재시작 안내 + 되돌리기)
  - [x] P4: UX 다듬기(테마 조화 카드 + 단어 단위 diff 토글 + 펼치기/접기 + 채널 악센트)
  - [x] P5: VSIX 패키징(standalone mitmdump + 애드온 동봉 -> 자기완결 `.vsix`, `build.sh` 한 줄)
  - [x] P6: `@refine` Chat Participant — 우측 Copilot Chat에서 `@refine <프롬프트>` -> 정제본 미리보기 +
        5버튼(allow/try again/use original prompt/modify/cancel) 승인 게이트. 프록시 bypass 마커로 자동 모드와 공존
        ("정제 건너뛰고 전송"의 슬래시는 modify에서만 `@refine /bypass`로 노출). 라이브 손 확인 항목은 PLAN 참고.
        자세히: [`docs/VSCODE_EXTENSION_PLAN.md`](docs/VSCODE_EXTENSION_PLAN.md)

---

## 주의

- 연구·개발용 로컬 도구입니다. 본인의 트래픽을 본인 기기에서 가로채는 용도로만 사용하세요.
- TLS 가로채기 특성상 **CA 신뢰 + VS Code 재시작 1회**는 제거할 수 없습니다(확장으로 만들어도 동일).
- mitmproxy를 끄면 `http.proxy` 설정 때문에 Copilot이 동작하지 않을 수 있으니, 사용하지 않을 땐
  `http.proxy`를 비우거나 프록시를 켜 두세요.
