# Prompt Refiner (VS Code 확장)

`swbc-proxy`의 동반 VS Code 확장. Copilot에 보낸 **원본 프롬프트 -> 정제된 프롬프트**를
좌측 사이드바에서 카드로 보여준다. Copilot의 **답장**은 Copilot 채팅 패널에 그대로 두는
"대안 A" 설계 — 이 확장은 응답을 가로채거나 저장하지 않는다.

> 진행 단계: **P1(뷰어)+P2(엔진 자동 관리)+P3(셋업 마법사)+P4(UX 다듬기)+P5(엔진 동봉/패키징) 완료.**
> 확장이 `mitmdump`를 직접 켜고/끄며 교체 내역을 사이드바에 보여주고, **CA 신뢰 + `http.proxy` 설정도
> [셋업] 버튼으로 자동화**한다. `.vsix`에 **standalone mitmdump + 애드온을 동봉**하므로 받는 사람은 파이썬/
> 저장소 없이 **설치 -> [셋업 실행] -> 재시작 1회**면 끝(아래 "최초 셋업" / ".vsix 패키징" 참고).

## 구성

```
extension/
├─ package.json        # 매니페스트(사이드바 / 명령 / 설정)
├─ src/
│  ├─ extension.js     # 진입점: 사이드바 등록 + 엔진/뷰어/셋업 연결
│  ├─ engine.js        # mitmdump 자식 프로세스 start/stop/toggle + 상태바
│  ├─ config.js        # 설정/경로 해석(로그 폴더 · mitmdump · 애드온 · 포트)
│  ├─ setup.js         # 셋업 마법사(CA 신뢰 + 프록시 설정 + 재시작 안내 + 되돌리기)
│  └─ logReader.js     # observe-*.log(JSONL) 읽기/파싱
├─ media/              # icon.svg · main.css(테마 적응) · main.js(카드 렌더)
├─ engine/             # [빌드 산출물, gitignore] 동봉 엔진 - mitmdump.exe(standalone) + refine_copilot.py
├─ build.sh            # .vsix 패키징 런처(git bash) - 엔진 준비 + 패키징/설치 한 줄
├─ .vscode/launch.json # F5 실행 설정
└─ .vscodeignore       # .vsix 패키징 제외 목록(개발엔 영향 없음)
```

## 빠르게 써 보기 (F5, Node 불필요)

확장은 **의존성 0의 순수 JS**라 `npm install` 없이 실행된다. (`.vsix` 패키징 때만 Node 필요 — 이미 설치됨.)

1. VS Code로 이 **`extension/` 폴더**를 연다.
2. `F5` -> **Extension Development Host** 새 창이 뜬다.
3. 새 창에서 **swbc-proxy 폴더를 열면** 엔진 경로(`.venv` / `refine_copilot.py`)를 자동으로 찾는다.
4. 확장이 켜지면 **엔진을 자동 시작**한다(상태바 좌측 `$(broadcast) Refiner: 켜짐`).
   - ⚠️ **`run.sh`를 동시에 켜두지 말 것** — 같은 포트(8080)를 두고 충돌한다. 이제 확장이 그 역할을 대신한다.
5. 좌측 **Prompt Refiner** 아이콘 클릭 -> Copilot 채팅을 보내면 카드가 실시간으로 쌓인다.

> 로그는 기본적으로 **확장 전역 저장소**(`globalStorage/logs`)에 쌓인다(사용자 프로젝트 폴더를 더럽히지
> 않음). 엔진(`LOG_DIR`)과 뷰어가 이 폴더를 공유한다. 다른 위치를 쓰려면 설정 `logDir`에 절대경로를 지정.
>
> 그래서 P1 때 보던 swbc-proxy의 `logs/`(수동 run.sh 기록)와는 다른 폴더다 — 옛 기록을 계속 보고 싶으면
> `logDir`에 그 `logs` 경로를 지정하면 된다.

## 카드 보기 (사이드바)

각 교체는 카드 1장 = **원본 -> 정제본**으로 쌓이며, 색/폰트는 전부 VS Code 테마 변수라 라이트/다크와
Copilot 채팅에 자동으로 맞춰진다.

- **검색**: 상단 입력창에 치면 원본/정제본/모델/채널을 즉시 필터. 우측에 현재 건수(`N건`, 검색 시 `보임 / 전체`).
- **차이 강조** 토글: 켜면 원본/정제본을 **단어 단위로 비교**해 바뀐 부분만 강조(삭제=취소선/추가=강조).
  지금은 고정 문자열 모드라 "통째 교체"로 보이고, 서버 정제로 전환하면 진짜 편집 지점이 드러난다.
- **펼치기/접기**: 긴 프롬프트는 접혀 있고 `더 보기`로 펼친다(좁은 사이드바 밀도 유지).
- **복사**: 각 블록의 아이콘 버튼으로 원본/정제본을 클립보드에 복사(누르면 체크로 잠깐 피드백).
- **채널 구분**: 카드 좌측 색 띠 — Claude(보라)/GPT(초록)/BG(노랑), 배지로도 표기.

## 최초 셋업 (자동, Windows)

엔진이 트래픽을 실제로 가로채려면 **Node/Copilot가 mitmproxy CA를 신뢰**하고 **VS Code가 프록시를 거쳐야** 한다.
이걸 손으로 하던 절차(루트 README "빠른 시작" 2~3번)를 **셋업 마법사가 대신** 한다.

