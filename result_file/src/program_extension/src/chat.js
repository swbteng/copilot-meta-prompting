// chat.js - '@refine' Chat Participant: 확인형(승인 게이트) 정제. (확장 단독 구조)
//
// 우측 Copilot Chat에서 `@refine <프롬프트>`를 치면 정제본을 미리 보여주고, 5버튼으로
// 승인/재생성/원본전송/수정/취소를 묻는다. 승인 시 '최종 텍스트(정제본/원본/수정본)'를 그대로
// 네이티브 Copilot에 보낸다(workbench.action.chat.open). 답은 네이티브 Copilot 스레드에 남는다(평소대로).
//
// 프록시가 없으므로 bypass 마커/슬래시가 없다. '평범하게 친(=@refine 없는) 프롬프트'는 애초에
// 가로채지 않는다 - 정제는 오직 @refine로 명시 호출했을 때만 일어난다.
const vscode = require("vscode");
const { refine } = require("./refiner");
const logger = require("./logger");
const config = require("./config");

const PARTICIPANT_ID = "swbc.refine";

// 최종 텍스트를 네이티브 Copilot에 '자동 전송'한다(평범 메시지로 제출 -> 평소 Copilot이 답).
async function sendToCopilot(text) {
  try {
    await vscode.commands.executeCommand("workbench.action.chat.open", {
      query: String(text == null ? "" : text),
    });
  } catch (e) {
    vscode.window.showWarningMessage("Copilot 전송에 실패했습니다.");
  }
}

// 입력창에 '채우기만' 하고 전송은 안 한다(유저가 보고 엔터). isPartialQuery=true.
async function seedInput(text) {
  try {
    await vscode.commands.executeCommand("workbench.action.chat.open", {
      query: String(text == null ? "" : text),
      isPartialQuery: true,
    });
  } catch (e) {
    vscode.window.showWarningMessage("입력창 채우기에 실패했습니다.");
  }
}

function renderPreview(stream, original, refined) {
  stream.markdown("**정제본 미리보기**\n\n");
  stream.markdown("> " + String(refined).replace(/\n/g, "\n> ") + "\n\n");
  stream.markdown("_원본_: " + String(original).replace(/\n/g, " ") + "\n\n");
  // 버튼 5개. 각 버튼은 명령을 인자와 함께 호출한다(아래 registerChat에서 등록).
  // allow는 로깅을 위해 [원본, 정제본] 둘 다 넘긴다.
  stream.button({ command: "swbcPromptRefiner.refineAllow", title: "전송 (allow)", arguments: [original, refined] });
  stream.button({ command: "swbcPromptRefiner.refineTryAgain", title: "다시 정제 (try again)", arguments: [original] });
  stream.button({ command: "swbcPromptRefiner.refineUseOriginal", title: "원본 전송 (use original)", arguments: [original] });
  stream.button({ command: "swbcPromptRefiner.refineModify", title: "수정 (modify)", arguments: [refined] });
  stream.button({ command: "swbcPromptRefiner.refineCancel", title: "취소 (cancel)", arguments: [original] });
}

async function handler(request, context, stream, token) {
  try {
    const text = (request.prompt || "").trim();
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
    // allow: 정제본을 네이티브 Copilot에 자동 전송 + 교체 1건 기록(원본 -> 정제본).
    vscode.commands.registerCommand("swbcPromptRefiner.refineAllow", async (original, refined) => {
      try {
        logger.appendRewrite(config.resolveLogDir(context), {
          channel: "@refine",
          before: String(original),
          after: String(refined),
        });
      } catch (e) {
        /* 로깅 실패는 무시(fail-open) */
      }
      await sendToCopilot(refined);
    }),
    // use original: 원본을 그대로 자동 전송(정제 없음, 교체 아님 -> 미기록).
    vscode.commands.registerCommand("swbcPromptRefiner.refineUseOriginal", (original) =>
      sendToCopilot(original)
    ),
    // modify: 정제본을 입력창에 시드(평범 텍스트, 슬래시/마커 없음) -> 유저 편집 후 엔터 시 네이티브 Copilot로 직행.
    vscode.commands.registerCommand("swbcPromptRefiner.refineModify", (refined) =>
      seedInput(refined)
    ),
    // cancel: 원본을 입력창에 시드(정제 취소, 원본 돌려줌) -> 유저가 그대로 보내거나 편집.
    vscode.commands.registerCommand("swbcPromptRefiner.refineCancel", (original) =>
      seedInput(original)
    ),
    // try again: 원본으로 재정제. @refine 자동 전송으로 핸들러를 재진입시켜 새 미리보기 턴을 만든다.
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
