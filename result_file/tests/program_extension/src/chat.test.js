// chat.test.js — @refine 참가자의 클라이언트 동작 검증
// 대응 요구사항: R-15(가로채기) / R-16(렌더링+5선택지) / R-17(Allow) / R-18(Modify)
//               R-21(Try again) / R-19(Use original) / R-20(Cancel) / R-24(예외 fallback)
//
// 검증 대상: src/program_extension/src/chat.js (registerChat / 핸들러 / 5개 명령)
// refine()는 require.cache 주입으로 결정론적 가짜로 대체(네트워크 비의존). VS Code API는 _helpers/vscode-stub.
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const os = require("os");
const fs = require("fs");

const stub = require("../_helpers/vscode-stub"); // require("vscode") 후킹 먼저
const { state, reset, makeStream } = stub;

const SRC = path.join(__dirname, "..", "..", "..", "src", "program_extension", "src");
const CHAT = path.join(SRC, "chat.js");
const REFINER = path.join(SRC, "refiner.js");
const CONFIG = path.join(SRC, "config.js");
const LOGGER = path.join(SRC, "logger.js");
const logReader = require(path.join(SRC, "logReader.js"));

const CHAT_OPEN = "workbench.action.chat.open";

// chat.js를 '주어진 refine 함수'로 새로 로드한다(모듈 최상단에서 refiner를 require하므로 재로드 필요).
// detailedFn을 주면 refineDetailed로 주입해 서버 성공/실패({ok})를 흉내 낼 수 있다(R-24).
function loadChat(refineFn, detailedFn) {
  delete require.cache[require.resolve(CHAT)];
  delete require.cache[require.resolve(REFINER)];
  delete require.cache[require.resolve(CONFIG)];
  delete require.cache[require.resolve(LOGGER)];
  const exports = { refine: refineFn, callRefineApi: () => Promise.resolve(null), FIXED_REPLACEMENT: "안녕,클로드" };
  if (detailedFn) exports.refineDetailed = detailedFn;
  require.cache[require.resolve(REFINER)] = { id: REFINER, filename: REFINER, loaded: true, exports };
  return require(CHAT);
}

function makeContext() {
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "rex-chat-"));
  return { subscriptions: [], globalStorageUri: { fsPath: TMP }, extensionUri: { fsPath: "ext" }, _tmp: TMP };
}

function openCalls() {
  return state.executeCalls.filter((c) => c.cmd === CHAT_OPEN);
}

test("[R-15] @refine 참가자 등록 + 미리보기 단계에선 기본 LLM으로 자동 전송하지 않음(가로채기)", async () => {
  reset();
  const chat = loadChat(async (t) => "REFINED:" + t);
  const ctx = makeContext();
  chat.registerChat(ctx);

  // 참가자가 'swbc.refine' id로 등록됐는가
  assert.strictEqual(state.participants.length, 1);
  assert.strictEqual(state.participants[0].id, "swbc.refine");

  // 핸들러 실행(=사용자가 @refine 입력) -> 미리보기만, 타겟 LLM 자동 전송 없음
  const stream = makeStream();
  await state.participants[0].handler({ prompt: "헝가리의 수도가 어디야?" }, {}, stream, {});
  assert.strictEqual(openCalls().length, 0, "미리보기 단계에서 chat.open이 호출되면 안 된다");
});

test("[R-16] 정제본 미리보기 + 5가지 액션(Allow/Modify/Try again/Use original/Cancel) 렌더링", async () => {
  reset();
  const chat = loadChat(async (t) => "REFINED::" + t);
  const ctx = makeContext();
  chat.registerChat(ctx);

  const stream = makeStream();
  await state.participants[0].handler({ prompt: "1+1?" }, {}, stream, {});
  const out = stream.text();

  assert.ok(out.includes("REFINED::1+1?"), "정제본 텍스트가 미리보기에 포함돼야 한다");
  // 5개 액션 명령이 모두 노출돼야 한다(가로 액션 바의 커맨드 링크).
  for (const id of [
    "swbcPromptRefiner.refineAllow",
    "swbcPromptRefiner.refineModify",
    "swbcPromptRefiner.refineTryAgain",
    "swbcPromptRefiner.refineUseOriginal",
    "swbcPromptRefiner.refineCancel",
  ]) {
    assert.ok(out.includes(id), `액션 누락: ${id}`);
  }
});

test("[R-17] Allow -> 정제본을 타겟 LLM에 전송 + 수정 내역 1건 기록", async () => {
  reset();
  const chat = loadChat(async (t) => "R:" + t);
  const ctx = makeContext();
  chat.registerChat(ctx);

  const original = "원본 프롬프트";
  const refined = "정제된 프롬프트";
  await state.commands.get("swbcPromptRefiner.refineAllow")(original, refined);

  // 정제본이 그대로 전송됐는가(추가 입력 대기 없이)
  const calls = openCalls();
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].args[0].query, refined);
  assert.ok(!calls[0].args[0].isPartialQuery, "Allow는 즉시 전송(입력창 시드가 아님)");

  // 로그(원본->정제본) 1건 append 됐는가 (R-22와 연동)
  const entries = logReader.readEntries(path.join(ctx._tmp, "logs"), 100);
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].before, original);
  assert.strictEqual(entries[0].after, refined);
});

