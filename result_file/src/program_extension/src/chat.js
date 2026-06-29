// chat.js - '@refine' Chat Participant: 확인형(승인 게이트) 정제. (확장 단독 구조)
//
// 우측 Copilot Chat에서 `@refine <프롬프트>`를 치면 정제본을 미리 보여주고, '가로 액션 바'(codicon
// 커맨드 링크 5개)로 승인/재생성/원본전송/수정/취소를 묻는다. 승인 시 '최종 텍스트(정제본/원본/수정본)'를 그대로
// 우측 Copilot Chat에서 `@refine <프롬프트>`를 치면 정제본을 미리 보여주고, '가로 액션 바'(codicon
// 커맨드 링크 5개)로 승인/재생성/원본전송/수정/취소를 묻는다. 승인 시 '최종 텍스트(정제본/원본/수정본)'를 그대로
// 네이티브 Copilot에 보낸다(workbench.action.chat.open). 답은 네이티브 Copilot 스레드에 남는다(평소대로).
//
// 프록시가 없으므로 bypass 마커/슬래시가 없다. '평범하게 친(=@refine 없는) 프롬프트'는 애초에
// 가로채지 않는다 - 정제는 오직 @refine로 명시 호출했을 때만 일어난다.
const vscode = require("vscode");
const refinerMod = require("./refiner");
const logger = require("./logger");
const config = require("./config");

// refine를 '성공/실패 구분'해서 부른다. refineDetailed가 있으면 그걸 쓰고(서버 실패를 ok:false로 구분),
// 없으면(구버전/주입된 refiner) 기존 refine를 호출해 성공으로 취급한다(하위호환).
async function refinePrompt(text) {
  if (typeof refinerMod.refineDetailed === "function") {
    return await refinerMod.refineDetailed(text);
  }
  const out = await refinerMod.refine(text);
  return { text: out, ok: true, reason: "legacy" };
}

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

// 액션 버튼이 호출하는 명령 5개(아래 registerChat에서 등록). 가로 액션 바의 신뢰 명령 목록으로도 쓴다.
const ACTION_COMMANDS = [
  "swbcPromptRefiner.refineAllow",
  "swbcPromptRefiner.refineTryAgain",
  "swbcPromptRefiner.refineUseOriginal",
  "swbcPromptRefiner.refineModify",
  "swbcPromptRefiner.refineCancel",
];

// codicon + 라벨을 통째로 클릭 가능한 '커맨드 링크' 한 조각으로 만든다.
// 인자는 JSON -> URI 인코딩해서 쿼리스트링으로 붙인다(VS Code chat 커맨드 링크 규약).
function actionLink(icon, label, command, args) {
  const q = encodeURIComponent(JSON.stringify(args));
  return "[$(" + icon + ") " + label + "](command:" + command + "?" + q + ")";
}

// R-EX-11 통신 실패 시 쓰는 축소 액션 집합(원본 전송 / 취소). 신뢰 명령 목록으로도 쓴다.
const FALLBACK_COMMANDS = [
  "swbcPromptRefiner.refineUseOriginal",
  "swbcPromptRefiner.refineTryAgain",
  "swbcPromptRefiner.refineCancel",
];

// [폴백의 폴백] 커맨드 링크가 막힌 환경 -> 세로 stream.button(원본 전송/재시도/취소)으로 동작.
function renderFailureButtons(stream, original) {
  stream.button({ command: "swbcPromptRefiner.refineUseOriginal", title: "원본 전송 (use original)", arguments: [original] });
  stream.button({ command: "swbcPromptRefiner.refineTryAgain", title: "재시도 (try again)", arguments: [original] });
  stream.button({ command: "swbcPromptRefiner.refineCancel", title: "취소 (cancel)", arguments: [original] });
}

// R-EX-11: 정제 서버 타임아웃/오류 시 — 무한 로딩 없이 '에러 메시지 + Use original/재시도/Cancel'
// Fallback UI를 띄운다. throw하지 않는다(fail-open). 재시도는 동일 원본으로 정제 서버에 다시 요청한다.
function renderFailureFallback(stream, original) {
  stream.markdown("⚠️ 정제 서버 호출에 **실패**했습니다(타임아웃 또는 오류). 무한 로딩 없이 아래에서 선택하세요.\n\n");
  stream.markdown("_원본_: " + String(original).replace(/\n/g, " ") + "\n\n");
  try {
    const bar = new vscode.MarkdownString(
      actionLink("arrow-right", "**원본 전송**", "swbcPromptRefiner.refineUseOriginal", [original]) +
        "  ·  " + actionLink("refresh", "재시도", "swbcPromptRefiner.refineTryAgain", [original]) +
        "  ·  " + actionLink("close", "취소", "swbcPromptRefiner.refineCancel", [original])
    );
    bar.isTrusted = { enabledCommands: FALLBACK_COMMANDS };
    bar.supportThemeIcons = true;
    stream.markdown(bar);
  } catch (e) {
    renderFailureButtons(stream, original);
  }
}

// [폴백] 커맨드 링크가 막힌(구버전 등) 환경 -> 기존 세로 stream.button 5개로 그대로 동작.
function renderActionsFallback(stream, original, refined) {
  stream.button({ command: "swbcPromptRefiner.refineAllow", title: "전송 (allow)", arguments: [original, refined] });
  stream.button({ command: "swbcPromptRefiner.refineTryAgain", title: "다시 정제 (try again)", arguments: [original] });
  stream.button({ command: "swbcPromptRefiner.refineUseOriginal", title: "원본 전송 (use original)", arguments: [original] });
  stream.button({ command: "swbcPromptRefiner.refineModify", title: "수정 (modify)", arguments: [refined] });
  stream.button({ command: "swbcPromptRefiner.refineCancel", title: "취소 (cancel)", arguments: [original] });
}

