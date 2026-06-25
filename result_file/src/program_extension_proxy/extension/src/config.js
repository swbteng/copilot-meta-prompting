// config.js - 설정값/경로 해석을 한곳에 모은다.
//
// 핵심: 엔진(engine.js)이 'LOG_DIR'로 쓰는 폴더와, 뷰어(extension.js)가 '읽는' 폴더가
//       반드시 같아야 한다. 그래서 resolveLogDir() 하나를 양쪽이 공유한다(단일 소스).
const vscode = require("vscode");
const fs = require("fs");
const path = require("path");

function cfg() {
  return vscode.workspace.getConfiguration("swbcPromptRefiner");
}

// 엔진(LOG_DIR)과 뷰어가 공유하는 단일 로그 폴더.
//   1) 설정 logDir(절대경로)가 있으면 그것
//   2) 없으면 확장 전역 저장소 globalStorage/logs (사용자 프로젝트 폴더를 더럽히지 않음)
// P2부터 엔진을 확장이 직접 띄우므로, 이 폴더가 곧 '진실'이다(워크스페이스 위치와 무관).
function resolveLogDir(context) {
  const configured = (cfg().get("logDir") || "").trim();
  if (configured) return configured;
  return path.join(context.globalStorageUri.fsPath, "logs");
}

function getMaxEntries() {
  const n = cfg().get("maxEntries");
  return typeof n === "number" && n > 0 ? n : 200;
}

// mitmdump 프록시 포트. VS Code의 http.proxy 포트와 같아야 트래픽이 흐른다(기본 8080).
function getListenPort() {
  const n = cfg().get("listenPort");
  return typeof n === "number" && n > 0 ? Math.floor(n) : 8080;
}

// 확장 활성화 시 엔진을 자동으로 켤지(기본 true). run.sh로 수동 실행 중이면 끄는 게 좋다(포트 충돌).
function getAutoStart() {
  return cfg().get("autoStart") !== false;
}

function _firstExisting(paths) {
  for (const p of paths) {
    try {
      if (p && fs.existsSync(p)) return p;
    } catch (e) {
      /* 무시 */
    }
  }
  return null;
}

function _workspaceDirs() {
  return (vscode.workspace.workspaceFolders || []).map((f) => f.uri.fsPath);
}

// mitmdump 실행 파일 경로를 찾는다(우선순위):
//   1) 설정 mitmdumpPath
//   2) 동봉본 engine/mitmdump(.exe)  (P5에서 standalone 바이너리를 여기에 둘 예정)
//   3) 열린 워크스페이스의 .venv (개발 단계: swbc-proxy의 .venv)
//   4) 폴백: "mitmdump" (PATH에 의존)
function resolveMitmdump(context) {
  const setting = (cfg().get("mitmdumpPath") || "").trim();
  if (setting) return setting;
  const exe = process.platform === "win32" ? "mitmdump.exe" : "mitmdump";
  const candidates = [path.join(context.extensionUri.fsPath, "engine", exe)];
  for (const wf of _workspaceDirs()) {
    candidates.push(path.join(wf, ".venv", "Scripts", "mitmdump.exe")); // Windows venv
    candidates.push(path.join(wf, ".venv", "bin", "mitmdump")); // POSIX venv
  }
  return _firstExisting(candidates) || "mitmdump";
}

// 애드온(refine_copilot.py) 경로를 찾는다. 못 찾으면 null.
//   1) 설정 addonPath  2) 동봉본 engine/refine_copilot.py  3) 워크스페이스 루트
function resolveAddon(context) {
  const setting = (cfg().get("addonPath") || "").trim();
  if (setting) return setting;
  const candidates = [path.join(context.extensionUri.fsPath, "engine", "refine_copilot.py")];
  for (const wf of _workspaceDirs()) {
    candidates.push(path.join(wf, "refine_copilot.py"));
  }
  return _firstExisting(candidates);
}

module.exports = {
  resolveLogDir,
  getMaxEntries,
  getListenPort,
  getAutoStart,
  resolveMitmdump,
  resolveAddon,
};
