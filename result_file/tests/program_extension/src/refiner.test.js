// refiner.test.js — 정제 서버 호출/응답 처리 및 통신 실패 fail-open 검증
// 대응 요구사항: R-EX-11(API 통신 실패 예외 처리) + 정상 응답 처리(R-EX-02 파이프라인 근거)
//
// 검증 대상: src/program_extension/src/refiner.js (refine / callRefineApi)
// 로컬 http 서버로 200/500/연결실패를 흉내낸다(추가 의존성 0). refiner는 REFINE_API_URL을
// 모듈 로드시 const로 읽으므로, 시나리오마다 env 설정 후 캐시를 비우고 새로 require한다.
const test = require("node:test");
const assert = require("node:assert");
const http = require("http");
const path = require("path");

const REFINER = path.join(__dirname, "..", "..", "..", "src", "program_extension", "src", "refiner.js");

function loadRefinerWith(url) {
  process.env.REFINE_API_URL = url; // env가 baked/기본값보다 우선
  delete require.cache[require.resolve(REFINER)];
  return require(REFINER);
}

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}/refine`,
        port,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

test("[R-EX-11보강] 정상 200 응답이면 서버 정제본을 그대로 사용", async () => {
  const srv = await startServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ refined: "SERVER_REFINED" }));
  });
  try {
    const { refine } = loadRefinerWith(srv.url);
    const out = await refine("헝가리의 수도가 어디야?");
    assert.strictEqual(out, "SERVER_REFINED");
  } finally {
    await srv.close();
  }
});

test("[R-EX-11] 서버 500 에러 시 throw 없이 원본을 반환(fail-open)", async () => {
  const srv = await startServer((req, res) => {
    res.statusCode = 500;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: "internal" }));
  });
  try {
    const { refine } = loadRefinerWith(srv.url);
    const out = await refine("원본질문");
    assert.strictEqual(out, "원본질문", "500이면 원본을 그대로 흘려보내야 한다");
  } finally {
    await srv.close();
  }
});

test("[R-EX-11] 연결 실패(서버 다운) 시에도 throw 없이 원본 반환(fail-open)", async () => {
  // 서버를 열었다 즉시 닫아 '연결 거부'를 만든다.
  const srv = await startServer(() => {});
  const deadUrl = srv.url;
  await srv.close();

  const { refine } = loadRefinerWith(deadUrl);
  const out = await refine("죽은서버질문");
  assert.strictEqual(out, "죽은서버질문");
});

test("[R-EX-11] text/plain 500 응답도 에러로 처리해 원본 반환(상태코드 검사)", async () => {
  // content-type이 JSON이 아니어도 statusCode>=400이면 정제본으로 오인하지 말아야 한다.
  const srv = await startServer((req, res) => {
    res.statusCode = 500;
    res.setHeader("content-type", "text/plain");
    res.end("Internal Server Error");
  });
  try {
    const { refine, refineDetailed } = loadRefinerWith(srv.url);
    assert.strictEqual(await refine("질문"), "질문", "500 본문을 정제본으로 쓰면 안 된다");
    const d = await refineDetailed("질문");
    assert.strictEqual(d.ok, false, "통신 실패는 ok:false");
    assert.strictEqual(d.text, "질문", "실패 시 원본 유지");
  } finally {
    await srv.close();
  }
});

test("[R-EX-11보강] refineDetailed: 200 성공 시 ok:true + 서버 정제본", async () => {
  const srv = await startServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ refined: "OK_REFINED" }));
  });
  try {
    const { refineDetailed } = loadRefinerWith(srv.url);
    const d = await refineDetailed("q");
    assert.strictEqual(d.ok, true);
    assert.strictEqual(d.text, "OK_REFINED");
  } finally {
    await srv.close();
  }
});

test("[R-EX-11] 빈/공백 입력은 그대로 반환(서버 호출 없이 방어)", async () => {
  const { refine } = loadRefinerWith("http://127.0.0.1:1/refine");
  assert.strictEqual(await refine("   "), "   ");
});
