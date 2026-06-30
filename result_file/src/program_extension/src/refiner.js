// refiner.js - 프롬프트 정제(확장 호스트, 순수 JS). 확장 단독 구조의 '유일한 refiner'.
//
//   - 서버 모드(현재 기본): REFINE_API_URL의 정제 서버를 HTTP로 직접 불러 정제본을 받는다.
//   - 폴백: REFINE_API_URL이 비어 있으면 고정 문자열 FIXED_REPLACEMENT("안녕,클로드")를 돌려준다
//     (서버 미설정 시 파이프라인만 검증). 어떤 경우에도 throw하지 않는다(fail-open: 원본 반환).
//
// (${question} 자리표시자 처리는 BE 서버에서 해결하기로 결정 -> 확장 측 정의 덧붙임 로직은 주석 처리.)
const https = require("https");
const http = require("http");
const { URL } = require("url");

const FIXED_REPLACEMENT = "안녕,클로드";

// 빌드 시 .env의 값을 구워 넣은 파일(build.sh가 생성, 선택적). 패키징된 .vsix는 OS 환경변수가 없을 수
// 있어, build.sh가 .env -> src/env.generated.js로 구워 vsix에 동봉한다. 파일이 없으면(개발/미빌드) 무시.
function bakedRefineUrl() {
  try {
    const v = require("./env.generated").REFINE_API_URL;
    return typeof v === "string" ? v.trim() : "";
  } catch (e) {
    return ""; // env.generated.js 없음 -> 무시(코드 내장 기본값으로)
  }
}

// 서버 모드용 정제 서버 주소. 우선순위: OS 환경변수 > .env 구워넣기(build.sh) > 코드 내장 기본값.
const REFINE_API_URL =
  process.env.REFINE_API_URL ||
  bakedRefineUrl() ||
  "https://z2cck305byfsj9-80.proxy.runpod.net/refine";
const REFINE_API_TIMEOUT_MS = 20000;

// [보류] ${question} 자리표시자 정의 덧붙임 - BE 서버에서 자리표시자를 채워 주기로 결정해 비활성.
// 다시 확장 측에서 처리해야 하면 아래 함수 + refine()의 호출 + export 주석을 함께 해제하면 된다.
// 정제본에 등장하는 모든 ${...}를 찾아 각각 원본 질문으로 끝에 정의해 준다(치환 아님, 정의만).
// function appendQuestionDefinition(refined, original) {
//   if (typeof refined !== "string") return refined;
//   const names = [];
//   const re = /\$\{([a-zA-Z_]\w*)\}/g;
//   let m;
//   while ((m = re.exec(refined)) !== null) {
//     if (!names.includes(m[1])) names.push(m[1]); // 고유 이름만(중복 제거)
//   }
//   if (names.length === 0) return refined; // 자리표시자 없으면 그대로
//   const defs = names.map((n) => "${" + n + "} = " + original).join("\n");
//   return refined.replace(/\s*$/, "") + "\n\n---\n" + defs;
// }

// refine의 '상세판' — 성공/실패를 구분해 돌려준다(R-EX-11 Fallback UI 판단의 단일 근거).
// 절대 throw 금지(fail-open). 반환 = { text, ok, reason }.
//   - 빈 입력      : { text: original,           ok: true,  reason: "blank"  } (실패 UI 띄우지 않음)
//   - URL 미설정   : { text: FIXED_REPLACEMENT,  ok: true,  reason: "fixed"  } (폴백, 정상 흐름)
//   - 서버 성공    : { text: refined,            ok: true,  reason: "server" }
//   - 서버 실패    : { text: original,           ok: false, reason: "api"    } (타임아웃/4xx·5xx/연결실패/빈응답)
//   - 예외         : { text: original,           ok: false, reason: "exception" }
// ok:false일 때만 호출 측(chat.js)이 '에러 메시지 + Use original/Cancel' Fallback UI를 띄운다.
async function refineDetailed(original) {
  try {
    if (typeof original !== "string" || !original.trim()) {
      return { text: original, ok: true, reason: "blank" };
    }
    // [폴백] URL이 비어 있으면 고정 문자열(서버 미설정 시 파이프라인 검증용 — 실패 아님).
    if (!REFINE_API_URL) {
      return { text: FIXED_REPLACEMENT, ok: true, reason: "fixed" };
    }
    // [정식] 정제 서버 호출. 실패하면 null -> ok:false(원본 유지).
    // ${question} 등 자리표시자 채움은 BE 서버 책임 -> 받은 정제본을 그대로 사용.
    const refined = await callRefineApi(original);
    if (typeof refined === "string" && refined.trim()) {
      return { text: refined, ok: true, reason: "server" };
    }
    return { text: original, ok: false, reason: "api" };
  } catch (e) {
    return { text: original, ok: false, reason: "exception" };
  }
}

// 하위호환 얇은 래퍼 — 문자열만 필요한 호출부(셀프테스트/노드 점검)는 이걸 그대로 쓴다.
// 동작/계약은 종전과 동일(성공이면 정제본, 실패면 원본/고정문자열을 fail-open으로 반환).
async function refine(original) {
  const r = await refineDetailed(original);
  return r.text;
}

// 표준 모듈(http/https)만 사용 - 추가 의존성 없음. 실패하면 null(-> 호출 측에서 원본 유지 = fail-open).
function callRefineApi(original) {
  return new Promise((resolve) => {
    try {
      const u = new URL(REFINE_API_URL);
      const lib = u.protocol === "https:" ? https : http;
      const body = Buffer.from(JSON.stringify({ prompt: original }), "utf8");
      const req = lib.request(
        u,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Length": body.length,
          },
          timeout: REFINE_API_TIMEOUT_MS,
        },
        (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            try {
              // R-EX-11: 4xx/5xx는 통신 실패로 간주(text/plain 500 본문을 정제본으로 오인하지 않게).
              if (typeof res.statusCode === "number" && res.statusCode >= 400) {
                return resolve(null);
              }
              const text = Buffer.concat(chunks).toString("utf8");
              const ctype = (res.headers["content-type"] || "").toLowerCase();
              if (!ctype.includes("json")) return resolve(text || null);
              const data = JSON.parse(text);
              if (typeof data === "string") return resolve(data);
              for (const k of ["refined", "text", "result", "output", "response", "content", "message"]) {
                if (data && typeof data[k] === "string" && data[k].trim()) return resolve(data[k]);
              }
              resolve(null);
            } catch (e) {
              resolve(null);
            }
          });
        }
      );
      req.on("error", () => resolve(null));
      req.on("timeout", () => {
        try { req.destroy(); } catch (e) { /* 무시 */ }
        resolve(null);
      });
      req.write(body);
      req.end();
    } catch (e) {
      resolve(null);
    }
  });
}

// appendQuestionDefinition은 보류(BE 서버 처리)라 export하지 않는다.
module.exports = { refine, refineDetailed, callRefineApi, FIXED_REPLACEMENT };
