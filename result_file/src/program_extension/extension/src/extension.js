// extension.js - swbc Prompt Refiner 확장의 진입점.
//
// 역할:
//   (1) 좌측 Activity Bar 사이드바(WebviewView) 등록 + 로그 폴더 감시 -> 교체 내역 카드 표시. (P1)
//   (2) 엔진(mitmdump + refine_copilot.py)을 확장이 직접 spawn/종료 + 상태바 토글. (P2, engine.js)
//   (3) 최초 1회 셋업 마법사(CA 신뢰 + http.proxy + 재시작 안내) + 되돌리기/상태. (P3, setup.js)
//
// 뷰어와 엔진은 config.resolveLogDir()로 '같은 로그 폴더'를 공유한다(엔진이 쓰고, 뷰어가 읽음).
const vscode = require("vscode");
const fs = require("fs");
const { readEntries } = require("./logReader");
const config = require("./config");
const { EngineController } = require("./engine");
const { SetupWizard } = require("./setup");
const { registerChat } = require("./chat");

const VIEW_ID = "swbcPromptRefiner.rewrites";

class RewritesViewProvider {
  constructor(context) {
    this.context = context;
    this.view = null;
    this.watcher = null;
    this.debounce = null;
    this.logDir = config.resolveLogDir(context);
  }

  // VS Code가 사이드바를 처음 펼칠 때 호출.
  resolveWebviewView(view) {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media")],
    };
    view.webview.html = this._html(view.webview);

    view.webview.onDidReceiveMessage((msg) => this._onMessage(msg));
    view.onDidDispose(() => this._stopWatch());

    this._startWatch();
    this._post(); // 첫 렌더에 현재 내역 즉시 전달
  }

  _onMessage(msg) {
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "ready") {
      this._post();
    } else if (msg.type === "openLogFolder") {
      openLogFolder(this.logDir);
    } else if (msg.type === "copy" && typeof msg.text === "string") {
      vscode.env.clipboard.writeText(msg.text);
      vscode.window.setStatusBarMessage("Prompt Refiner: 복사됨", 1500);
    }
  }

  // 설정/폴더가 바뀌었을 때 다시 읽어 그린다.
  refresh() {
    this.logDir = config.resolveLogDir(this.context);
    this._restartWatch();
    this._post();
  }

  _post() {
    if (!this.view) return;
    let entries = [];
    try {
      entries = readEntries(this.logDir, config.getMaxEntries());
    } catch (e) {
      entries = []; // 읽기 실패해도 뷰는 살아 있게
    }
    this.view.webview.postMessage({ type: "entries", entries: entries, logDir: this.logDir });
  }

  _startWatch() {
    try {
      fs.mkdirSync(this.logDir, { recursive: true }); // 없으면 만들어 watch 가능하게
    } catch (e) {
      /* 무시 */
    }
    try {
      this.watcher = fs.watch(this.logDir, { persistent: false }, () => {
        // append가 짧게 여러 번 일어나도 한 번만 다시 읽도록 디바운스.
        if (this.debounce) clearTimeout(this.debounce);
        this.debounce = setTimeout(() => this._post(), 250);
      });
    } catch (e) {
      this.watcher = null; // watch 불가 -> 제목줄 새로고침 버튼으로 대체 가능
    }
  }

  _stopWatch() {
    if (this.debounce) {
      clearTimeout(this.debounce);
      this.debounce = null;
    }
    if (this.watcher) {
      try {
        this.watcher.close();
      } catch (e) {
        /* 무시 */
      }
      this.watcher = null;
    }
  }

  _restartWatch() {
    this._stopWatch();
    this._startWatch();
  }

  // 사이드바 HTML. 스타일/스크립트는 media/ 에서 불러오고, CSP+nonce로 안전하게 제한한다.
  _html(webview) {
    const nonce = makeNonce();
    const cssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "main.css")
    );
    const jsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "main.js")
    );
    const csp = [
      "default-src 'none'",
      "style-src " + webview.cspSource,
      "script-src 'nonce-" + nonce + "'",
      "font-src " + webview.cspSource,
    ].join("; ");
    return (
      '<!DOCTYPE html>\n' +
      '<html lang="ko">\n' +
      "<head>\n" +
      '  <meta charset="UTF-8">\n' +
      '  <meta http-equiv="Content-Security-Policy" content="' + csp + '">\n' +
      '  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
      '  <link href="' + cssUri + '" rel="stylesheet">\n' +
      "  <title>Prompt Refiner</title>\n" +
      "</head>\n" +
      "<body>\n" +
      '  <div class="toolbar">\n' +
      '    <input id="search" type="text" placeholder="검색 (원본 / 정제본 / 모델)" />\n' +
      '    <div class="controls">\n' +
      '      <span id="count" class="count"></span>\n' +
      '      <button id="diffToggle" class="ghost-btn" type="button" aria-pressed="false" title="원본과 정제본의 바뀐 부분을 강조합니다">차이 강조</button>\n' +
      "    </div>\n" +
      "  </div>\n" +
      '  <div id="list" class="list"></div>\n' +
      '  <div id="empty" class="empty"></div>\n' +
      '  <script nonce="' + nonce + '" src="' + jsUri + '"></script>\n' +
      "</body>\n" +
      "</html>\n"
    );
  }
}

