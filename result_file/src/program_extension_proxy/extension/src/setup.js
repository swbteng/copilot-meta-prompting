// setup.js - 최초 1회 셋업 마법사 (P3).
//
// 하는 일: "수동 셋업"(README 빠른 시작 2~3번)을 확장이 대신 실행한다.
//   1) mitmproxy CA 인증서 확보(없으면 엔진을 잠깐 띄워 생성)
//   2) certutil -user -f -addstore Root <cer>   (Windows 사용자 신뢰 루트, 보조 수단)
//   3) setx NODE_EXTRA_CA_CERTS <pem>           (Node/Copilot가 CA 신뢰 - 핵심)
//   4) http.proxy / http.proxyStrictSSL 설정    (VS Code 프록시)
//   5) "완전 종료 후 재시작" 안내                (env는 프로세스 시작 시 1회만 읽힘)
// 완료 상태는 globalState에 저장하고, 되돌리기(cleanup)도 제공한다.
//
// 안전: 모든 외부 명령은 _exec()로 감싸 throw하지 않게 하고, setx 외 실패는 보조 수단이라 계속 진행한다.
//   엔진/프록시 정제 로직(refine_copilot.py)은 건드리지 않는다 - 여긴 OS/에디터 설정만 만진다.
//
// OS 종속: 현재 Windows만(certutil/setx/reg). mac/Linux는 후순위(분기 예정).
const vscode = require("vscode");
const cp = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const config = require("./config");

// globalState 키: { done, dismissed, certPem, port, ts }
const STATE_KEY = "swbcPromptRefiner.setup";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 외부 명령 실행 헬퍼 - 절대 reject하지 않고 {code, stdout, stderr}를 돌려준다(fail-open).
function _exec(file, args) {
  return new Promise((resolve) => {
    try {
      cp.execFile(file, args, { windowsHide: true, encoding: "utf8" }, (err, stdout, stderr) => {
        let code = 0;
        if (err) code = typeof err.code === "number" ? err.code : 1;
        resolve({ code: code, stdout: stdout || "", stderr: stderr || "" });
      });
    } catch (e) {
      resolve({ code: 1, stdout: "", stderr: e && e.message ? e.message : String(e) });
    }
  });
}

class SetupWizard {
  // engine: EngineController - 인증서 생성을 위해 필요 시 잠깐 띄운다.
  constructor(context, engine) {
    this.context = context;
    this.engine = engine;
    this.output = engine.output; // 엔진과 같은 출력 채널 재사용
  }

  _state() {
    return this.context.globalState.get(STATE_KEY) || {};
  }

  _log(msg) {
    try {
      this.output.appendLine("[setup] " + msg);
    } catch (e) {
      /* 무시 */
    }
  }

  // mitmproxy 기본 confdir(~/.mitmproxy)의 인증서 경로.
  _certPaths() {
    const dir = path.join(os.homedir(), ".mitmproxy");
    return {
      dir: dir,
      pem: path.join(dir, "mitmproxy-ca-cert.pem"),
      cer: path.join(dir, "mitmproxy-ca-cert.cer"),
    };
  }

  // 인증서(pem)가 있는지 확인. 없으면 엔진을 띄워 생성하고 잠깐 기다린다.
  // pem은 NODE_EXTRA_CA_CERTS에 쓰는 필수 파일이라 이게 기준이다.
  async _ensureCaCert() {
    const p = this._certPaths();
    const have = () => {
      try {
        return fs.existsSync(p.pem);
      } catch (e) {
        return false;
      }
    };
    if (!have()) {
      if (this.engine && !this.engine.isRunning()) {
        this._log("인증서가 없어 엔진을 잠깐 띄워 생성합니다...");
        this.engine.start();
      }
      const deadline = Date.now() + 12000;
      while (Date.now() < deadline && !have()) {
        await delay(400);
      }
    }
    if (!have()) {
      throw new Error(
        "mitmproxy 인증서(" +
          p.pem +
          ")를 찾지 못했습니다. swbc-proxy 폴더를 열어 엔진을 한 번 실행한 뒤 다시 시도하세요."
      );
    }
    // certutil에는 .cer를 쓰되, 없으면 .pem으로 대체(둘 다 같은 CA).
    const cer = fs.existsSync(p.cer) ? p.cer : p.pem;
    return { pem: p.pem, cer: cer };
  }

