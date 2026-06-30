# program_extension - Prompt Refiner VS Code 확장

VS Code Copilot Chat에 `@refine` Chat Participant를 추가하는 확장 프로그램이다. 사용자가 `@refine <프롬프트>`를 입력하면 정제본 미리보기를 표시하고, 5개 액션 버튼으로 사용자가 최종 전송 방식을 선택한다. 전송된 정제 내역은 Activity Bar 사이드바에 카드 형태로 누적된다.

## 구성

```text
src/program_extension/
├── package.json        # 확장 매니페스트, chat participant, view, 설정
├── src/
│   ├── extension.js    # 확장 진입점, 사이드바 등록, @refine 등록
│   ├── chat.js         # @refine 처리, 미리보기, 5개 버튼, Copilot 전송
│   ├── refiner.js      # 현재 활성 정제 함수와 서버 호출 헬퍼
│   ├── logger.js       # JSONL 정제 내역 append
│   ├── logReader.js    # observe-*.log 읽기/파싱
│   └── config.js       # 로그 폴더와 표시 개수 설정
├── media/              # Webview UI CSS/JS/icon
├── build.sh            # VSIX 패키징 스크립트
├── refine_copilot.py   # 레거시/실험용 mitmproxy 애드온
└── requirements.txt    # mitmproxy 애드온 실행용 Python 의존성
```

## 주요 기능

- `@refine` Chat Participant 등록
- 정제본 미리보기와 원본 표시
- `전송`, `다시 정제`, `원본 전송`, `수정`, `취소` 버튼 제공
- `workbench.action.chat.open`으로 네이티브 Copilot Chat에 최종 텍스트 전달
- `observe-YYYY-MM-DD.log` JSONL 형식으로 원본/정제본 기록
- Activity Bar `Prompt Refiner` 사이드바에서 정제 내역 조회
- 검색, 단어 단위 차이 강조, 복사, 긴 본문 펼치기/접기 제공

## 실행

VS Code에서 `src/program_extension` 폴더를 열고 `F5`를 눌러 Extension Development Host를 실행한다. 새 창에서 Copilot Chat에 다음처럼 입력한다.

```text
@refine 1+1이 뭐야?
```

현재 활성 경로의 정제 결과는 `src/refiner.js`의 고정 문자열 테스트 모드이다. 서버 연동 헬퍼(`callRefineApi`)는 구현되어 있으며, 백엔드 `/refine` URL로 전환하려면 `REFINE_API_URL`을 설정하고 주석 처리된 서버 호출 블록을 활성화한다.

## 패키징

```bash
./build.sh
./build.sh --install
```

`build.sh`는 `npx --yes @vscode/vsce package --allow-missing-repository`로 VSIX를 생성한다. 확장은 런타임 Node 패키지 의존성이 없는 순수 JavaScript 구조이며, 패키징 시에만 `vsce`가 필요하다.

## 설정

| 설정 키 | 기본값 | 설명 |
|---|---|---|
| `swbcPromptRefiner.logDir` | 빈 문자열 | 비우면 VS Code `globalStorage/logs`, 값이 있으면 지정 절대경로 사용 |
| `swbcPromptRefiner.maxEntries` | `200` | 사이드바에 표시할 최근 정제 내역 개수 |
