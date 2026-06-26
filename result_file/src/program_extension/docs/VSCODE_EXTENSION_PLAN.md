# VS Code 확장 마이그레이션 계획

`refine_copilot.py`(mitmproxy 애드온)를 **VS Code 확장**으로 패키징하기 위한 계획서.

## 목표 (UX)

1. **좌측 사이드바 아이콘** — 클릭하면 "어떤 프롬프트가 어떻게 수정되었는지"(before→after) 목록을 본다.
2. **원클릭 셋업** — 사용자가 mitmproxy 설치/CA 신뢰/`settings.json`/`mitmdump` 실행을 손으로 하지 않고,
   확장 설치 + [셋업] 버튼 + **재시작 1회**로 메타프롬프팅이 동작한다.

> **전제(확정):** TLS 가로채기 특성상 **최초 1회 VS Code 재시작은 제거 불가**. 사용자가 허용함.
> 따라서 목표는 "설정 0"이 아니라 "**최초 1회 셋업 마법사 + 재시작 1번, 이후 seamless**"다.

---

## 왜 재시작이 불가피한가 (핵심 제약)

Copilot의 HTTPS 요청은 **확장 호스트(Node) 프로세스**의 TLS 스택을 탄다. Node가 mitmproxy CA를
신뢰하게 하는 `NODE_EXTRA_CA_CERTS`는 **프로세스가 시작되기 전에** 읽힌다. 우리 확장은 바로 그
이미 실행 중인 확장 호스트 안에서 동작하므로, **실행 중에 CA를 주입할 방법이 없다.**

- `http.proxyStrictSSL: false`만으로는 부족 — Copilot은 VS Code 프록시 설정을 무시하는 자체 TLS를 쓴다.
  (현재 수동 레시피에서도 `NODE_EXTRA_CA_CERTS`가 핵심이었음.)
- 따라서 확장이 인증서 등록 + env 영구 설정까지 자동으로 해줘도, **그게 적용되려면 재시작이 필요**하다.

→ 결론: CA 신뢰만 "최초 1회 + 재시작"으로 처리하고, 나머지(프록시 설정·엔진 실행·뷰)는 전부 자동화한다.

---

## 권장 아키텍처 A — "확장 = 컨트롤러 + 뷰어, 파이썬 애드온 = 엔진"

```
┌──────────────────────────── VS Code 확장 (TypeScript/Node) ────────────────────────────┐
│                                                                                          │
│  [Activity Bar 아이콘] ──► WebviewView (사이드바)                                          │
│        ▲                      └─ observe-YYYY-MM-DD.log(JSONL)을 fs.watch로 tail → 카드 표시 │
│        │                                                                                  │
│  [셋업 마법사] (최초 1회)                                                                   │
│     ├─ mitmproxy 확보 (동봉 or 안내 설치) + CA 인증서 생성                                  │
│     ├─ certutil -user -addstore Root  (사용자 신뢰 루트 등록)                               │
│     ├─ setx NODE_EXTRA_CA_CERTS <cert.pem>  (영구 env)                                     │
│     ├─ config.update("http.proxy"/"http.proxyStrictSSL")  (프록시 설정)                    │
│     └─ "VS Code를 재시작하세요" 안내                                                        │
│                                                                                          │
│  [엔진 라이프사이클] activate 시 child_process.spawn ────────────────────┐                 │
│     mitmdump -s refine_copilot.py --allow-hosts 'githubcopilot\.com'    │                 │
└─────────────────────────────────────────────────────────────────────────┼───────────────┘
                                                                            ▼
                                            refine_copilot.py (엔진, 현재 코드 그대로 동봉)
                                            └─ 교체 발생 → observe-YYYY-MM-DD.log 기록 ─┐
                                                                                       │
                                            (사이드바가 이 파일을 읽어 표시) ◄───────────┘
```

**핵심:** 파이썬 애드온을 한 줄도 버리지 않고 엔진으로 재사용한다. 확장은 (a) 셋업, (b) 엔진 기동,
(c) JSONL 로그 뷰어 — 세 가지만 한다. 로그 JSONL은 이미 그 목적으로 설계된 **데이터 계약**이다.

### 대안 B — 순수 Node 확장 (포팅)
가로채기까지 Node MITM 라이브러리로 재구현하면 파이썬 의존이 사라진다. 그러나:
- `<userRequest>` 교체 로직 포팅은 쉬움(작음).
- 하지만 **mitmproxy가 잘 처리하는 HTTP/2 + WebSocket(`/responses`) 가로채기**를 Node로 재현하는
  비용이 크고 위험하다. → **1차 버전은 A 권장**, 패키징 부담이 커지면 B로 이행 검토.

---

## 기능별 실현성

| 기능 | 실현성 | 방법 |
|---|---|---|
| 좌측 아이콘 + 교체 내역 뷰 | ✅ 쉬움 | `contributes.viewsContainers.activitybar` + WebviewView, JSONL tail |
| `http.proxy` 자동 설정 | ✅ 완전 자동 | `workspace.getConfiguration().update(..., Global)` |
| `mitmdump` 실행/종료 | ✅ 완전 자동 | `child_process.spawn`, `deactivate()`에서 종료 |
| mitmproxy 설치 | ✅ 가능(노력) | 바이너리 동봉 또는 셋업 시 설치 안내 |
| **CA 신뢰** | ⚠️ 재시작 1회 | `certutil -user -addstore` + `setx NODE_EXTRA_CA_CERTS` + 재시작 안내 |

---

## 마일스톤

