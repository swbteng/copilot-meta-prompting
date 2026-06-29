// logger.test.js — 프롬프트 수정 내역 로컬 저장(JSONL) 검증
// 대응 요구사항: R-EX-09 (최종 전송 건을 observe-YYYY-MM-DD.log에 한 줄씩 Append)
//
// 검증 대상: src/program_extension/src/logger.js (appendRewrite) — vscode 비의존 순수 모듈.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const SRC = path.join(__dirname, "..", "..", "src", "program_extension", "src");
const logger = require(path.join(SRC, "logger.js"));

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "rex-logger-"));
}
function todayFile(dir) {
  return path.join(dir, "observe-" + logger._today(new Date()) + ".log");
}

test("[R-EX-09] {before, after, ts} 구조의 JSON 레코드가 일자별 로그에 1줄 기록된다", () => {
  const dir = tmpDir();
  const ok = logger.appendRewrite(dir, { channel: "@refine", before: "원본A", after: "정제A" });
  assert.strictEqual(ok, true);

  const lines = fs.readFileSync(todayFile(dir), "utf8").trim().split("\n");
  assert.strictEqual(lines.length, 1);

  const rec = JSON.parse(lines[0]);
  assert.strictEqual(rec.before, "원본A");
  assert.strictEqual(rec.after, "정제A");
  assert.strictEqual(rec.channel, "@refine");
  // 스키마 동결: ts/channel/model/before/after 키가 모두 존재
  for (const k of ["ts", "channel", "model", "before", "after"]) {
    assert.ok(k in rec, `스키마 키 누락: ${k}`);
  }
  // ts는 YYYY-MM-DDTHH:MM:SS 형식
  assert.match(rec.ts, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
});

test("[R-EX-09] 여러 건은 같은 파일에 누적(Append)된다", () => {
  const dir = tmpDir();
  logger.appendRewrite(dir, { before: "b1", after: "a1" });
  logger.appendRewrite(dir, { before: "b2", after: "a2" });
  logger.appendRewrite(dir, { before: "b3", after: "a3" });

  const lines = fs.readFileSync(todayFile(dir), "utf8").trim().split("\n");
  assert.strictEqual(lines.length, 3);
  assert.strictEqual(JSON.parse(lines[2]).after, "a3");
});

test("[R-EX-09] 폴더가 없으면 생성하고, 잘못된 입력은 throw 없이 false(fail-open)", () => {
  const dir = path.join(tmpDir(), "nested", "logs"); // 미존재 경로
  assert.strictEqual(logger.appendRewrite(dir, { before: "x", after: "y" }), true);
  assert.ok(fs.existsSync(todayFile(dir)));

  // before가 문자열이 아니면 기록하지 않고 false
  assert.strictEqual(logger.appendRewrite(dir, { after: "y" }), false);
});