// OS 파일 탐색기에서 로그 폴더를 보여준다(없으면 먼저 만든다).
function openLogFolder(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    /* 무시 */
  }
  vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(dir));
}

function makeNonce() {
  let t = "";
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) t += chars.charAt(Math.floor(Math.random() * chars.length));
  return t;
}

function activate(context) {
  const provider = new RewritesViewProvider(context);
  const engine = new EngineController(context);
  const wizard = new SetupWizard(context, engine);

  // 사용자가 직접 엔진을 끌 때(토글/끄기)만, http.proxy가 남아 Copilot이 먹통이 되지 않게 경고한다.
  // (확장 종료 시 dispose()의 stop()은 이 경고를 거치지 않는다 - 그땐 어차피 VS Code가 닫히는 중.)
  async function maybeWarnProxy() {
    if (!wizard.isProxyConfigured()) return;
    const sel = await vscode.window.showWarningMessage(
      "엔진을 껐습니다. http.proxy가 설정돼 있어 Copilot이 응답하지 않을 수 있습니다.",
      "프록시 해제",
      "유지"
    );
    if (sel === "프록시 해제") await wizard.clearProxyOnly();
  }
  async function userStopEngine() {
    engine.stop();
    await maybeWarnProxy();
  }
  function userToggleEngine() {
    if (engine.isRunning()) return userStopEngine();
    engine.start();
  }

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VIEW_ID, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("swbcPromptRefiner.refresh", () => provider.refresh()),
    vscode.commands.registerCommand("swbcPromptRefiner.openLogFolder", () =>
      openLogFolder(provider.logDir)
    ),
    vscode.commands.registerCommand("swbcPromptRefiner.toggleEngine", () => userToggleEngine()),
    vscode.commands.registerCommand("swbcPromptRefiner.startEngine", () => engine.start()),
    vscode.commands.registerCommand("swbcPromptRefiner.stopEngine", () => userStopEngine()),
    vscode.commands.registerCommand("swbcPromptRefiner.showEngineOutput", () => engine.output.show()),
    vscode.commands.registerCommand("swbcPromptRefiner.setup", () => wizard.run()),
    vscode.commands.registerCommand("swbcPromptRefiner.cleanupSetup", () => wizard.cleanup()),
    vscode.commands.registerCommand("swbcPromptRefiner.setupStatus", () => wizard.showStatus()),
    engine, // dispose()에서 엔진 프로세스를 정리
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("swbcPromptRefiner")) provider.refresh();
    })
  );

  // '@refine' Chat Participant 등록(P6). chat API가 없는 구버전 VS Code면 내부에서 조용히 비활성.
  registerChat(context);

  // 자동 시작(기본 on): 워크스페이스 로드/경로 탐색이 안정된 뒤 잠깐 늦춰 기동.
  if (config.getAutoStart()) {
    setTimeout(() => engine.start(), 800);
  }
  // 최초 1회 셋업 안내(아직 셋업 안 했고, '다시 보지 않기'를 누르지 않았을 때만).
  setTimeout(() => wizard.maybePromptFirstRun(), 1500);
}

function deactivate() {}

module.exports = { activate, deactivate };