### M1 — 사이드바 뷰어 (엔진은 수동 실행 가정)
- 확장 스캐폴드(`yo code` 또는 수동 `package.json`).
- `contributes`: viewsContainer(아이콘) + view(WebviewView).
- `observe-YYYY-MM-DD.log`를 `fs.watch`로 tail → before/after 카드 렌더(검색·필터 옵션).
- **이 단계만으로도** 기존 수동 프록시 위에서 "교체 내역 보기"가 동작한다(독립적 가치).

### M2 — 엔진 라이프사이클
- `activate()`에서 `mitmdump -s <동봉 refine_copilot.py>` spawn, 출력 채널에 로그 표시.
- 상태바 토글(켜기/끄기), 포트/충돌 처리, `deactivate()` 정리.
- 파이썬/mitmdump 위치 탐지(설정 `swbcProxy.mitmdumpPath`).

### M3 — 최초 셋업 마법사
- 1) mitmproxy CA 확보 → 2) `certutil -user -f -addstore Root` → 3) `setx NODE_EXTRA_CA_CERTS`
  → 4) `http.proxy`/`http.proxyStrictSSL` 설정 → 5) **재시작 안내** 모달.
- 셋업 완료 상태를 `globalState`에 저장해 재실행 방지.
- 비활성화/제거 시 되돌리기(프록시 설정 해제, 안내).

### M4 — 마감
- 정제 서버 연결 설정 UI(`REFINE_API_URL`을 확장 설정으로 노출 → 환경변수로 전달).
- 에러 표면화(인증서/포트/파이썬 부재), 온보딩 문서, 아이콘/브랜딩.

---

## `package.json` 기여점 스케치

```jsonc
{
  "contributes": {
    "viewsContainers": {
      "activitybar": [{ "id": "swbcProxy", "title": "Prompt Refiner", "icon": "media/icon.svg" }]
    },
    "views": {
      "swbcProxy": [{ "id": "swbcProxy.rewrites", "name": "교체 내역", "type": "webview" }]
    },
    "commands": [
      { "command": "swbcProxy.setup",  "title": "Prompt Refiner: 셋업" },
      { "command": "swbcProxy.toggle", "title": "Prompt Refiner: 프록시 켜기/끄기" }
    ],
    "configuration": {
      "properties": {
        "swbcProxy.refineApiUrl":  { "type": "string", "default": "" },
        "swbcProxy.mitmdumpPath":  { "type": "string", "default": "mitmdump" },
        "swbcProxy.logDir":        { "type": "string", "default": "" }
      }
    }
  }
}
```
확장 설정값은 `spawn` 시 환경변수(`REFINE_API_URL`, `LOG_DIR` 등)로 엔진에 전달한다 —
`refine_copilot.py`의 CONFIG는 이미 전부 환경변수 기반이라 **코드 수정 없이 연결**된다.

---

## 데이터 계약 (확장 ↔ 엔진)

엔진이 `record_rewrite()`로 남기는 JSONL 한 줄이 유일한 인터페이스다. 확장은 이걸 읽기만 한다.
```json
{"ts":"2026-06-23T15:04:05","channel":"/responses(ws)","model":"gpt-5-mini","before":"<원본 프롬프트>","after":"<교체된 프롬프트>"}
```
**이 스키마를 바꾸면 확장 뷰가 깨진다.** 변경 시 양쪽을 함께 수정할 것.

---

## 리스크 / 주의

- **CA 정리:** 확장 제거 시 신뢰 루트에 남은 인증서/`NODE_EXTRA_CA_CERTS`를 어떻게 되돌릴지(보안).
- **프록시 잔존:** 엔진이 꺼졌는데 `http.proxy`가 남으면 Copilot이 먹통 → 토글과 정리 로직 필수.
- **mitmproxy 동봉 크기:** 파이썬 런타임 동봉은 무겁다. 설치 안내 vs 동봉 트레이드오프.
- **대안 B 채택 시:** HTTP/2 + WebSocket 가로채기 재구현 난이도가 가장 큰 변수.
- **OS 종속:** 위 셋업은 Windows 기준(`certutil`/`setx`). macOS/Linux는 `security`/`update-ca-*` 등 별도 분기.

---

## 결정 사항

- **아키텍처 A 채택** (파이썬 엔진 재사용). 1차 목표는 M1(뷰어) → M2(엔진) → M3(셋업).
- **최초 1회 재시작 허용** (사용자 확인, 2026-06-23). CA 부트스트랩 한계를 우회하지 않는다.
- 엔진과의 연결은 **환경변수 + JSONL 로그**만 사용 — 결합도를 최소화한다.

---

## 확정 아웃라인 (2026-06-24) — "대안 A" 채택