function renderPreview(stream, original, refined) {
  // 미리보기 본문(정제본/원본)은 평범한 마크다운.
  stream.markdown("**정제본 미리보기**\n\n");
  stream.markdown("> " + String(refined).replace(/\n/g, "\n> ") + "\n\n");
  stream.markdown("_원본_: " + String(original).replace(/\n/g, " ") + "\n\n");

  // 액션 바: 세로로 쌓이는 stream.button 5개 대신, codicon이 붙은 커맨드 링크를 '한 줄에 가로'로
  // 배치해 현대적·컴팩트하게 보여준다. (LG 디자인 참고: 1차 액션[전송]만 굵게 강조 + 간결한 라벨.)
  // VS Code chat은 커맨드 링크/codicon에 커스텀 색을 줄 수 없어 색은 테마를 따른다 — 배치/강조로 모던함을 낸다.
  try {
    const bar = new vscode.MarkdownString(
      actionLink("check", "**전송**", "swbcPromptRefiner.refineAllow", [original, refined]) +
        "  ·  " + actionLink("edit", "수정", "swbcPromptRefiner.refineModify", [refined]) +
        "  ·  " + actionLink("refresh", "다시 정제", "swbcPromptRefiner.refineTryAgain", [original]) +
        "  ·  " + actionLink("arrow-right", "원본 전송", "swbcPromptRefiner.refineUseOriginal", [original]) +
        "  ·  " + actionLink("close", "취소", "swbcPromptRefiner.refineCancel", [original])
    );
    bar.isTrusted = { enabledCommands: ACTION_COMMANDS }; // 커맨드 링크 실행 허용(이 명령들만)
    bar.supportThemeIcons = true; // $(...) codicon 렌더 활성
    stream.markdown(bar);
  } catch (e) {
    // fail-open: 커맨드 링크 렌더가 막히면 기존 세로 버튼으로 폴백(기능은 동일).
    renderActionsFallback(stream, original, refined);
  }
}

function renderPreview(stream, original, refined) {
  // 미리보기 본문(정제본/원본)은 평범한 마크다운.
  stream.markdown("**정제본 미리보기**\n\n");
  stream.markdown("> " + String(refined).replace(/\n/g, "\n> ") + "\n\n");
  stream.markdown("_원본_: " + String(original).replace(/\n/g, " ") + "\n\n");

  // 액션 바: 세로로 쌓이는 stream.button 5개 대신, codicon이 붙은 커맨드 링크를 '한 줄에 가로'로
  // 배치해 현대적·컴팩트하게 보여준다. (LG 디자인 참고: 1차 액션[전송]만 굵게 강조 + 간결한 라벨.)
  // VS Code chat은 커맨드 링크/codicon에 커스텀 색을 줄 수 없어 색은 테마를 따른다 — 배치/강조로 모던함을 낸다.
  try {
    const bar = new vscode.MarkdownString(
      actionLink("check", "**전송**", "swbcPromptRefiner.refineAllow", [original, refined]) +
        "  ·  " + actionLink("edit", "수정", "swbcPromptRefiner.refineModify", [refined]) +
        "  ·  " + actionLink("refresh", "다시 정제", "swbcPromptRefiner.refineTryAgain", [original]) +
        "  ·  " + actionLink("arrow-right", "원본 전송", "swbcPromptRefiner.refineUseOriginal", [original]) +
        "  ·  " + actionLink("close", "취소", "swbcPromptRefiner.refineCancel", [original])
    );
    bar.isTrusted = { enabledCommands: ACTION_COMMANDS }; // 커맨드 링크 실행 허용(이 명령들만)
    bar.supportThemeIcons = true; // $(...) codicon 렌더 활성
    stream.markdown(bar);
  } catch (e) {
    // fail-open: 커맨드 링크 렌더가 막히면 기존 세로 버튼으로 폴백(기능은 동일).
    renderActionsFallback(stream, original, refined);
  }
}

async function handler(request, context, stream, token) {
  let text = "";
  try {
    text = (request.prompt || "").trim();
    // 기본: 정제 -> 미리보기 + 버튼.
    if (!text) {
      stream.markdown("정제할 프롬프트를 함께 입력하세요. 예: `@refine 1+1이 뭐야?`");
      return;
    }
    const result = await refinePrompt(text);
    if (!result || result.ok === false) {
      // R-EX-11: 정제 서버 실패 -> 에러 메시지 + Use original/Cancel Fallback UI.
      renderFailureFallback(stream, text);
      return;
    }
    renderPreview(stream, text, String(result.text));
  } catch (e) {
    // fail-open: 미리보기 실패해도 확장/Copilot 흐름은 살아 있게. 원본으로 진행할 수 있게 Fallback UI 제공.
    try {
      renderFailureFallback(stream, text || (request && request.prompt) || "");
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
    // cancel: 정제 취소 -> 원본을 '@refine '를 붙여 입력창에 시드. 유저가 그대로 엔터하면 다시 정제 흐름으로
    // 진입(취소했더라도 @refine 컨텍스트 유지). 성공 미리보기/실패 Fallback 양쪽의 취소가 이 명령을 공유한다.
    vscode.commands.registerCommand("swbcPromptRefiner.refineCancel", (original) =>
      seedInput("@refine " + String(original == null ? "" : original))
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
