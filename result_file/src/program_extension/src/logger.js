// logger.js - 정제 1건을 observe-YYYY-MM-DD.log(JSONL)에 append. (확장 단독 구조)
//
// 옛 프록시의 record_rewrite()를 대체한다 - 사이드바 뷰어가 읽는 데이터 계약(스키마)은 그대로 동결.
//   {"ts","channel","model","before","after"}
// vscode API 비의존(테스트 용이). 어떤 에러에서도 throw하지 않는다(fail-open).
const fs = require("fs");
const path = require("path");

// 로컬 날짜 YYYY-MM-DD (logReader의 ^observe-\d{4}-\d{2}-\d{2}\.log$ 와 일치해야 뷰어가 읽는다).
function _today(d) {
  const t = d || new Date();
  const p = (n) => String(n).padStart(2, "0");
  return t.getFullYear() + "-" + p(t.getMonth() + 1) + "-" + p(t.getDate());
}

// 로컬 타임스탬프 YYYY-MM-DDTHH:MM:SS (프록시 record_rewrite의 ts 포맷과 동일 = 사전식 정렬이 곧 시간순).
function _ts(d) {
  const t = d || new Date();
  const p = (n) => String(n).padStart(2, "0");
  return (
    _today(t) + "T" + p(t.getHours()) + ":" + p(t.getMinutes()) + ":" + p(t.getSeconds())
  );
}

// logDir/observe-오늘.log 에 JSON 한 줄 append. 폴더 없으면 만든다. 실패해도 조용히 false(fail-open).
function appendRewrite(logDir, entry) {
  try {
    if (!logDir || !entry || typeof entry.before !== "string") return false;
    const now = new Date();
    const rec = {
      ts: _ts(now),
      channel: typeof entry.channel === "string" ? entry.channel : "@refine",
      model: entry.model == null ? "" : String(entry.model),
      before: entry.before,
      after: typeof entry.after === "string" ? entry.after : "",
    };
    fs.mkdirSync(logDir, { recursive: true });
    const file = path.join(logDir, "observe-" + _today(now) + ".log");
    fs.appendFileSync(file, JSON.stringify(rec) + "\n", "utf8");
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = { appendRewrite, _today, _ts };
