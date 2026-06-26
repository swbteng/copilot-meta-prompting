// refiner.js - 확장 호스트(JS)에서 도는 프롬프트 정제 + 프록시 bypass 마커. (P6)
//
// refine_copilot.py의 refine_text()와 '같은 철학'의 JS 짝이다:
//   - 현재: 항상 고정 문자열 FIXED_REPLACEMENT("안녕,클로드")를 돌려준다(서버 연동 전 검증용).
//   - 서버 모드: REFINE_API_URL을 정하고 아래 [정식] 블록 주석을 풀면 HTTP로 직접 정제 서버를 부른다
//     (프록시/파이썬 불필요). 사용자 지시 없이 임의 전환 금지(refine_copilot.py와 동일 제약).
//
// bypass 마커: @refine가 '이미 확정/정제한' 텍스트를 네이티브 Copilot에 보낼 때 맨 앞에 붙인다.
//   refine_copilot.py가 <userRequest> 안쪽에서 이 마커를 보면 정제를 건너뛰고 마커만 떼어 통과시킨다.
//   ★ refine_copilot.py의 BYPASS_MARKER와 '정확히 같은' 코드포인트여야 한다:
//     U+200B U+2063 U+2060 U+2063 U+200B (전부 zero-width).
const https = require("https");
const http = require("http");
const { URL } = require("url");

const FIXED_REPLACEMENT = "안녕,클로드";
const BYPASS_MARKER = "​⁣⁠⁣​";

// 서버 모드용(현재 미사용). 비우면 고정 문자열 경로를 쓴다.
const REFINE_API_URL = process.env.REFINE_API_URL || "";
const REFINE_API_TIMEOUT_MS = 20000;

// 이미 확정된 텍스트 앞에 마커를 붙여 '프록시 정제 건너뛰기'를 표시한다.
function attachBypass(text) {
  return BYPASS_MARKER + String(text == null ? "" : text);
}

async function refine(original) {
  // 절대 throw 금지(fail-open: 문제가 생기면 원본 반환).
  try {
    if (typeof original !== "string" || !original.trim()) return original;

    // ───────────────────────────────────────────────────────────────────────
    // [정식] 정제 서버 호출 - REFINE_API_URL 확정 후 아래 주석을 해제(refine_copilot.py와 보조).
    // if (REFINE_API_URL) {
    //   const refined = await callRefineApi(original);
    //   return (typeof refined === "string" && refined.trim()) ? refined : original;
    // }
    // ───────────────────────────────────────────────────────────────────────

    // [현재/테스트] 고정 문자열.
    return FIXED_REPLACEMENT;
  } catch (e) {
    return original;
  }
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

module.exports = { refine, attachBypass, callRefineApi, BYPASS_MARKER, FIXED_REPLACEMENT };
