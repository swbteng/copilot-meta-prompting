// config.js - 설정값/경로 해석을 한곳에 모은다. (확장 단독 구조)
//
// 핵심: 정제 로그를 '쓰는' 곳(logger.js, @refine allow 시)과 '읽는' 곳(extension.js 사이드바 뷰어)이
//       반드시 같은 폴더를 봐야 한다. 그래서 resolveLogDir() 하나를 양쪽이 공유한다(단일 소스).
const vscode = require("vscode");
const path = require("path");

function cfg() {
  return vscode.workspace.getConfiguration("swbcPromptRefiner");
}

// 정제 로그를 쓰고/읽는 단일 폴더.
//   1) 설정 logDir(절대경로)가 있으면 그것
//   2) 없으면 확장 전역 저장소 globalStorage/logs (사용자 프로젝트 폴더를 더럽히지 않음)
function resolveLogDir(context) {
  const configured = (cfg().get("logDir") || "").trim();
  if (configured) return configured;
  return path.join(context.globalStorageUri.fsPath, "logs");
}

function getMaxEntries() {
  const n = cfg().get("maxEntries");
  return typeof n === "number" && n > 0 ? n : 200;
}

module.exports = { resolveLogDir, getMaxEntries };
