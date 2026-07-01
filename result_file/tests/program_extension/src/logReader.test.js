// logReader.test.js — 수정 히스토리 조회(데이터 계층) 검증
// 대응 요구사항: R-23 (저장된 수정 내역 목록 조회 — 시간순 정렬 + 최근 N건)
//   ※ 사이드바의 '최신순 화면 렌더'는 webview(DOM) 영역이라 사람/시연 검증. 여기서는
//     readEntries의 조회·정렬·상한 로직(검증 가능한 핵심)을 자동 검증한다.
//
// 검증 대상: src/program_extension/src/logReader.js (readEntries) — vscode 비의존 순수 모듈.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const SRC = path.join(__dirname, "..", "..", "..", "src", "program_extension", "src");
const logReader = require(path.join(SRC, "logReader.js"));

function seed(lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rex-reader-"));
  const file = path.join(dir, "observe-2026-06-29.log");
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n", "utf8");
  return dir;
}

test("[R-23] 저장된 JSONL 내역을 읽어 ts 시간순으로 정렬해 반환한다", () => {
  const dir = seed([
    { ts: "2026-06-29T10:00:02", channel: "@refine", before: "b2", after: "a2" },
    { ts: "2026-06-29T10:00:01", channel: "@refine", before: "b1", after: "a1" },
    { ts: "2026-06-29T10:00:03", channel: "@refine", before: "b3", after: "a3" },
  ]);
  const entries = logReader.readEntries(dir, 100);
  assert.deepStrictEqual(
    entries.map((e) => e.before),
    ["b1", "b2", "b3"],
    "ts 오름차순 정렬(가장 최근이 마지막). 사이드바는 이를 최신순으로 표시한다."
  );
  // 각 항목은 원본/정제본 비교에 필요한 before/after를 보존
  assert.strictEqual(entries[2].after, "a3");
});

test("[R-23] maxEntries 상한 시 가장 최근 N건만 남긴다", () => {
  const dir = seed([
    { ts: "2026-06-29T10:00:01", before: "oldest", after: "x" },
    { ts: "2026-06-29T10:00:02", before: "mid", after: "x" },
    { ts: "2026-06-29T10:00:03", before: "newest", after: "x" },
  ]);
  const entries = logReader.readEntries(dir, 2);
  assert.strictEqual(entries.length, 2);
  assert.deepStrictEqual(entries.map((e) => e.before), ["mid", "newest"]);
});

test("[R-23] 깨진 줄은 건너뛰고(fail-soft), 폴더 없으면 빈 배열", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rex-reader-"));
  fs.writeFileSync(
    path.join(dir, "observe-2026-06-29.log"),
    '{"ts":"2026-06-29T10:00:01","before":"ok","after":"a"}\n{깨진 json}\n',
    "utf8"
  );
  const entries = logReader.readEntries(dir, 100);
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].before, "ok");

  assert.deepStrictEqual(logReader.readEntries(path.join(dir, "nope"), 100), []);
});
