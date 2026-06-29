// config.test.js — 로그 저장 위치/상한 해석 검증 (R-EX-09 저장 위치 근거)
// 대응 요구사항: R-EX-09 (미설정 시 globalStorage/logs, 설정 시 logDir 절대경로)
//
// 검증 대상: src/program_extension/src/config.js (resolveLogDir / getMaxEntries)
// config.js는 vscode.workspace.getConfiguration에 의존 -> _helpers/vscode-stub로 주입.
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");

const stub = require("./_helpers/vscode-stub"); // require("vscode") 후킹 먼저
const { state, reset } = stub;

const CONFIG = path.join(__dirname, "..", "..", "src", "program_extension", "src", "config.js");
function loadConfig() {
  delete require.cache[require.resolve(CONFIG)];
  return require(CONFIG);
}

test("[R-EX-09] logDir 미설정이면 확장 전역 저장소(globalStorage)/logs 를 쓴다", () => {
  reset();
  state.config = { logDir: "" };
  const config = loadConfig();
  const ctx = { globalStorageUri: { fsPath: "/gs/swbc.swbc-prompt-refiner" } };
  assert.strictEqual(config.resolveLogDir(ctx), path.join("/gs/swbc.swbc-prompt-refiner", "logs"));
});

test("[R-EX-09] logDir(절대경로) 설정 시 해당 폴더를 쓴다", () => {
  reset();
  state.config = { logDir: "/custom/log/path" };
  const config = loadConfig();
  assert.strictEqual(config.resolveLogDir({ globalStorageUri: { fsPath: "/gs" } }), "/custom/log/path");
});

test("[R-EX-10보강] maxEntries 기본값 200, 설정 시 해당 값", () => {
  reset();
  state.config = {};
  assert.strictEqual(loadConfig().getMaxEntries(), 200);

  reset();
  state.config = { maxEntries: 50 };
  assert.strictEqual(loadConfig().getMaxEntries(), 50);
});