  // 영구 설정된 NODE_EXTRA_CA_CERTS(레지스트리) 값을 조회. 없으면 null.
  async _persistedEnv() {
    const r = await _exec("reg", ["query", "HKCU\\Environment", "/v", "NODE_EXTRA_CA_CERTS"]);
    if (r.code !== 0) return null;
    const m = r.stdout.match(/NODE_EXTRA_CA_CERTS\s+REG_(?:SZ|EXPAND_SZ)\s+(.+?)\s*$/m);
    return m ? m[1].trim() : null;
  }

  // ---- 메인 셋업 ----
  async run() {
    if (process.platform !== "win32") {
      vscode.window.showWarningMessage(
        "자동 셋업은 현재 Windows만 지원합니다. macOS/Linux는 README의 수동 셋업을 참고하세요."
      );
      return;
    }
    const port = config.getListenPort();
    const intro = await vscode.window.showInformationMessage(
      "Prompt Refiner 셋업을 시작합니다. 다음을 자동으로 설정합니다:\n\n" +
        "1) mitmproxy 인증서를 Windows 신뢰 저장소에 등록\n" +
        "2) NODE_EXTRA_CA_CERTS 환경변수 설정 (Node/Copilot가 인증서를 신뢰)\n" +
        "3) VS Code 프록시 설정 (http.proxy = 127.0.0.1:" +
        port +
        ")\n\n" +
        "마지막에 VS Code를 완전히 종료했다가 다시 열어야 적용됩니다(재시작 1회).",
      { modal: true },
      "셋업 시작"
    );
    if (intro !== "셋업 시작") return;

    let certPaths = null;
    const ok = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Prompt Refiner 셋업",
        cancellable: false,
      },
      async (progress) => {
        try {
          progress.report({ message: "인증서 확인 중..." });
          certPaths = await this._ensureCaCert();
          this._log("cert pem=" + certPaths.pem);

          progress.report({ message: "Windows 신뢰 저장소에 등록 중..." });
          const r1 = await _exec("certutil", ["-user", "-f", "-addstore", "Root", certPaths.cer]);
          if (r1.code !== 0) {
            // 보조 수단이라 실패해도 계속(핵심은 NODE_EXTRA_CA_CERTS).
            this._log("certutil 실패(code " + r1.code + "): " + (r1.stderr || r1.stdout).trim());
          } else {
            this._log("certutil addstore OK");
          }

          progress.report({ message: "NODE_EXTRA_CA_CERTS 설정 중..." });
          const r2 = await _exec("setx", ["NODE_EXTRA_CA_CERTS", certPaths.pem]);
          if (r2.code !== 0) {
            throw new Error("setx 실패: " + (r2.stderr || r2.stdout).trim());
          }
          this._log("setx NODE_EXTRA_CA_CERTS OK");

          progress.report({ message: "VS Code 프록시 설정 중..." });
          const http = vscode.workspace.getConfiguration("http");
          await http.update("proxy", "http://127.0.0.1:" + port, vscode.ConfigurationTarget.Global);
          await http.update("proxyStrictSSL", false, vscode.ConfigurationTarget.Global);
          this._log("http.proxy = http://127.0.0.1:" + port);

          await this.context.globalState.update(
            STATE_KEY,
            Object.assign({}, this._state(), {
              done: true,
              certPem: certPaths.pem,
              port: port,
              ts: new Date().toISOString(),
            })
          );
          return true;
        } catch (e) {
          const m = e && e.message ? e.message : String(e);
          this._log("실패: " + m);
          vscode.window.showErrorMessage("Prompt Refiner 셋업 실패: " + m, "출력 보기").then((sel) => {
            if (sel) this.output.show();
          });
          return false;
        }
      }
    );
    if (!ok) return;
    await this._promptRestart();
  }

  async _promptRestart() {
    const sel = await vscode.window.showInformationMessage(
      "셋업이 완료됐습니다.\n\n" +
        "변경(NODE_EXTRA_CA_CERTS)을 적용하려면 VS Code를 완전히 종료한 뒤 다시 열어야 합니다. " +
        "창 새로고침(Reload Window)만으로는 적용되지 않습니다.",
      { modal: true },
      "지금 VS Code 종료",
      "나중에"
    );
    if (sel === "지금 VS Code 종료") {
      vscode.commands.executeCommand("workbench.action.quit");
    }
  }

  // ---- 되돌리기(cleanup) ----
  async cleanup() {
    if (process.platform !== "win32") {
      vscode.window.showWarningMessage("되돌리기는 현재 Windows만 지원합니다.");
      return;
    }
    const sel = await vscode.window.showWarningMessage(
      "Prompt Refiner 셋업을 되돌립니다:\n\n" +
        "1) 신뢰 저장소에서 mitmproxy 인증서 제거\n" +
        "2) NODE_EXTRA_CA_CERTS 환경변수 제거\n" +
        "3) VS Code 프록시(http.proxy / proxyStrictSSL) 해제\n\n" +
        "되돌린 뒤에도 완전 적용은 VS Code 재시작 후입니다.",
      { modal: true },
      "되돌리기"
    );
    if (sel !== "되돌리기") return;

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Prompt Refiner 되돌리기",
        cancellable: false,
      },
      async (progress) => {
        progress.report({ message: "인증서 제거 중..." });
        const r1 = await _exec("certutil", ["-user", "-delstore", "Root", "mitmproxy"]);
        this._log("certutil delstore code=" + r1.code);

        progress.report({ message: "환경변수 제거 중..." });
        const r2 = await _exec("reg", [
          "delete",
          "HKCU\\Environment",
          "/v",
          "NODE_EXTRA_CA_CERTS",
          "/f",
        ]);
        this._log("reg delete NODE_EXTRA_CA_CERTS code=" + r2.code);

        progress.report({ message: "프록시 해제 중..." });
        await this.clearProxyOnly();

        await this.context.globalState.update(
          STATE_KEY,
          Object.assign({}, this._state(), { done: false })
        );
      }
    );

    await vscode.window.showInformationMessage(
      "되돌리기 완료. VS Code를 다시 시작하면 완전히 적용됩니다.",
      { modal: true },
      "확인"
    );
  }

  // http.proxy 설정만 해제(엔진을 끌 때 'Copilot 먹통' 방지용으로도 쓴다).
  async clearProxyOnly() {
    const http = vscode.workspace.getConfiguration("http");
    await http.update("proxy", undefined, vscode.ConfigurationTarget.Global);
    await http.update("proxyStrictSSL", undefined, vscode.ConfigurationTarget.Global);
    this._log("http.proxy 해제");
  }

  // 현재 http.proxy가 우리 프록시(127.0.0.1)를 가리키는가 - 엔진 정지 경고에 쓴다.
  isProxyConfigured() {
    try {
      const p = vscode.workspace.getConfiguration("http").get("proxy");
      return typeof p === "string" && p.indexOf("127.0.0.1") !== -1;
    } catch (e) {
      return false;
    }
  }

  // ---- 상태 보기 ----
  async showStatus() {
    const st = this._state();
    const p = this._certPaths();
    let certExists = false;
    try {
      certExists = fs.existsSync(p.pem);
    } catch (e) {
      /* 무시 */
    }
    const httpProxy = vscode.workspace.getConfiguration("http").get("proxy") || "(없음)";
    const envActive = !!process.env.NODE_EXTRA_CA_CERTS;
    let envPersisted = null;
    if (process.platform === "win32") {
      try {
        envPersisted = await this._persistedEnv();
      } catch (e) {
        /* 무시 */
      }
    }

    const lines = [
      "인증서 파일: " + (certExists ? p.pem : "없음 (엔진을 한 번 실행하세요)"),
      "NODE_EXTRA_CA_CERTS (영구): " + (envPersisted || "(설정 안 됨)"),
      "NODE_EXTRA_CA_CERTS (현재 적용): " + (envActive ? "예" : "아니오 (재시작 필요)"),
      "http.proxy: " + httpProxy,
      "셋업 완료 표시: " + (st.done ? "예" : "아니오"),
    ];
    const action = st.done ? "되돌리기" : "셋업 실행";
    const sel = await vscode.window.showInformationMessage(
      "Prompt Refiner 셋업 상태\n\n" + lines.join("\n"),
      { modal: true },
      action
    );
    if (sel === "셋업 실행") this.run();
    else if (sel === "되돌리기") this.cleanup();
  }

  // ---- 최초 실행 안내 ----
  // 셋업이 안 됐고, 사용자가 '다시 보지 않기'를 누르지 않았으면 가볍게 안내한다.
  async maybePromptFirstRun() {
    if (process.platform !== "win32") return;
    const st = this._state();
    if (st.done || st.dismissed) return;
    const sel = await vscode.window.showInformationMessage(
      "Prompt Refiner: Copilot 트래픽을 가로채려면 최초 1회 셋업(CA 신뢰 + 프록시 설정 + 재시작)이 필요합니다.",
      "셋업 실행",
      "나중에",
      "다시 보지 않기"
    );
    if (sel === "셋업 실행") {
      this.run();
    } else if (sel === "다시 보지 않기") {
      await this.context.globalState.update(STATE_KEY, Object.assign({}, st, { dismissed: true }));
    }
  }
}

module.exports = { SetupWizard, STATE_KEY };
