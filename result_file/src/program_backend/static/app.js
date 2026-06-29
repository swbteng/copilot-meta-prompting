// 파이프라인 시각화 데모.
// backend API(/rewrite -> /search -> /rerank -> /generate)를 순서대로 호출하며
// 각 단계의 입력/출력을 카드로 그려준다. 페이지가 backend와 같은 서버에서 서빙되므로
// API 주소는 상대경로를 쓴다(별도 호스트 설정 불필요).

const pipelineEl = document.querySelector("#pipeline");
const runBtn = document.querySelector("#run");
const promptEl = document.querySelector("#prompt");

const SEARCH_TOP_K = 20; // 검색 단계에서 가져와 보여줄 후보 수 (config 의 CHROMA_TOP_K 기본값과 동일)
const RERANK_TOP_N = 3; // 리랭킹 후 최종 템플릿 수 (generate 입력)

// 후보 행을 클릭하면 원본 템플릿을 모달로 보여주기 위해, 마지막 검색/리랭킹 결과를 보관한다.
const state = { search: [], rerank: [] };

runBtn.addEventListener("click", run);
promptEl.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") run();
});

// 후보 행(.cand) 클릭 -> 해당 템플릿 원본(document)을 모달로. 이벤트 위임이라 한 번만 등록.
pipelineEl.addEventListener("click", (e) => {
  const row = e.target.closest(".cand[data-idx]");
  if (!row) return;
  const item = (state[row.dataset.list] || [])[Number(row.dataset.idx)];
  if (item) openTemplateModal(titleOf(item), item.document);
});

async function run() {
  const prompt = promptEl.value.trim();
  if (!prompt) {
    promptEl.focus();
    return;
  }

  runBtn.disabled = true;
  pipelineEl.hidden = false;
  pipelineEl.innerHTML = "";
  state.search = [];
  state.rerank = [];

  // Step 0: 사용자가 넣은 원본 입력
  addStep("0", "사용자 입력").body.innerHTML = `<div class="box">${esc(prompt)}</div>`;

  try {
    // (1) 정제 - LLM 호출 1. 원본을 영어 번역 + 구조화된 검색 쿼리로 재작성.
    const rw = await step(
      "1",
      "정제 (rewrite) · LLM",
      () => callApi("/rewrite", { prompt }),
      (r) => `
        <div class="field-label">영어 번역 (translated_input)</div>
        <div class="box">${esc(r.translated_input || "—")}</div>
        <div class="field-label">정제된 검색 쿼리 (rewritten_prompt)</div>
        <div class="box">${esc(r.rewritten_prompt || "—")}</div>`
    );

    // 검색에는 정제된 프롬프트를 쓰고, 생성에는 번역본과 정제 프롬프트를 모두 넘긴다(파이프라인과 동일한 규칙).
    const query = rw.rewritten_prompt || rw.translated_input || prompt;
    const translatedInput = rw.translated_input || prompt;
    const rewrittenPrompt = rw.rewritten_prompt || rw.translated_input || prompt;

    // (2) 벡터 검색 - 임베딩 호출 1. 쿼리를 임베딩해 가까운 템플릿 후보를 가져온다.
    await step(
      "2",
      "벡터 검색 (search) · 임베딩",
      () => callApi("/search", { query, top_k: SEARCH_TOP_K }),
      (r) => {
        state.search = r.results || [];
        return candidateList(state.search, "search", false);
      }
    );

    // (3) 리랭킹 - 리랭커 호출 1. 후보를 정밀 재채점해 상위 N개로 좁힌다.
    const rr = await step(
      "3",
      "리랭킹 (rerank) · 리랭커",
      () => callApi("/rerank", { query, chroma_top_k: SEARCH_TOP_K, top_n: RERANK_TOP_N }),
      (r) => {
        state.rerank = r.results || [];
        return candidateList(state.rerank, "rerank", true);
      }
    );

    // 리랭킹된 상위 템플릿 본문을 generate 입력으로 넘긴다.
    const templates = (rr.results || []).map((c) => c.document).filter(Boolean);

    // (4) 최종 생성 - LLM 호출 2. 선택 템플릿을 사용자 요청에 맞게 적응시킨다.
    await step(
      "4",
      "최종 생성 (generate) · LLM",
      () => callApi("/generate", { translated_input: translatedInput, rewritten_prompt: rewrittenPrompt, templates }),
      (r) => `
        <div class="muted-note">선택된 템플릿을 사용자 요청에 맞게 적응시킨 최종 프롬프트입니다.</div>
        <div class="box final" style="margin-top:12px" id="final">${esc(r.adapted_prompt || "—")}</div>
        <button class="copy" id="copyBtn">복사</button>`
    );

    const copyBtn = document.querySelector("#copyBtn");
    if (copyBtn) {
      copyBtn.addEventListener("click", () => {
        navigator.clipboard.writeText(document.querySelector("#final").textContent);
        copyBtn.textContent = "복사됨 ✓";
        setTimeout(() => (copyBtn.textContent = "복사"), 1500);
      });
    }
  } catch (err) {
    // 실패한 단계 카드에 이미 에러를 표시했으므로 여기선 콘솔만 남긴다.
    console.error(err);
  } finally {
    runBtn.disabled = false;
  }
}

