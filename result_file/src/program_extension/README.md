# Prompt Refiner (VS Code 확장)

VS Code **Copilot Chat**에 `@refine`를 추가하는 확장. `@refine <프롬프트>`로 부르면 입력을 **정제해
미리 보여주고**, 5버튼으로 확인을 받아 **네이티브 Copilot에 보낸다**. 보낸 정제 내역은 좌측 사이드바에
**원본 -> 정제본** 카드로 쌓인다.

> **확장 단독 구조** — mitmproxy 프록시·CA 신뢰·`http.proxy`·파이썬이 **필요 없다**. 설치하고 Reload만 하면 끝.
> (원래 프록시와 함께 개발되다 확장 단독으로 전환됐다. 옛 프록시 이력은 원본 `swbc-proxy` 저장소에만 있다.)

## 구성

```
extension/
├─ package.json        # 매니페스트(@refine 참가자 / 사이드바 / 명령 / 설정)
├─ src/
│  ├─ extension.js     # 진입점: 사이드바 등록 + @refine 참가자 등록
│  ├─ chat.js          # @refine 참가자: 정제 미리보기 + 5버튼 + 전송
│  ├─ refiner.js       # 유일한 refiner(고정문자열 / 주석된 서버 호출)
│  ├─ logger.js        # allow 시 observe-YYYY-MM-DD.log(JSONL) 기록
│  ├─ config.js        # 로그 폴더 · 최대 건수 해석
│  └─ logReader.js     # observe-*.log(JSONL) 읽기/파싱
├─ media/              # icon.svg · main.css(테마 적응) · main.js(카드 렌더)
├─ build.sh            # .vsix 패키징 런처(git bash)
├─ .vscode/launch.json # F5 실행 설정
└─ .vscodeignore       # .vsix 패키징 제외 목록(개발엔 영향 없음)
```

## 빠르게 써 보기 (F5, Node 불필요)

확장은 **의존성 0의 순수 JS**라 `npm install` 없이 실행된다. (`.vsix` 패키징 때만 Node 필요 — 이미 설치됨.)

1. VS Code로 이 **`extension/` 폴더**를 연다.
2. `F5` -> **Extension Development Host** 새 창이 뜬다.
3. 그 창의 우측 **Copilot Chat**에서 `@refine 1+1이 뭐야?` 입력 -> 정제본 미리보기 + 5버튼.
4. 코드를 바꾸면 `Ctrl+R`(Reload Window)로 즉시 반영.

## `@refine` 사용법

`@refine <프롬프트>`를 치면 정제본 미리보기와 함께 버튼 5개가 뜬다.

| 버튼 | 동작 |
|---|---|
| **전송 (allow)** | 정제본을 Copilot에 자동 전송. 사이드바에 정제 내역 1건 기록. |
| **다시 정제 (try again)** | 원본으로 다시 정제해 새 미리보기. |
| **원본 전송 (use original)** | 정제 없이 원본을 그대로 전송. |
| **수정 (modify)** | 정제본을 입력창에 내려 조금 고친 뒤 엔터로 전송. |
| **취소 (cancel)** | 원본을 입력창에 돌려놓음(정제 취소). |

> 전송은 모두 `workbench.action.chat.open`으로 **네이티브 Copilot에 위임**한다 — 답은 평소처럼 Copilot
> 채팅에 나오고, 에이전트/툴도 그대로 동작한다. **`@refine` 없이 친 평범한 프롬프트는 건드리지 않는다.**

## 카드 보기 (사이드바)

[전송]한 정제는 카드 1장 = **원본 -> 정제본**으로 쌓이며, 색/폰트는 전부 VS Code 테마 변수라 라이트/다크와
Copilot 채팅에 자동으로 맞춰진다.

- **검색**: 상단 입력창에 치면 원본/정제본/채널을 즉시 필터. 우측에 현재 건수.
- **차이 강조** 토글: 원본/정제본을 **단어 단위로 비교**해 바뀐 부분만 강조.`
  지금은 고정 문자열 모드라 "통째 교체"로 보이고, 서버 정제로 전환하면 진짜 편집 지점이 드러난다.
- **펼치기/접기**: 긴 프롬프트는 접혀 있고 `더 보기`로 펼친다.
- **복사**: 각 블록의 아이콘 버튼으로 클립보드에 복사.

> 로그는 기본적으로 **확장 전역 저장소**(`globalStorage/logs`)에 쌓인다(사용자 프로젝트 폴더를 더럽히지
> 않음). 다른 위치를 쓰려면 설정 `logDir`에 절대경로를 지정.

## 설정

| 설정 키 | 기본값 | 설명 |
|---|---|---|
| `swbcPromptRefiner.logDir` | `""` | 정제 내역 로그 폴더 절대경로(비우면 `globalStorage/logs`) |
| `swbcPromptRefiner.maxEntries` | `200` | 사이드바에 표시할 최근 건수 상한 |

## .vsix 패키징 / 설치

배포는 **VSIX 사설 공유**. 코드 수정 후 **한 줄**이면 .vsix가 만들어진다(순수 JS라 수십 KB로 작다).

```bash
./build.sh            # 패키징 -> swbc-prompt-refiner-<version>.vsix
./build.sh --install  # 위 + 현재 VS Code에 강제 설치(code --install-extension --force)
```

> **개발 중엔 vsix가 필요 없다.** F5로 띄운 Extension Development Host에서 `Ctrl+R`이면 코드 변경이 바로 반영된다.
> vsix는 *내 실제 VS Code에 설치*하거나 *남에게 공유*할 때 만든다.
>
> **같은 버전 재설치**는 `--install`(=`--force`)이 처리한다. "업데이트"로 인식시키려면 `package.json`의
> `version`을 올려라(VS Code는 같은 버전을 업데이트로 보지 않는다).
>
> ⚠️ 실제 공유 전, `src/refiner.js`의 `refine()`를 고정 문자열(`FIXED_REPLACEMENT`)에서 정식 정제 서버
> 경로로 전환해야 의미가 있다(현재는 테스트용 고정 문자열, 전환은 사용자 지시 후).

> 데이터 계약: 사이드바는 `logger.js`가 남기는 JSONL 한 줄
> `{"ts","channel","model","before","after"}` 만 읽는다. 스키마가 바뀌면 뷰가 깨지므로
> `logger.js`와 `logReader.js`를 함께 수정할 것.
