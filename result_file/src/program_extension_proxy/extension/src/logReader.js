// logReader.js - 교체 로그(JSONL)를 찾아 읽고 파싱하는 순수 유틸.
// vscode API에 의존하지 않는다(테스트/재사용 용이). 어떤 입력에서도 예외를 던지지 않고
// 빈 배열로 fail-soft 한다 - 깨진 로그 한 줄이 뷰 전체를 멈추면 안 되기 때문.
const fs = require("fs");
const path = require("path");

// 데이터 계약 파일명: observe-YYYY-MM-DD.log (엔진은 항상 날짜별 파일에만 기록).
// 날짜 없는 레거시 observe.log(옛 OBSERVE 모드의 텍스트 덤프)는 스키마가 달라 제외한다
// - 삭제하지 않고 그냥 읽지 않는다(사용자 데이터 보존).
const LOG_FILE_RE = /^observe-\d{4}-\d{2}-\d{2}\.log$/;

// dir 안에서 우리 로그 파일들의 전체 경로 목록.
function listLogFiles(dir) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch (e) {
    return []; // 폴더 없음/접근 불가 -> 빈 목록
  }
  return names.filter((n) => LOG_FILE_RE.test(n)).map((n) => path.join(dir, n));
}

// 로그 파일 1개를 줄 단위 JSON으로 파싱. 깨진 줄은 조용히 건너뛴다(fail-soft).
// 반환: [{ts, channel, model, before, after}, ...]
function parseFile(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (e) {
    return [];
  }
  const out = [];
  for (const line of raw.split(/\r?\n/)) {
    const s = line.trim();
    if (!s) continue;
    let obj;
    try {
      obj = JSON.parse(s);
    } catch (e) {
      continue; // JSONL 한 줄이 깨져도 나머지는 계속
    }
    if (obj && typeof obj === "object" && typeof obj.before === "string") {
      out.push({
        ts: typeof obj.ts === "string" ? obj.ts : "",
        channel: typeof obj.channel === "string" ? obj.channel : "",
        model: obj.model == null ? "" : String(obj.model),
        before: obj.before,
        after: typeof obj.after === "string" ? obj.after : "",
      });
    }
  }
  return out;
}

// dir 안의 모든 로그를 읽어 ts(시각) 오름차순 정렬 후, 최근 maxEntries개만 반환.
function readEntries(dir, maxEntries) {
  const files = listLogFiles(dir);
  let all = [];
  for (const f of files) all = all.concat(parseFile(f));
  // ts는 'YYYY-MM-DDTHH:MM:SS' 문자열 -> 사전식 정렬이 곧 시간순.
  all.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  if (typeof maxEntries === "number" && maxEntries > 0 && all.length > maxEntries) {
    all = all.slice(all.length - maxEntries);
  }
  return all;
}

module.exports = { LOG_FILE_RE, listLogFiles, parseFile, readEntries };
