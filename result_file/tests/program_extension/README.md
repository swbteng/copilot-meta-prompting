# program_extension 테스트 안내

테스트 코드는 제출 제외 요청에 따라 추가하지 않았다. VS Code Extension Development Host에서 수동 검증한다.

## 검증 대상 요구사항

- R-13: `@refine` Chat Participant 등록
- R-14: 정제본 미리보기와 5개 버튼 렌더링
- R-15: 전송 버튼의 Copilot 전달과 JSONL 로그 기록
- R-16: 다시 정제 버튼 재호출
- R-17: 원본 전송, 수정, 취소 버튼 동작
- R-18, R-19: Activity Bar 사이드바와 정제 내역 UI
- R-20: VSIX 패키징
- R-21: fail-open 예외 처리

## 실행 예시

```bash
cd result_file/src/program_extension
code .
```

VS Code에서 `F5`를 눌러 Extension Development Host를 열고 Copilot Chat에 다음을 입력한다.

```text
@refine 발표 자료를 5장으로 구성해줘
```

확인할 항목:

- 정제본 미리보기와 5개 버튼이 보이는지
- `전송 (allow)` 클릭 후 Copilot 입력으로 전달되는지
- Activity Bar의 `Prompt Refiner`에서 정제 내역 카드가 보이는지
- 검색, 차이 강조, 복사, 펼치기 기능이 동작하는지
- `./build.sh` 실행 시 `.vsix`가 생성되는지
