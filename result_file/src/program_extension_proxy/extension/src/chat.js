// chat.js - '@refine' Chat Participant (P6): 확인형(승인 게이트) 정제.
//
// 우측 Copilot Chat에서 `@refine <프롬프트>`를 치면 정제본을 미리 보여주고, 5버튼으로
// 승인/재생성/원본전송/수정/취소를 묻는다. 전송은 네이티브 Copilot에 위임하고
// (workbench.action.chat.open), '정제 건너뛰기' 전송엔 bypass 마커를 붙여 자동 프록시가
// 이중 정제하지 않게 한다. 기존 전역 자동 Refiner(켜짐/꺼짐)와 충돌 없이 공존한다.
//
// 슬래시 컨벤션(확정): 기본은 슬래시 없는 `@refine <프롬프트>`. '정제 건너뛰고 전송'은 `@refine /bypass`
// 하나. allow/use-original은 확장이 마커를 직접 붙여 프로그램적으로 전송(슬래시 안 보임).
// modify만 입력창에 `@refine /bypass <정제본>`을 시드해 유저가 보고 편집한다. cancel은 `@refine <원본>` 시드.
const vscode = require("vscode");
const { refine, attachBypass } = require("./refiner");

const PARTICIPANT_ID = "swbc.refine";

// 정제본/원본을 네이티브 Copilot에 '바로 전송'(정제 건너뜀: 마커 부착 -> 프록시 통과).
async function sendBypassed(text) {
  try {
    const query = attachBypass(text);
    await vscode.commands.executeCommand("workbench.action.chat.open", { query });
  } catch (e) {
    vscode.window.showWarningMessage("Copilot 전송에 실패했습니다.");
  }
}

// 입력창에 채우기만 하고 전송은 안 함(유저가 보고 엔터 치게). isPartialQuery=true.
async function seedInput(query) {
  try {
    await vscode.commands.executeCommand("workbench.action.chat.open", { query, isPartialQuery: true });
  } catch (e) {
    vscode.window.showWarningMessage("입력창 채우기에 실패했습니다.");
  }
}

function renderPreview(stream, original, refined) {
  stream.markdown("**정제본 미리보기**\n\n");
  stream.markdown("> " + String(refined).replace(/\n/g, "\n> ") + "\n\n");
  stream.markdown("_원본_: " + String(original).replace(/\n/g, " ") + "\n\n");
  // 버튼 5개. 각 버튼은 명령을 인자와 함께 호출한다(아래 registerChat에서 등록).
  stream.button({ command: "swbcPromptRefiner.refineAllow", title: "전송 (allow)", arguments: [refined] });
  stream.button({ command: "swbcPromptRefiner.refineTryAgain", title: "다시 정제 (try again)", arguments: [original] });
  stream.button({ command: "swbcPromptRefiner.refineUseOriginal", title: "원본 전송 (use original)", arguments: [original] });
  stream.button({ command: "swbcPromptRefiner.refineModify", title: "수정 (modify)", arguments: [refined] });
  stream.button({ command: "swbcPromptRefiner.refineCancel", title: "취소 (cancel)", arguments: [original] });
}

async function handler(request, context, stream, token) {
  try {
    const text = (request.prompt || "").trim();

    // '/bypass': modify 입력창 시드 등 '이미 확정된' 텍스트 -> 정제 없이 마커 붙여 전송.
    if (request.command === "bypass") {
      if (!text) {
        stream.markdown("보낼 내용이 없습니다.");
        return;
      }
      await sendBypassed(text);
      stream.markdown("정제 없이 그대로 전송했습니다.");
      return;
    }

    // 기본: 정제 -> 미리보기 + 버튼.
    if (!text) {
      stream.markdown("정제할 프롬프트를 함께 입력하세요. 예: `@refine 1+1이 뭐야?`");
      return;
    }
    const refined = await refine(text);
    renderPreview(stream, text, String(refined));
  } catch (e) {
    // fail-open: 미리보기 실패해도 확장/Copilot 흐름은 살아 있게.
    try {
      stream.markdown("정제 미리보기에 실패했습니다(fail-open). 그대로 보내려면 다시 입력해 주세요.");
    } catch (_) {
      /* 무시 */
    }
  }
}

function registerChat(context) {
  let participant;
  try {
    participant = vscode.chat.createChatParticipant(PARTICIPANT_ID, handler);
    participant.iconPath = vscode.Uri.joinPath(context.extensionUri, "media", "icon.svg");
  } catch (e) {
    // chat API가 없는(구버전) VS Code -> 조용히 비활성(나머지 확장 기능엔 영향 없음).
    return;
  }
  context.subscriptions.push(
    participant,
    // allow / use original: 확정 텍스트를 마커 붙여 네이티브 Copilot에 바로 전송.
    vscode.commands.registerCommand("swbcPromptRefiner.refineAllow", (refined) => sendBypassed(refined)),
    vscode.commands.registerCommand("swbcPromptRefiner.refineUseOriginal", (original) => sendBypassed(original)),
    // modify: 입력창에 `@refine /bypass <정제본>` 시드 -> 유저 편집 후 엔터 시 위 '/bypass' 핸들러로.
    vscode.commands.registerCommand("swbcPromptRefiner.refineModify", (refined) =>
      seedInput("@refine /bypass " + String(refined))
    ),
    // cancel: 입력창에 `@refine <원본>`(슬래시 없음) 시드 -> 엔터 시 기본 흐름 재진입(자연히 재정제).
    vscode.commands.registerCommand("swbcPromptRefiner.refineCancel", (original) =>
      seedInput("@refine " + String(original))
    ),
    // try again: 원본으로 다시 정제. 기본 흐름을 재진입시켜 새 미리보기 턴을 만든다.
    vscode.commands.registerCommand("swbcPromptRefiner.refineTryAgain", async (original) => {
      try {
        await vscode.commands.executeCommand("workbench.action.chat.open", {
          query: "@refine " + String(original),
        });
      } catch (e) {
        vscode.window.showWarningMessage("다시 정제 호출에 실패했습니다.");
      }
    })
  );
}

module.exports = { registerChat };
