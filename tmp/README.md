# tmp (보존용)

리팩터링 과정에서 옮겨 온 **기존 원본 파일 보존 폴더**입니다. 삭제하지 않고 여기에 남겨 둡니다.

- `rewrite_prompt.py`, `pick_prompt.py` — 루트에 있던 LLM 정제/생성 데모 스크립트.
  로직은 `result_file/src/program_endpoint/pipeline.py` 의 `rewrite()` / `generate()` 로 옮겼고
  (입력·템플릿 하드코딩, outputs 파일 저장 같은 데모 부작용은 제거), 원본은 참고용으로 여기 보존합니다.