- 확장이 처음 뜨면 **셋업 안내**가 나온다(또는 제목줄 ⚙ 아이콘 / 명령 `Prompt Refiner: 셋업 실행`).
- **[셋업 실행]** 하면 순서대로 자동 처리한다:
  1. mitmproxy 인증서 확인(없으면 엔진을 잠깐 띄워 생성).
  2. `certutil -user -f -addstore Root` — Windows 사용자 신뢰 루트에 등록(보조).
  3. `setx NODE_EXTRA_CA_CERTS <cert.pem>` — Node가 CA를 신뢰하게(핵심).
  4. `http.proxy = http://127.0.0.1:<포트>` + `http.proxyStrictSSL = false` 설정.
- 마지막에 **"VS Code 완전 종료 후 재시작"** 모달이 뜬다. `NODE_EXTRA_CA_CERTS`는 프로세스가 뜰 때 한 번만
  읽히므로 **재시작 1회는 불가피**하다(창 새로고침으론 부족 — 완전히 껐다 켠다).

> 명령 팔레트: `Prompt Refiner: 셋업 상태 보기`(현재 인증서/env/프록시 상태), `Prompt Refiner: 셋업 되돌리기`
> (인증서 제거 + `NODE_EXTRA_CA_CERTS` 삭제 + 프록시 해제).
>
> ⚠️ 엔진을 끄면 `http.proxy`가 남아 Copilot이 먹통이 될 수 있다. 사용자가 엔진을 끌 때 확장이
> **"프록시 해제?"**를 물어본다. macOS/Linux 자동 셋업은 아직(수동 절차 참고).

## 엔진 켜고/끄기

- **상태바**의 `Refiner: 켜짐/꺼짐`을 클릭하면 토글.
- **명령 팔레트**: `Prompt Refiner: 엔진 켜기/끄기`, `Prompt Refiner: 엔진 출력 보기`.
- **사이드바 제목줄** 아이콘: 새로고침 / 로그 폴더 열기 / 엔진 출력 보기 / 셋업(⚙).

## 설정

| 설정 키 | 기본값 | 설명 |
|---|---|---|
| `swbcPromptRefiner.autoStart` | `true` | 확장 활성화 시 엔진 자동 시작 (수동 `run.sh`를 쓰면 끄기) |
| `swbcPromptRefiner.listenPort` | `8080` | 엔진(mitmdump) 포트 — VS Code `http.proxy`와 같아야 함 |
| `swbcPromptRefiner.mitmdumpPath` | `""` | mitmdump 경로(비우면 동봉 -> 워크스페이스 `.venv` -> PATH 자동탐색) |
| `swbcPromptRefiner.addonPath` | `""` | `refine_copilot.py` 경로(비우면 동봉 -> 워크스페이스 자동탐색) |
| `swbcPromptRefiner.logDir` | `""` | 로그 폴더 절대경로(비우면 `globalStorage/logs`) |
| `swbcPromptRefiner.maxEntries` | `200` | 사이드바에 표시할 최근 건수 상한 |

## .vsix 패키징 / 설치

배포는 **VSIX 사설 공유**(마켓플레이스 게시 아님). 코드 수정 후 **한 줄**이면 **자기완결** `.vsix`가 만들어진다.

```bash
./build.sh                  # 엔진 준비(없으면 다운로드) + 패키징 -> swbc-prompt-refiner-<version>.vsix
./build.sh --install        # 위 + 현재 VS Code에 강제 설치(code --install-extension --force)
./build.sh --refresh-engine # mitmdump 바이너리를 강제로 다시 받은 뒤 패키징
```

`build.sh`는 (1) `refine_copilot.py`를 저장소 루트에서 `engine/`로 복사(항상 동기화), (2) `engine/mitmdump.exe`가
없으면 **standalone mitmdump(12.2.3) 85MB zip을 받아 `mitmdump.exe`만 추출**(파이썬 불필요, 한 번 받으면 캐시),
(3) `npx --yes @vscode/vsce package`로 묶는다. 결과 vsix는 **~26MB**(엔진 바이너리 포함). 받는 사람은 VS Code에서
**Extensions: Install from VSIX...** 로 설치 -> 셋업 -> 재시작이면 끝(파이썬/저장소 불필요).

> **개발 중엔 vsix가 필요 없다.** F5로 띄운 Extension Development Host 창에서 `Ctrl+R`(Reload Window)면
> 코드 변경이 바로 반영된다. vsix는 *내 실제 VS Code에 설치*하거나 *남에게 공유*할 때 만든다.
>
> **같은 버전 재설치**는 `--install`(=`--force`)이 처리한다. 다른 사람에게 "업데이트"로 인식시키려면
> `package.json`의 `version`을 올려라(VS Code는 같은 버전을 업데이트로 보지 않는다).
>
> `engine/`은 **빌드 산출물**(gitignore 대상)이라 저장소엔 안 들어간다 - `build.sh`가 채운다. 애드온은
> **루트 `refine_copilot.py`만 수정**하면 다음 빌드에서 자동 복사된다(engine/ 사본을 직접 고치지 말 것).
>
> ⚠️ 실제 공유 전, `refine_copilot.py`의 `refine_text()`를 고정 문자열(`FIXED_REPLACEMENT`)에서 정식 정제
> 서버 경로로 전환해야 의미가 있다(현재는 테스트용 고정 문자열, 전환은 사용자 지시 후).

> 데이터 계약: 확장은 엔진이 남기는 JSONL 한 줄
> `{"ts","channel","model","before","after"}` 만 읽는다. 스키마가 바뀌면 뷰가 깨지므로
> 엔진(`refine_copilot.py`)과 확장을 함께 수정할 것.
