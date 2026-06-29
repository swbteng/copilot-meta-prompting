// _helpers/vscode-stub.js
// 확장 코드(chat.js / config.js)는 require("vscode")로 VS Code API에 의존한다.
// .vsix가 실제로 설치/구동되는 환경(Extension Host)에서만 'vscode' 모듈이 존재하므로,
// 단위 테스트에서는 Module._load를 후킹해 경량 목(stub)을 주입한다(추가 의존성 0).
//
// 목은 호출 사실을 state에 '캡처'만 한다 -> 테스트는 "우리 코드가 VS Code에 무엇을 시켰는가"
// (전송 쿼리/isPartialQuery/등록한 참가자·명령)를 결정론적으로 검증할 수 있다.
const Module = require("module");

const state = {
  participants: [], // createChatParticipant(id, handler)
  commands: new Map(), // registerCommand(id, fn)
  executeCalls: [], // executeCommand(cmd, ...args)
  warnings: [], // window.showWarningMessage(msg)
  config: {}, // workspace.getConfiguration().get(key)
};

function reset() {
  state.participants.length = 0;
  state.commands.clear();
  state.executeCalls.length = 0;
  state.warnings.length = 0;
  state.config = {};
}

const vscode = {
  chat: {
    createChatParticipant(id, handler) {
      const p = { id, handler, iconPath: undefined, dispose() {} };
      state.participants.push(p);
      return p;
    },
  },
  commands: {
    registerCommand(id, fn) {
      state.commands.set(id, fn);
      return { dispose() {} };
    },
    executeCommand(cmd, ...args) {
      state.executeCalls.push({ cmd, args });
      return Promise.resolve();
    },
  },
  window: {
    showWarningMessage(msg) {
      state.warnings.push(msg);
    },
    setStatusBarMessage() {},
    registerWebviewViewProvider() {
      return { dispose() {} };
    },
  },
  workspace: {
    getConfiguration() {
      return { get: (k) => state.config[k] };
    },
    onDidChangeConfiguration() {
      return { dispose() {} };
    },
  },
  Uri: {
    joinPath(base, ...parts) {
      const basePath = base && base.fsPath ? base.fsPath : String(base || "");
      return { fsPath: [basePath, ...parts].join("/"), toString: () => "uri" };
    },
    file(p) {
      return { fsPath: p, toString: () => "file://" + p };
    },
  },
  // chat.js renderPreview가 쓰는 신뢰 MarkdownString. value에 액션 바 문자열이 누적된다.
  MarkdownString: class {
    constructor(v) {
      this.value = v || "";
      this.isTrusted = undefined;
      this.supportThemeIcons = false;
    }
    appendMarkdown(s) {
      this.value += s;
      return this;
    }
  },
  env: { clipboard: { writeText() {} } },
};

// 한 번만 후킹(여러 테스트 파일이 같은 프로세스를 공유해도 안전).
if (!Module.__vscodeStubInstalled) {
  const orig = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === "vscode") return vscode;
    return orig.apply(this, arguments);
  };
  Module.__vscodeStubInstalled = true;
}

// 캡처형 ChatResponseStream 목.
function makeStream() {
  const md = [];
  const buttons = [];
  return {
    markdown(v) {
      md.push(typeof v === "string" ? v : (v && v.value) || "");
    },
    button(b) {
      buttons.push(b);
    },
    progress() {},
    _md: md,
    _buttons: buttons,
    text() {
      return md.join("");
    },
  };
}

module.exports = { vscode, state, reset, makeStream };