이날 두 가지가 확정됐다.
1. **과거 대화 정제본 첨부 안은 폐기.** 프록시는 지금처럼 **현재 턴만** 교체한다(절대규칙 #4 유지).
2. **뷰어 범위는 "대안 A"** — 우리 사이드바는 **원본 -> 정제본**만 보여주고, **Copilot의 답장은
   Copilot 자체 채팅 패널에 그대로 둔다.** 즉 프록시는 응답 스트림을 읽지/로깅하지 않는다
   (절대규칙 #2 유지, 스코프 확장 없음). 사용자는 "Copilot 채팅 패널 + 우리 사이드바"를 나란히 보며
   `내가 친 것 -> 프록시가 바꾼 것 -> Copilot 답`을 한 화면에서 확인한다.

> 결과적으로 "답장 캡처"라는 가장 무거운 작업이 빠진다. 우리가 만들 건 **JSONL(before/after) 뷰어 +
> 엔진 자동 기동 + 최초 셋업 마법사**뿐이고, 데이터 계약(JSONL)도 그대로다.

### 설계 원칙: "확장만 받으면 동작" + "어쩔 수 없는 것만 가이드"

목표는 **설정 0이 아니라**, *유저가 손으로 하는 건 [셋업] 버튼 클릭과 재시작 1회뿐*인 상태다.
무엇을 자동화하고 무엇을 가이드할지 명확히 가른다:

| 항목 | 처리 | 유저가 느끼는 것 |
|---|---|---|
| 엔진(mitmdump) 설치 | **동봉(standalone 바이너리)** — 파이썬/ pip 불필요 | 아무것도 안 함 |
| 엔진 실행/종료 | 확장이 `activate`에서 자동 spawn, 종료 시 정리 | 아무것도 안 함 |
| `http.proxy` 설정 | 확장이 `config.update(Global)`로 자동 | 아무것도 안 함 |
| 로그 경로/상태 저장 | 확장 전용 저장소(`globalStorageUri`)로 자동 | 아무것도 안 함 |
| **CA 신뢰 + `NODE_EXTRA_CA_CERTS`** | 마법사가 명령은 자동 실행하되 **재시작은 유저가** | **[셋업] 클릭 + 재시작 1회** |

> "어쩔 수 없는 설정" = **CA 신뢰 + 재시작 단 1회**뿐. 이건 확장 첫 실행 시 뜨는 **셋업 마법사가
> 단계별로 안내**한다(왜 필요한지 1줄 설명 + [실행] 버튼 + 마지막에 "재시작" 모달).

### 단계(Phase) 아웃라인

엔진 동봉 방식이 바뀌었으므로(파이썬 의존 제거) 기존 M1~M4를 아래로 구체화한다.

- **P0 — 저장소 골격 / 동봉 방식 결정**
  - 루트에 파이썬 엔진 유지, `extension/`(TypeScript 확장) 폴더 신설.
  - 엔진은 **mitmproxy standalone `mitmdump` 바이너리를 동봉**(OS별 1개)해 파이썬 의존 제거 →
    "유저는 확장만 설치" 조건 충족. (`refine_copilot.py`는 애드온으로 함께 동봉.)
  - 확장 전용 저장 경로 = `context.globalStorageUri`(예:
    `%APPDATA%/Code/User/globalStorage/<publisher.swbc-proxy>/`) 아래 `logs/`·상태파일.
    엔진엔 `LOG_DIR=<그 경로>`를 env로 넘긴다 → **코드 수정 없이** 현재 CONFIG가 그대로 받는다.

- **P1 — 뷰어 MVP (대안 A 핵심, 독립적 가치)**
  - Activity Bar 아이콘 + `WebviewView`(사이드바).
  - `LOG_DIR/observe-YYYY-MM-DD.log`를 `fs.watch`로 tail → **before -> after 카드** 렌더.
  - 빈 상태 안내, 검색/필터, 복사 버튼, 인라인 diff 토글. 이 단계만으로 기존 수동 프록시 위에서도 동작.

- **P2 — 엔진 라이프사이클 (유저가 `run.sh`를 안 만지게)**
  - `activate()`에서 동봉 `mitmdump` spawn(+env), 출력 채널 표시, 상태바 토글, 포트 충돌 처리,
    `deactivate()`에서 종료 + 프록시 설정 정리.

- **P3 — 최초 셋업 마법사 (유일한 수동 단계, 가이드형)**
  - CA 확보 -> `certutil -user -f -addstore Root` -> `setx NODE_EXTRA_CA_CERTS` ->
    `http.proxy`/`proxyStrictSSL` 설정 -> **재시작 안내 모달**. 완료 상태는 `globalState`에 저장.
  - 제거/비활성화 시 되돌리기(인증서·env·프록시 설정 해제 안내).

- **P4 — UX/UI 조화 패스 (Copilot 채팅과 자연스럽게)**
  - 아래 "UX 조화" 절대 원칙을 적용. 라이트/다크 자동, 테마 토큰 기반, codicon, 카드형 미니멀.

- **P5 — 패키징 & 배포**
  - `vsce package` -> **VSIX**. 배포 결정은 아래 "배포 방식" 참고.

### UX/UI — Copilot 우측 채팅과의 조화 (필수 조건)

VS Code 네이티브 룩을 그대로 차용해 "Copilot 채팅 옆에 원래 있던 패널"처럼 보이게 한다.

- **색/타이포는 전부 테마 토큰**으로: 하드코딩 색 금지, `var(--vscode-*)`
  (`--vscode-editor-background`, `--vscode-foreground`, `--vscode-panel-border`,
  `--vscode-textLink-foreground`, `--vscode-font-family`/`--vscode-font-size`) 사용 → 유저 테마에 자동 적응.
- **아이콘은 codicon**(VS Code 내장)으로 통일 → Copilot/탐색기와 시각적 일관성.
- **레이아웃**: Copilot 말풍선 대비 우리는 "턴 카드" 1장 = `원본` / `정제본` 2단 + 시각 diff,
  상단에 모델·시각 메타. 여백/밀도는 채팅 패널과 맞춰 과하지 않게.
- **마이크로 인터랙션 최소화**: 복사, 펼치기/접기, 검색만. 애니메이션은 절제.
- 배치는 사이드바(Activity Bar) 기본 + 필요 시 하단 패널 옵션. **Copilot 채팅을 가리지 않는 위치**.

### 배포 방식 — 권장: 지금은 VSIX 사설 공유, 추후 마켓플레이스

두 안 중 **현 단계는 (A) VSIX 사이드로드(사설 공유)** 를 택한다.

| 안 | 장점 | 단점 | 적합 시점 |
|---|---|---|---|
| **(A) VSIX 파일 공유** | 게시 심사 없음, 빠른 반복, 동봉 바이너리/CA 자동화에 제약 없음 | 유저가 `.vsix`를 받아 "Install from VSIX" 1회 | **지금(개발/소수 공유)** |
| (B) Marketplace 게시 | "설치" 한 번으로 끝, 자동 업데이트 | 게시 계정·심사, **CA 신뢰/프록시 자동화는 심사에서 민감**, 바이너리 동봉 정책 검토 필요 | 안정화 후 |

> 이유: 이 확장은 본질적으로 **로컬 머신 한정(CA 신뢰·프록시·바이너리 동봉)** 동작이라 마켓플레이스의
> 가치(전세계 배포/자동 업데이트)가 아직 작고, 심사 마찰만 크다. 개발 단계엔 VSIX 한 파일을 건네는 게
> 가장 매끄럽다. 폴리시·서명까지 다듬은 뒤 (B)로 승격한다.

### 배포/공유 시 빼야 할 것 (지금은 전부 유지, 목록만 정리)

> **개발 단계인 지금은 로그·docs·런처 전부 유지.** 아래는 추후 VSIX/공유본을 만들 때 `.vscodeignore`로
> 제외하거나 정리할 후보다(이번에 삭제하지 않는다).

- **에이전트/개발 문서**: `AGENTS.md`, `CLAUDE.md`, `docs/`(WORKLOG·이 계획서) — 최종 사용자에겐 불필요.
- **개발 부산물**: `.venv/`, `_selftest_*.py`, `run.sh`(엔진은 확장이 spawn), `requirements.txt`
  (바이너리 동봉 시 불필요).
- **사용자 데이터**: `logs/`·`observe*.log` — 공유본에 절대 동봉 금지(개인 관측 데이터).
- **테스트 모드 잔재**: `refine_text()`의 고정 문자열 경로(`FIXED_REPLACEMENT`) — 실제 공유 전엔
  정식 서버 경로로 전환돼 있어야 의미가 있다(현재는 의도적으로 고정 문자열, 전환은 사용자 지시 후).

### 기타 검토 사항

- **OS 종속**: 셋업은 Windows 기준(`certutil`/`setx`). mac/Linux는 별도 분기(후순위).
- **CA 정리/보안**: 제거 시 신뢰 루트의 인증서와 `NODE_EXTRA_CA_CERTS`를 되돌리는 경로 필요.
- **프록시 잔존 방지**: 엔진 off인데 `http.proxy`만 남으면 Copilot 먹통 → 토글·정리 로직 필수.
- **JSONL 스키마 동결**: 뷰어가 의존하므로 계약 변경 시 엔진·확장 동시 수정.
- **현재값은 고정 문자열**: 뷰어는 잘 떠도 정제 효과는 서버 전환 후 체감된다(전환은 사용자 지시 후).

### P1 구현 현황 (2026-06-24) — 뷰어 스캐폴드 완료

- 위치 `extension/`. **순수 JavaScript + 의존성 0** -> Node 미설치 환경에서도 `F5`(Extension
  Development Host)로 바로 실행(빌드 단계 없음). `.vsix` 패키징 때만 Node/`vsce` 필요.
  - 빌드 환경 점검: 이 머신엔 **Node 미설치**, VS Code는 설치됨 -> 그래서 TS가 아닌 JS를 택함.
- 파일: `package.json`(activitybar 컨테이너 + webview 뷰 + 명령 2개 + 설정 2개),
  `src/extension.js`(뷰 등록 + `fs.watch` 로그 감시 + 디바운스), `src/logReader.js`(JSONL 파싱, 줄단위
  fail-soft), `media/`(icon.svg, main.css=테마변수, main.js=카드 렌더/검색/복사), `.vscode/launch.json`,
  `.vscodeignore`(아래), `README.md`.
- **로그 폴더 탐색 우선순위**: 설정 `swbcPromptRefiner.logDir`(절대경로) -> `${workspaceFolder}/logs`
  -> `globalStorage/logs`. (P2에서 엔진을 `LOG_DIR=globalStorage`로 띄우면 워크스페이스 무관하게 일치.)
- **로그 파일 매칭은 날짜 필수**(`observe-YYYY-MM-DD.log`)로 좁힘 — 레거시 `observe.log`(옛 OBSERVE
  텍스트 덤프, 73줄)는 스키마가 달라 **읽지 않는다(삭제 아님, 데이터 보존)**.
- **검증**: 매니페스트 JSON 유효성 + 뷰 ID/컨테이너 매칭 확인. `logReader` 로직을 파이썬으로 미러링해
  실제 `logs/`로 돌린 결과 = **6건 파싱, 스킵 0**(채널 Claude/GPT(ws)/GPT(http)). JS 런타임 실행은
  Node 부재로 미수행 -> 실제 동작 확인은 사용자 `F5` 필요.
- `.vscodeignore`: 개발 산출물(.vscode/·node_modules/·*.map 등)만 실제 제외. **루트 개발 파일
  (AGENTS/CLAUDE/docs/.venv/run.sh/requirements/logs/observe*)은 "추후 제외" 주석으로만 기록**
  (extension/에서 패키징하므로 자동 제외, 개발 중엔 유지) — 사용자 결정(2026-06-24) 반영.

**P1 검증 완료(2026-06-24)**: 사용자가 `F5`로 사이드바에 카드 7건 표시 확인. + Node 설치 후 실제
`logReader.js`를 노드로 직접 실행해 파싱 확인.

### P2 구현 현황 (2026-06-24) — 엔진 라이프사이클 완료

- **확장이 `mitmdump`를 직접 spawn/종료**한다(유저가 `run.sh`를 안 켜도 됨). `run.sh`와 동일한 인자
  + `--listen-port` + `LOG_DIR` env만 확장이 제어.
- 새 파일 `src/engine.js`(EngineController: start/stop/toggle, OutputChannel, 상태바, 비정상 종료/포트
  충돌 알림, Windows `taskkill /T /F` 트리 정리) + `src/config.js`(설정/경로 해석 단일화).
- **로그 폴더 단일 소스**: `config.resolveLogDir()` = 설정 `logDir` -> `globalStorage/logs`(기본). 엔진이
  쓰고 뷰어가 읽는 폴더가 항상 같다. **P1의 `${workspaceFolder}/logs` 폴백은 제거**(엔진/뷰어 불일치
  방지 + 사용자 프로젝트 폴더 안 더럽힘). 옛 repo `logs/`를 계속 보려면 `logDir`로 지정.
- 경로 자동탐색: mitmdump = 설정 -> `engine/`(동봉,P5) -> 워크스페이스 `.venv` -> PATH. addon = 설정 ->
  `engine/`(동봉) -> 워크스페이스 루트.
- 새 설정: `autoStart`(기본 true), `listenPort`(기본 8080), `mitmdumpPath`, `addonPath`. 새 명령:
  toggle/start/stop/showEngineOutput. 상태바 좌측 `Refiner: 켜짐/꺼짐` 클릭=토글. 확장 비활성화 시
  `dispose()`로 프로세스 정리.
- **범위 밖(여전히 P3)**: `http.proxy`/CA 자동 설정은 안 한다 -> 지금은 수동 셋업이 한 번 돼 있어야 흐름.
- **검증**: 4개 JS `node --check` 통과; `package.json` 유효(v0.2.0, 명령 6/설정 6); **엔진 spawn 스모크
  테스트**(engine와 동일 명령으로 venv mitmdump를 포트 8099+temp LOG_DIR로 띄움 -> 2.5s 생존=포트바인딩
  /애드온로드 OK -> `taskkill /T /F` 정상 종료). webview UI/실트래픽 교체는 사용자 `F5` 확인.
- **주의(사용자 안내)**: `run.sh`와 확장 자동시작을 **동시에 켜면 포트 8080 충돌** -> 확장이 곧바로
  종료되며 알림. run.sh를 끄거나 `autoStart=false`로.

**다음(P3)**: 셋업 마법사 — `certutil`/`setx NODE_EXTRA_CA_CERTS`/`http.proxy` 설정 + 재시작 안내.

### P3 구현 현황 (2026-06-24) — 셋업 마법사 완료

- **"어쩔 수 없는 수동 셋업"(CA 신뢰 + 프록시)을 [셋업] 버튼 하나로 자동화.** 사용자가 손으로 하는 건
  이제 **[셋업 실행] + VS Code 재시작 1회**뿐 -> 계획의 "원클릭 셋업 + 재시작 1번" 목표 달성.
- 새 파일 `src/setup.js`(`SetupWizard`):
  - `run()`: (1) 인증서 확인(`~/.mitmproxy/mitmproxy-ca-cert.pem` 기준, 없으면 엔진을 잠깐 띄워 생성 후
    최대 12초 폴링) -> (2) `certutil -user -f -addstore Root <cer>`(보조) -> (3) `setx
    NODE_EXTRA_CA_CERTS <pem>`(핵심) -> (4) `http.proxy=127.0.0.1:<포트>`+`proxyStrictSSL=false`
    (`getConfiguration("http").update(..., Global)`) -> (5) **재시작 모달**. 완료는 `globalState`에 저장.
  - `cleanup()`(되돌리기): `certutil -user -delstore Root mitmproxy` + `reg delete HKCU\Environment /v
    NODE_EXTRA_CA_CERTS /f` + 프록시 해제 + 완료표시 해제.
  - `showStatus()`: 인증서 파일 / 영구 env(`reg query`) / 현재 적용(`process.env.NODE_EXTRA_CA_CERTS`) /
    `http.proxy` / 완료표시를 한눈에. `maybePromptFirstRun()`: 미설정 시 최초 1회 안내(‘다시 보지 않기’ 지원).
- **재시작이 불가피한 이유(코드에 반영)**: `NODE_EXTRA_CA_CERTS`는 프로세스 시작 시 1회만 읽혀, 창
  새로고침(`reloadWindow`)으론 부족 -> 모달은 **완전 종료**(`workbench.action.quit`)를 권한다. 현재
  세션 적용 여부는 `process.env.NODE_EXTRA_CA_CERTS` 유무로 정확히 표시.
- **프록시 잔존(먹통) 방지**(계획 리스크 반영): 사용자가 엔진을 끄면(`stopEngine`/`toggleEngine`)
  `http.proxy`가 127.0.0.1을 가리킬 때 **"프록시 해제?"**를 물어 `clearProxyOnly()`로 즉시 해제 가능.
  단, 확장 종료(`dispose()->stop()`) 경로는 경고하지 않는다(어차피 VS Code가 닫히는 중).
- **안전/절대규칙 유지**: 모든 외부 명령은 `_exec()`로 감싸 **throw 금지(fail-open)**. `certutil`/`reg`
  실패는 보조라 계속, `setx` 실패만 셋업 중단. 정제 엔진(`refine_copilot.py`)은 **일절 미수정** -
  P3는 OS/에디터 설정만 만진다(응답·정제 로직 불변).
- `package.json`: 명령 3개(setup/setupStatus/cleanupSetup), 제목줄 톱니(⚙=setup) navigation@4,
  버전 0.2.0 -> 0.3.0. P2 누락분 정정: `logDir` 설명을 실제 동작(globalStorage 단일)으로.
- **OS 종속**: Windows만(certutil/setx/reg). mac/Linux는 경고만 띄우고 무동작(후순위 분기).
- **검증**: 6개 JS `node --check` 통과 + `package.json` 유효(v0.3.0/명령 9). **셀프테스트
  `_selftest_setup.js`**(vscode 스텁 주입): 인증서 경로 해석 / `reg` 출력 파싱(계약) / `isProxyConfigured`
  분기 / `_persistedEnv` 실호출 fail-open = **9/9 통과**. 영구 env가 실제 `...mitmproxy-ca-cert.pem`으로
  읽혀 라이브 레지스트리 파싱까지 확인. 검증 후 셀프테스트만 삭제. 실 셋업/재시작 흐름은 사용자 `F5` 확인.

**다음(P4/P5)**: UX 다듬기(P4) / VSIX 패키징(P5: mitmdump 바이너리 + 애드온 동봉, `.vscodeignore` 제외
적용, 공유 전 `FIXED_REPLACEMENT`->서버 전환).

### P4 구현 현황 (2026-06-24) — UX 조화 패스 완료

위 "UX/UI — Copilot 우측 채팅과의 조화" 원칙을 사이드바 카드에 적용. **의존성 0 유지**가 핵심 제약이라
codicon 폰트를 동봉하지 않고 **인라인 SVG 아이콘**(`currentColor`로 테마색 상속)으로 대체했다.

- **단어 단위 diff 토글("차이 강조")**: `tokenize()`(공백 보존 분리) + `diffTokens()`(LCS DP, `n*m`
  가드로 병적 입력 시 통째 교체로 폴백)로 원본=삭제·정제본=추가 토큰만 강조. 공백 토큰은 강조 안 함.
  diff 강조 중엔 정제본 블록 배경을 중립으로 바꿔(`.block.after.diff`) 토큰 색과 안 겹치게. 고정 문자열
  모드에선 "통째 교체"로 보이고, 서버 정제 전환 시 진짜 편집 지점이 드러난다.
- **펼치기/접기**: 렌더 후 `scrollHeight`로 넘침을 측정해 132px 초과 블록만 `더 보기` 노출(좁은 사이드바
  밀도 유지). 클램프 하단 페이드는 블록별 배경 토큰으로.
- **복사 피드백**: 블록별 아이콘 버튼, 누르면 체크 아이콘+`.ok` 1.2초.
- **채널 구분**: 카드 좌측 3px 악센트 = `--vscode-charts-purple/green/yellow`(테마 제공색, 라이트/다크
  모두 가독) — Claude/GPT/BG. 배지·호버 테두리도 정리. **하드코딩 색 0**, 전부 `var(--vscode-*)`.
- **건수 표시**: 툴바 우측 `N건`(검색 중이면 `보임 / 전체`).
- 변경 파일: `media/main.js`·`media/main.css` 재작성, `src/extension.js` 툴바에 `#count`/`#diffToggle`
  추가(CSP 불변 - 인라인 style/script 없음, SVG는 DOM 생성). `package.json` 0.3.0 -> 0.4.0(UI만).
- **검증**: 6 JS `node --check` + 웹뷰 참조 id(search/count/diffToggle/list/empty) HTML 존재 확인 +
  **diff 알고리즘 셀프테스트 `_selftest_diff.js`**(main.js와 동일 구현 이식): 동일/추가/치환/완전교체 +
  **재구성 불변식** = **11/11 통과**. webview IIFE라 직접 import 불가 -> 실제 렌더는 사용자 `F5` 확인.
  검증 후 셀프테스트만 삭제.

**다음(P5)**: VSIX 패키징 — mitmdump standalone 바이너리 + `refine_copilot.py`를 `extension/engine/`에
동봉(빌드 시 복사), `.vscodeignore` 제외 적용, `npx @vscode/vsce package`. 실제 공유 전 `refine_text()`를
고정 문자열에서 정식 서버 경로로 전환(사용자 지시 후).

### P5 구현 현황 (2026-06-24) — 엔진 동봉 / 자기완결 vsix 완료

"확장만 설치" 목표 달성. 받는 사람은 파이썬/저장소 없이 **vsix 설치 -> 셋업 -> 재시작**이면 끝.

- **standalone mitmdump 동봉**: `downloads.mitmproxy.org/12.2.3/mitmproxy-12.2.3-windows-x86_64.zip`(85MB,
  `requirements.txt`와 동일 버전)에서 **`mitmdump.exe`(27.5MB)만 추출** -> `extension/engine/`.
  자기완결 검증: `mitmdump.exe --version` = `Mitmproxy: 12.2.3 binary / Python: 3.14.4`(바이너리 내장
  파이썬, venv 3.13.13 아님) -> **Python 설치 불필요**.
- **애드온 동봉**: 루트 `refine_copilot.py` -> `engine/refine_copilot.py`(build.sh가 매 빌드 복사 = 항상 동기화).
- **런타임 연결은 기존 그대로**: `config.resolveMitmdump`/`resolveAddon`가 이미 `extensionUri/engine/`를
  1순위로 탐색 -> **코드 수정 없이** 설치본이 동봉 엔진을 찾는다(워크스페이스 안 열어도 됨). 엔진 로그는
  여전히 `LOG_DIR=globalStorage/logs`로 빠진다(설치 폴더 오염/권한 문제 없음).
- **build.sh 확장**: `ensure_engine`(애드온 복사 + `engine/mitmdump.exe` 없으면 zip 다운로드 후 `mitmdump.exe`
  만 추출, 캐시) + `--refresh-engine`(강제 재다운로드) + 기존 `--install`. `.vscodeignore`에 `engine/**/*.zip`
  안전장치(임시 zip 제외); `engine/mitmdump.exe`·`refine_copilot.py`는 포함.
- **`engine/`은 빌드 산출물**(루트 `.gitignore`의 `extension/engine/`) - 저장소엔 안 들어가고 build.sh가 채운다.
  애드온 수정은 **루트본만**(AGENTS.md §5에 명시).
- `package.json` 0.4.0 -> 0.5.0.
- **검증**: 동봉 바이너리 standalone `--version` OK + **스모크 `_selftest_engine_bundle.js`**(동봉
  `mitmdump.exe -s engine/refine_copilot.py --listen-port 8097`: 애드온 로드 + 포트 바인딩 + 3s 생존 =
  **PASS**, 검증 후 부산물/셀프테스트 정리). `./build.sh` 재빌드 -> **vsix에 engine/mitmdump.exe(26.24MB) +
  engine/refine_copilot.py 포함, 총 ~25.7MB** 확인.

**남은 것**: (1) 실제 공유 전 `refine_text()` 고정문자열 -> 정식 서버 전환(사용자 지시 후). (2) 다른 PC에서
실 설치/셋업/공유 테스트. (3) mac/Linux 엔진·셋업(후순위). 마켓플레이스 승격은 안정화 후.

---

## P6 (구현 완료) — `@refine` Chat Participant: 확인형(승인 게이트) 정제

> **상태: 구현 완료(2026-06-25, v0.6.0).** 사용자 스펙(2026-06-24) + "modify만 `/bypass`" 최종 승인(2026-06-25) 반영.
> 코드: `extension/src/chat.js`(참가자+5버튼+명령), `extension/src/refiner.js`(JS 정제+마커),
> `refine_copilot.py`의 `BYPASS_MARKER`/`strip_bypass_marker`(프록시 bypass). `package.json`에
> `contributes.chatParticipants` 추가, `engines.vscode ^1.90.0`로 상향.

### 목표

VS Code **우측 Copilot Chat** 창에서 `@refine <프롬프트>`(예: `@refine 1+1이뭐야?`)를 치면:
1. 유저 프롬프트를 **기존 refiner처럼 정제**하고,
2. **정제본을 미리 보여주며** 버튼으로 승인/재생성/수정/취소를 묻고,
3. 클릭에 따라 동작한다. 기존 **"Refiner 켜짐/꺼짐"(전역 자동 정제)** 은 그대로 두고, `@refine`는
   **명시적·턴 단위·확인형** 보조 모드로 **공존**한다(아래 'bypass 마커'로 자동 프록시와 충돌 없이 동시 사용 가능).

### 버튼 5개 (확정 스펙)

| 버튼 | 동작 | 프록시 정제 | 답(코파일럿) |
|---|---|---|---|
| **allow** | 정제본을 코파일럿에 전송 | **안 함(bypass)** | 정제본에 대한 평소 코파일럿 답 |
| **try again** | **정제 안 된 원본**으로 다시 정제 -> 미리보기+버튼 재표시 | - | (전송 전) |
| **use original prompt** | 원본을 그대로 코파일럿에 전송(정제 없음) | **안 함(bypass)** | 원본에 대한 평소 답 |
| **modify** | 정제본을 **채팅 입력창에 내려** 유저가 약간 수정 -> 엔터 시 **allow와 동일**(bypass 후 코파일럿) | **안 함(bypass)** | 수정된 정제본에 대한 답 |
| **cancel** | **원본만** 입력창에 내림. 유저 수정 후 엔터 시 **처음 `@refine` 호출과 동일 취급**(다시 `@refine` 흐름) | (다시 정제) | (재진입) |

> 이름 변경: 기존 "use my prompt" -> **"use original prompt"**.

### 슬래시 명령 컨벤션 (확정 — "modify만 /bypass")

VS Code chat participant의 관용(슬래시는 '서브 모드', 맨 호출이 기본)을 따른다. 슬래시는 **딱 하나**(`/bypass`)만 두되,
**그 슬래시를 실제로 쓰는 길은 modify 하나뿐**이다(allow/use-original은 확장이 마커를 직접 붙여 슬래시 없이 전송).

| 입력 | 의미 | 누가 |
|---|---|---|
| `@refine <프롬프트>` | **기본**: 정제 -> 미리보기 -> 5버튼 (슬래시 없음) | 유저(직접 타이핑) / cancel·try again(프로그램적) |
| `@refine /bypass <텍스트>` | 입력창에 시드된 '확정 텍스트'를 정제 없이 전송 | **modify만**(입력창 시드, 유저가 보고 편집) |

- **정제 건너뛰고 전송**(allow / use original prompt): 버튼 명령이 `refiner.attachBypass()`로 **마커를 직접 부착**해
  `workbench.action.chat.open({ query })`로 네이티브 코파일럿에 바로 제출한다(참가자/슬래시 경유 안 함, 유저는 마커도 슬래시도 못 봄).
- **modify**: 입력창에 `@refine /bypass <정제본>`을 **시드**(`isPartialQuery:true`, 전송 안 함) -> 유저가 보고 편집 ->
  엔터 시 참가자 `/bypass` 핸들러가 같은 `attachBypass()`로 마커 부착해 전송. **`/bypass`가 실제로 쓰이는 유일한 경로.**
- **cancel**: 입력창에 `@refine <원본>`(슬래시 없음) 시드 -> 엔터 시 **기본 흐름 재진입**(자연히 재정제).
- **try again**: `@refine <원본>`을 **자동 전송**(`isPartialQuery` 없음) -> 기본 흐름 재진입 -> 새 미리보기 턴.
- **`/send`는 두지 않는다**: 기본 진입이 곧 슬래시 없는 `@refine`라 별도 `/send`는 불필요/비관용적.
  최종적으로 슬래시가 노출되는 곳은 modify 시드뿐이라, "modify만 `/bypass`"로 확정(2026-06-25 사용자 승인).

### 아키텍처

- **Chat Participant API**(정식): `vscode.chat.createChatParticipant("swbc.refine", handler)` +
  `contributes.chatParticipants`(id `swbc.refine`, name `refine` -> `@refine`로 호출). 핸들러에서
  `request.prompt`(=`@refine ` 뒤 텍스트)·`request.command`(`bypass` 또는 없음)을 받아 정제하고,
  `stream.markdown`(미리보기) + `stream.button`(5개, 각 버튼=명령+인자)로 렌더.
- **정제는 확장 호스트(JS)에서**: 고정 문자열이면 그대로, 서버 모드면 JS가 정제 서버를 HTTP 직접 호출
  (프록시/파이썬 불필요). `engines.vscode`를 `^1.90+`로 상향. **정식 API만 사용**(proposed 금지 -> 공유 vsix 동작).
- **전송은 네이티브 코파일럿에 위임(B방식)**: 승인 시 `workbench.action.chat.open({ query })`로 텍스트를
  일반 채팅에 제출 -> **평소 코파일럿(에이전트/툴 포함)이 답**.

### 핵심 과제 = 프록시 bypass (구현됨)

`@refine`가 이미 정제한 텍스트를 코파일럿에 보내면, **자동 프록시가 또 정제**(이중)한다. 이를 막는 bypass:

- **bypass 마커(sentinel)**: `refine_copilot.py`의 `BYPASS_MARKER`(zero-width 5자: `U+200B U+2063 U+2060 U+2063 U+200B`).
  확장 `src/refiner.js`의 `BYPASS_MARKER`/`attachBypass()`가 **같은 코드포인트**로 텍스트 앞에 심는다.
  프록시는 교체값을 정하는 단일 지점 `refine_text()`에서 `strip_bypass_marker()`로 마커를 보면 -> **마커만 제거하고
  원문 그대로 반환(정제 안 함)**. `refine_text()`가 messages[]·input[]·WS **모든 현재-턴 경로의 refiner**이므로
  한 곳만 고쳐 전 경로 커버. allowlist 철학의 연장("표시된 것=이미 처리됨=통과")이며 fail-open 유지.
  - 장점: **자동 Refiner를 켜둔 채로도** `@refine` 메시지만 정제를 건너뛰어 둘이 깨끗이 공존.
- 버튼별 구현(슬래시 컨벤션은 위 표 참고 — 슬래시 노출은 modify뿐):
  - **allow / use original prompt**(`src/chat.js` `sendBypassed`): `attachBypass()`로 마커 직접 부착 ->
    `workbench.action.chat.open({ query })` 자동 전송(슬래시/참가자 경유 안 함).
  - **modify**: `seedInput("@refine /bypass <정제본>")`(`isPartialQuery:true`) -> 유저 편집 후 엔터 ->
    참가자 `/bypass` 핸들러가 같은 `attachBypass()`로 전송.
  - **cancel**: `seedInput("@refine <원본>")` -> 엔터 시 기본 흐름 재진입(자연히 재정제).
  - **try again**: `@refine <원본>` 자동 전송 -> 기본 흐름 재진입 -> 새 미리보기.

### 검증 / 리스크 / 라이브 확인 필요

- **검증됨(2026-06-25)**: 프록시 bypass 순수 로직(`_selftest_bypass.py`, 폐기) -> messages[]·input[] 양 경로에서
  마커 부착 시 정제 건너뛰고 마커 제거, 마커 없으면 평소대로 고정 문자열 교체. JS/PY 마커 코드포인트 일치 확인.
  `node --check`로 3개 JS 구문 통과. `build.sh --install`로 v0.6.0 vsix 패키징·설치(engine/refine_copilot.py 동봉 갱신 확인).
- refine_copilot.py **절대 제약 5개 불변**: bypass는 "마커=통과" allowlist 확장일 뿐(응답·비-text·과거 턴·fail-open 무영향).
- **라이브에서 확인할 것(Extension Development Host / 설치본)**:
  1. `@refine`가 Copilot Chat에 참가자로 뜨고 미리보기+5버튼이 렌더되는지.
  2. `workbench.action.chat.open`의 `{ query }` 자동 전송 vs `{ query, isPartialQuery:true }` 입력창만 채우기가
     설치된 VS Code 버전에서 기대대로 동작하는지(allow=전송 / modify·cancel=채우기).
  3. **마커 생존**: zero-width 마커가 입력창->요청 본문까지 살아남는지. 만약 정규화로 사라지면 bypass가 무력화돼
     **이중 정제**가 되지만 fail-open이라 Copilot은 정상 동작(정제만 한 번 더 됨). 그 경우 `REFINE_BYPASS_MARKER`
     환경변수(프록시) + `src/refiner.js`의 마커를 **가시 토큰**으로 함께 바꾸면 됨.
- **try again 재생성**: 고정 문자열 모드에선 매번 동일(서버 연결 후 체감).

**완료**: 구현·패키징·설치까지 끝. 남은 것은 위 '라이브 확인' 3가지(실제 Copilot Chat에서 손으로 확인).
