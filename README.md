# Copilot Meta-Prompting 최종 산출물

SW Bootcamp 13기 C반 4팀의 Copilot 메타 프롬프팅 서비스 제출 폴더입니다. 서비스는 사용자 프롬프트를 정제하고, 벡터 DB에서 유사한 고품질 템플릿을 검색한 뒤, 리랭커와 LLM으로 최종 프롬프트를 생성하는 백엔드와 Copilot Chat에서 정제 흐름을 확인하는 VS Code 확장으로 구성됩니다.

## 제출 산출물 현황

| 산출물 | 파일/폴더 | 비고 |
|---|---|---|
| 요구사항 명세서 | `SW_Bootcamp_13기_C반_4팀_요구사항_명세서.md` | 구현 완료 항목 중심으로 작성 |
| 결과파일 원본 폴더 | `result_file/` | 소스, 실행 문서, 의존성, 테스트/결과 README 포함 |
| 결과파일 zip | `SW_Bootcamp_13기_C반_4팀_결과파일.zip` | `result_file/` 압축본 |
| 결과보고서 | `SW_Bootcamp_13기_C반_4팀_결과보고서.pdf`, `.pptx` | 이번 문서 작성 범위 제외 |
| 시연영상 | `SW_Bootcamp_13기_C반_4팀_시연영상.mp4` | 이번 문서 작성 범위 제외 |
| 포스터 | `SW_Bootcamp_13기_C반_4팀_포스터.pdf`, `.pptx` | 이번 문서 작성 범위 제외 |
| 자체 평가 결과 | `SW_Bootcamp_13기_C반_4팀_평가결과.html` | 이번 문서 작성 범위 제외 |

## 결과파일 구성

```text
result_file/
├── src/
│   ├── program_backend/    # FastAPI API, RAG 파이프라인, Chroma DB, 웹 데모
│   ├── program_AI/         # vLLM 모델 서빙 스크립트
│   └── program_extension/  # VS Code @refine 확장
├── tests/                  # 테스트 코드 대신 검증 절차 README
├── test-results/           # 테스트 결과/미실행 사유 README
├── README.md               # 결과파일 상세 개요
├── RUN.md                  # 통합 실행·재현 문서
├── requirements.txt        # Python 의존성 목록
├── package.json            # Node/VSIX 패키징 의존성 목록
└── git_log.txt             # Git 히스토리 export
```

자세한 실행 방법은 `result_file/RUN.md`와 각 프로그램 폴더의 `README.md`를 기준으로 확인합니다.
