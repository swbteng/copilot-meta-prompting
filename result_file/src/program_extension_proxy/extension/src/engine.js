// engine.js - mitmdump(refine_copilot.py 애드온) 자식 프로세스의 생애주기 관리.
//
// 하는 일: start/stop/toggle, 출력 채널, 상태바 표시, 비정상 종료/포트 충돌 알림, 정리(kill).
// 안 하는 일(P2 범위 밖): http.proxy/CA 설정 - 그건 P3(셋업 마법사)에서 한다.
//   즉 P2는 'run.sh가 하던 프로세스 실행'만 확장이 대신 해 주는 단계다.
const vscode = require("vscode");
const cp = require("child_process");
const fs = require("fs");
const config = require("./config");

class EngineController {
  constructor(context) {
    this.context = context;
    this.proc = null;
    this._startedAt = 0;

    this.output = vscode.window.createOutputChannel("Prompt Refiner Engine");
    this.status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.status.command = "swbcPromptRefiner.toggleEngine";
    this.context.subscriptions.push(this.output, this.status);

    this._updateStatus();
    this.status.show();
  }

  isRunning() {
    return !!this.proc;
  }

  start() {
    if (this.proc) {
      vscode.window.showInformationMessage("Prompt Refiner 엔진이 이미 켜져 있습니다.");
      return;
    }
    const mitm = config.resolveMitmdump(this.context);
    const addon = config.resolveAddon(this.context);
    const logDir = config.resolveLogDir(this.context);
    const port = config.getListenPort();

    if (!addon) {
      vscode.window.showErrorMessage(
        "refine_copilot.py(애드온)를 찾지 못했습니다. 설정 swbcPromptRefiner.addonPath에 경로를 지정하거나 swbc-proxy 폴더를 여세요."
      );
      return;
    }
    try {
      fs.mkdirSync(logDir, { recursive: true });
    } catch (e) {
      /* 무시 */
    }

    // run.sh와 동일한 인자 + 포트 + LOG_DIR만 확장이 제어한다.
    const args = ["-s", addon, "--allow-hosts", "githubcopilot\\.com", "--listen-port", String(port)];
    const env = Object.assign({}, process.env, { LOG_DIR: logDir });

    this.output.appendLine("[start] " + mitm + " " + args.join(" "));
    this.output.appendLine("[start] LOG_DIR=" + logDir);

    let proc;
    try {
      proc = cp.spawn(mitm, args, { env: env, windowsHide: true });
    } catch (e) {
      this._spawnFailed(mitm, e);
      return;
    }
    this.proc = proc;
    this._startedAt = Date.now();

    proc.stdout.on("data", (d) => this.output.append(d.toString()));
    proc.stderr.on("data", (d) => this.output.append(d.toString()));

    proc.on("error", (e) => {
      this._spawnFailed(mitm, e);
      this.proc = null;
      this._updateStatus();
    });

    proc.on("exit", (code, signal) => {
      const ranMs = Date.now() - this._startedAt;
      this.output.appendLine("[exit] code=" + code + " signal=" + signal + " (" + ranMs + "ms)");
      // stop()이 부른 종료면 this.proc는 이미 null - 아래 '비정상' 알림을 건너뛴다.
      if (this.proc && ranMs < 3000 && code) {
        vscode.window
          .showErrorMessage(
            "Prompt Refiner 엔진이 곧바로 종료됐습니다(code " +
              code +
              "). 포트 " +
              port +
              "이 이미 사용 중일 수 있습니다(run.sh가 켜져 있나요?). 출력을 확인하세요.",
            "출력 보기"
          )
          .then((sel) => {
            if (sel) this.output.show();
          });
      }
      this.proc = null;
      this._updateStatus();
    });

    this._updateStatus();
  }

  stop() {
    if (!this.proc) return;
    const p = this.proc;
    this.proc = null; // exit 핸들러가 '비정상 종료'로 오인하지 않도록 먼저 비운다
    this.output.appendLine("[stop] terminating engine...");
    this._killTree(p);
    this._updateStatus();
  }

  toggle() {
    if (this.proc) this.stop();
    else this.start();
  }

  // mitmdump가 자식 프로세스를 띄울 수 있어, Windows에서는 트리 전체를 종료한다.
  _killTree(proc) {
    try {
      if (process.platform === "win32" && proc.pid) {
        cp.spawn("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { windowsHide: true });
      } else {
        proc.kill("SIGTERM");
      }
    } catch (e) {
      try {
        proc.kill();
      } catch (e2) {
        /* 무시 */
      }
    }
  }

  _spawnFailed(mitm, e) {
    this.output.appendLine("[error] spawn 실패: " + (e && e.message ? e.message : String(e)));
    vscode.window
      .showErrorMessage(
        "mitmdump 실행에 실패했습니다(" +
          mitm +
          "). .venv가 있는 swbc-proxy 폴더를 열었는지, 또는 설정 swbcPromptRefiner.mitmdumpPath를 확인하세요.",
        "출력 보기"
      )
      .then((sel) => {
        if (sel) this.output.show();
      });
  }

  _updateStatus() {
    if (this.proc) {
      this.status.text = "$(broadcast) Refiner: 켜짐";
      this.status.tooltip = "Prompt Refiner 엔진 실행 중 - 클릭하면 끕니다";
    } else {
      this.status.text = "$(circle-slash) Refiner: 꺼짐";
      this.status.tooltip = "Prompt Refiner 엔진 꺼짐 - 클릭하면 켭니다";
    }
  }

  // context.subscriptions에 등록 -> 확장 비활성화 시 자동 호출되어 프로세스를 정리한다.
  dispose() {
    this.stop();
  }
}

module.exports = { EngineController };