// 검색/리랭킹 후보 목록 렌더(공통). withScore=true면 rerank_score 막대, false면 코사인 거리 칩.
// 각 행에 data-list/data-idx 를 달아, 클릭하면 state 에서 원본 템플릿을 찾아 모달로 띄운다.
function candidateList(items, listName, withScore) {
  const note = withScore
    ? `후보를 정밀 재채점해 상위 ${items.length}개로 좁혔습니다 (점수가 높을수록 적합). 행을 클릭하면 원본 템플릿을 봅니다.`
    : `쿼리를 임베딩해 가까운 템플릿 ${items.length}개를 찾았습니다 (코사인 거리 = 1 − 유사도, 작을수록 유사). 행을 클릭하면 원본 템플릿을 봅니다.`;
  const max = Math.max(...items.map((c) => c.rerank_score || 0), 1e-6);
  const rows = items
    .map((c, i) => {
      const metric = withScore
        ? `<span class="bar-track"><span class="bar-fill" style="width:${Math.round(
            ((c.rerank_score || 0) / max) * 100
          )}%"></span></span><span class="chip">${fmt(c.rerank_score)}</span>`
        : `<span class="chip">dist ${fmt(c.chroma_distance)}</span>`;
      const rank = withScore ? i + 1 : c.chroma_rank;
      return `
        <div class="cand" data-list="${listName}" data-idx="${i}">
          <span class="cand-rank">${rank}</span>
          <span class="cand-title">${esc(titleOf(c))}</span>
          ${metric}
          <span class="cand-view">원본 ›</span>
        </div>`;
    })
    .join("");
  return `<div class="muted-note">${note}</div><div style="margin-top:12px">${rows}</div>`;
}

// 원본 템플릿 모달. 오버레이/X/ESC 어느 것으로도 닫힌다.
function openTemplateModal(title, doc) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modal-head">
        <span class="modal-title">${esc(title)}</span>
        <button class="modal-close" aria-label="닫기">×</button>
      </div>
      <div class="modal-body">${esc(doc || "(원본 템플릿이 없습니다)")}</div>
    </div>`;
  document.body.appendChild(overlay);

  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
  };
  function onKey(e) {
    if (e.key === "Escape") close();
  }
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  overlay.querySelector(".modal-close").addEventListener("click", close);
  document.addEventListener("keydown", onKey);
}

// 단계 카드 추가 -> 스피너 -> API 호출 -> 렌더. 결과 JSON을 반환해 다음 단계가 쓰게 한다.
async function step(num, titleText, apiFn, renderFn) {
  const { body, time } = addStep(num, titleText);
  body.innerHTML = `<div class="spinner"></div>`;
  const t0 = performance.now();
  try {
    const data = await apiFn();
    time.textContent = ((performance.now() - t0) / 1000).toFixed(2) + "s";
    body.innerHTML = renderFn(data);
    return data;
  } catch (e) {
    time.textContent = "";
    body.innerHTML = `<div class="error">실패: ${esc(e.message)}</div>`;
    throw e;
  }
}

// 화살표 + 빈 카드 골격을 만들어 붙이고 { body, time } 핸들을 돌려준다.
function addStep(num, titleText) {
  if (pipelineEl.children.length > 0) {
    const arrow = document.createElement("div");
    arrow.className = "arrow";
    arrow.textContent = "↓";
    pipelineEl.appendChild(arrow);
  }
  const card = document.createElement("section");
  card.className = "step";
  card.innerHTML = `
    <div class="step-head">
      <span class="badge">${num}</span>
      <span class="step-title">${titleText}</span>
      <span class="time"></span>
    </div>
    <div class="step-body"></div>`;
  pipelineEl.appendChild(card);
  card.scrollIntoView({ behavior: "smooth", block: "center" });
  return { body: card.querySelector(".step-body"), time: card.querySelector(".time") };
}

async function callApi(path, payload) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let detail = res.status + " " + res.statusText;
    try {
      const j = await res.json();
      if (j.detail) detail = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
    } catch (_) {
      /* 본문이 JSON이 아니면 상태코드만 */
    }
    throw new Error(detail);
  }
  return res.json();
}

function titleOf(c) {
  return (c.metadata && (c.metadata.title || c.metadata.template_id)) || c.id || "(제목 없음)";
}
function fmt(x) {
  return x == null ? "—" : Number(x).toFixed(3);
}
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
