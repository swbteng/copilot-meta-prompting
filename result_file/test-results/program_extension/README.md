# program_extension 테스트 결과

현재 제출물에는 자동 테스트 코드 대신 VS Code Extension Development Host에서의 수동 검증 절차를 기록한다.

## 확인된 정적 검증

- `package.json`에 `swbc.refine` Chat Participant와 Activity Bar Webview가 등록되어 있다.
- `src/chat.js`에 5개 액션 버튼과 Copilot 전달 명령이 구현되어 있다.
- `src/logger.js`가 `observe-YYYY-MM-DD.log` JSONL 기록을 append한다.
- `src/logReader.js`와 `media/main.js`가 사이드바 카드 렌더링, 검색, diff, 복사, 펼치기를 구현한다.
- `build.sh`가 `@vscode/vsce` 기반 VSIX 패키징을 수행한다.

## 성공 기준

Extension Development Host에서 `@refine <프롬프트>` 입력 시 정제본 미리보기와 5개 버튼이 표시되고, `전송 (allow)` 후 Activity Bar 사이드바에 원본/정제본 카드가 추가되면 통과로 본다.