test("[R-18] Modify -> 정제본을 입력창에 시드(전송 아님, 사용자 편집 대기)", async () => {
  reset();
  const chat = loadChat(async (t) => t);
  chat.registerChat(makeContext());

  const refined = "정제된 프롬프트";
  await state.commands.get("swbcPromptRefiner.refineModify")(refined);

  const calls = openCalls();
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].args[0].query, refined);
  assert.strictEqual(calls[0].args[0].isPartialQuery, true, "Modify는 입력창 시드(isPartialQuery=true)");
});

test("[R-21] Try again -> 동일 원본으로 @refine 재요청(미리보기 갱신)", async () => {
  reset();
  const chat = loadChat(async (t) => t);
  chat.registerChat(makeContext());

  const original = "헝가리의 수도가 어디야?";
  await state.commands.get("swbcPromptRefiner.refineTryAgain")(original);

  const calls = openCalls();
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].args[0].query, "@refine " + original, "원본으로 @refine 재진입");
});

test("[R-19] Use original -> 원본을 타겟 LLM에 전송, 로그 미기록", async () => {
  reset();
  const chat = loadChat(async (t) => t);
  const ctx = makeContext();
  chat.registerChat(ctx);

  const original = "원본 그대로";
  await state.commands.get("swbcPromptRefiner.refineUseOriginal")(original);

  const calls = openCalls();
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].args[0].query, original);
  assert.ok(!calls[0].args[0].isPartialQuery, "Use original은 즉시 전송");

  // 교체가 아니므로 기록되지 않아야 한다
  const entries = logReader.readEntries(path.join(ctx._tmp, "logs"), 100);
  assert.strictEqual(entries.length, 0);
});

test("[R-20] Cancel -> 원본을 '@refine '를 붙여 입력창에 복원(정제 취소, @refine 컨텍스트 유지)", async () => {
  reset();
  const chat = loadChat(async (t) => t);
  chat.registerChat(makeContext());

  const original = "원본 복원 대상";
  await state.commands.get("swbcPromptRefiner.refineCancel")(original);

  const calls = openCalls();
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].args[0].query, "@refine " + original, "취소 시 @refine를 앞에 붙여 시드");
  assert.strictEqual(calls[0].args[0].isPartialQuery, true, "Cancel은 입력창에 시드(전송 아님)");
});

test("[R-24] API 통신 실패(ok:false) 시 에러 메시지 + Use original/Cancel Fallback UI 제공", async () => {
  reset();
  // refineDetailed가 ok:false(서버 타임아웃/500)를 돌려주는 상황.
  const chat = loadChat(
    async (t) => t, // refine(미사용)
    async (t) => ({ text: t, ok: false, reason: "api" })
  );
  chat.registerChat(makeContext());

  const stream = makeStream();
  await state.participants[0].handler({ prompt: "헝가리의 수도가 어디야?" }, {}, stream, {});
  const out = stream.text();

  assert.ok(out.includes("실패"), "무한 로딩 대신 에러 메시지를 표출해야 한다");
  // Fallback UI는 'Use original' / '재시도(try again)' / 'Cancel'을 제공해야 한다(명세 R-24).
  assert.ok(out.includes("swbcPromptRefiner.refineUseOriginal"), "Fallback에 Use original 제공");
  assert.ok(out.includes("swbcPromptRefiner.refineTryAgain"), "Fallback에 재시도(try again) 제공");
  assert.ok(out.includes("swbcPromptRefiner.refineCancel"), "Fallback에 Cancel 제공");
  assert.strictEqual(openCalls().length, 0, "실패 단계에서 타겟 LLM으로 자동 전송하지 않는다");
});

test("[R-24] Fallback의 재시도 -> 동일 원본으로 @refine 재요청(미리보기 갱신)", async () => {
  reset();
  const chat = loadChat(async (t) => t);
  chat.registerChat(makeContext());

  const original = "헝가리의 수도가 어디야?";
  await state.commands.get("swbcPromptRefiner.refineTryAgain")(original);

  const calls = openCalls();
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].args[0].query, "@refine " + original, "동일 원본으로 @refine 재진입");
});

test("[R-24] 정제 중 예외가 나도 throw하지 않고 Fallback UI(에러 메시지 + 원본/취소) 표출(fail-open)", async () => {
  reset();
  const chat = loadChat(async () => {
    throw new Error("boom");
  });
  chat.registerChat(makeContext());

  const stream = makeStream();
  // 핸들러가 예외를 삼키고(throw 없이) 안내 메시지 + Fallback UI를 스트리밍해야 한다.
  await assert.doesNotReject(
    state.participants[0].handler({ prompt: "x" }, {}, stream, {})
  );
  const out = stream.text();
  assert.ok(out.includes("실패"), "fail-open 안내 메시지가 표출돼야 한다");
  assert.ok(out.includes("swbcPromptRefiner.refineUseOriginal"), "예외 시에도 원본 전송 경로 제공");
  assert.strictEqual(openCalls().length, 0, "예외 시 타겟 LLM으로 자동 전송하지 않는다");
});
