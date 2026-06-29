// 벡터 DB 시각화 탭.
// (1) /viz/map 으로 미리 계산된 2D 지도(651개 템플릿 점 + 군집)를 받아 캔버스에 흩뿌린다.
// (2) 사용자가 프롬프트를 넣으면 /viz/query (정제 없이 바로 임베딩·검색)로
//     가까운 템플릿과 "내 프롬프트" 위치를 받아 지도에 함께 표시한다.
// esc() / fmt() / openTemplateModal() 은 app.js 전역 함수를 그대로 재사용한다.

const vizState = {
  loaded: false,
  loading: false,
  points: [], // 전체 지도 점 [{id,title,tags,x,y,cluster}]
  clusterById: {}, // cluster id -> {label,color,size}
  screen: [], // 마지막 렌더의 화면 좌표 [{sx,sy,pt}] (호버 판정용)
  results: [], // 마지막 쿼리 결과 [{id,title,cluster,x,y,chroma_distance,document}]
  resultIds: new Set(),
  queryPoint: null, // {x,y} (0~1 정규화 좌표)
  filterCluster: null, // 범례로 고른 군집 필터(null = 전체)
  focusId: null, // 리스트/지도에서 선택해 강조 중인 노드 id
};

const vizCanvas = document.querySelector("#vizCanvas");
const vizTooltip = document.querySelector("#vizTooltip");
const vizLoading = document.querySelector("#vizLoading");
const vizLegend = document.querySelector("#vizLegend");
const vizResultsEl = document.querySelector("#vizResults");
const vizPromptEl = document.querySelector("#vizPrompt");
const vizRunBtn = document.querySelector("#vizRun");
const vizListBody = document.querySelector("#vizListBody");
const vizListSearch = document.querySelector("#vizListSearch");
const vizListCount = document.querySelector("#vizListCount");

const VIZ_TOP_K = 20; // 정제 없이 바로 검색해 지도에 표시할 후보 수
const PAD = 28; // 캔버스 안쪽 여백(px)

// ----- 탭 전환 -----
const tabs = document.querySelectorAll(".tab");
const panels = document.querySelectorAll(".tab-panel");
tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    const name = tab.dataset.tab;
    tabs.forEach((t) => t.classList.toggle("active", t === tab));
    panels.forEach((p) => (p.hidden = p.dataset.panel !== name));
    if (name === "vizmap") onVizActivated();
  });
});

// 시각화 탭이 처음 보일 때 지도를 로드한다(파이프라인만 쓰는 사용자는 불필요한 요청을 안 한다).
async function onVizActivated() {
  if (!vizState.loaded && !vizState.loading) await loadMap();
  else requestAnimationFrame(drawMap); // 숨김 상태에선 캔버스 크기가 0이라, 보일 때 다시 그린다
}

async function loadMap() {
  vizState.loading = true;
  vizLoading.hidden = false;
  try {
    const res = await fetch("/viz/map");
    if (!res.ok) throw new Error((await safeDetail(res)) || res.statusText);
    const map = await res.json();
    vizState.map = map;
    vizState.points = map.points || [];
    (map.clusters || []).forEach((c) => (vizState.clusterById[c.id] = c));
    vizState.loaded = true;
    renderLegend(map.clusters || []);
    renderList();
    vizLoading.hidden = true;
    requestAnimationFrame(drawMap);
  } catch (err) {
    vizLoading.innerHTML = `<span class="error">지도를 불러오지 못했습니다: ${esc(err.message)}</span>`;
  } finally {
    vizState.loading = false;
  }
}

function renderLegend(clusters) {
  vizLegend.innerHTML = clusters
    .map(
      (c) => `
      <span class="legend-item${vizState.filterCluster === c.id ? " active" : ""}" data-cluster="${c.id}" title="클릭하면 이 군집만 보기">
        <span class="legend-swatch" style="background:${c.color}"></span>
        ${esc(c.label)} <span class="legend-size">(${c.size})</span>
      </span>`
    )
    .join("");
}

// 범례 클릭 = 군집 필터 토글. 지도(다른 군집은 흐리게)와 리스트에 동시에 적용된다.
vizLegend.addEventListener("click", (e) => {
  const item = e.target.closest(".legend-item[data-cluster]");
  if (!item) return;
  const id = Number(item.dataset.cluster);
  vizState.filterCluster = vizState.filterCluster === id ? null : id;
  renderLegend(vizState.map.clusters || []);
  renderList();
  drawMap();
});

// ----- 전체 템플릿 리스트 (군집별 그룹, 검색/필터 연동) -----
function renderList() {
  if (!vizState.loaded) return;
  const term = (vizListSearch.value || "").trim().toLowerCase();
  const clusters = vizState.map.clusters || [];
  let shown = 0;
  let html = "";
  clusters.forEach((c) => {
    if (vizState.filterCluster !== null && vizState.filterCluster !== c.id) return;
    const items = vizState.points.filter(
      (p) => p.cluster === c.id && (!term || matchPoint(p, term))
    );
    if (!items.length) return;
    shown += items.length;
    html += `<div class="viz-group-head"><span class="legend-swatch" style="background:${c.color}"></span>${esc(
      c.label
    )} <span class="legend-size">(${items.length})</span></div>`;
    html += items
      .map(
        (p) => `
        <div class="viz-item" data-id="${esc(p.id)}">
          <span class="legend-swatch" style="background:${c.color}"></span>
          <span class="viz-item-title">${esc(p.title)}</span>
          <span class="viz-item-tags">${esc((p.tags || []).slice(0, 3).join(", "))}</span>
        </div>`
      )
      .join("");
  });
  vizListBody.innerHTML = html || `<div class="viz-list-empty">검색 결과가 없습니다.</div>`;
  vizListCount.textContent =
    shown === vizState.points.length ? `(${vizState.points.length})` : `(${shown} / ${vizState.points.length})`;
}

function matchPoint(p, term) {
  if ((p.title || "").toLowerCase().includes(term)) return true;
  return (p.tags || []).some((t) => t.toLowerCase().includes(term));
}

// 입력 즉시 필터(라이브). 검색어와 군집 필터는 함께 적용된다.
vizListSearch.addEventListener("input", renderList);

// 리스트 행 클릭 -> 원본 템플릿 모달 + 지도에서 해당 노드 강조.
vizListBody.addEventListener("click", (e) => {
  const row = e.target.closest(".viz-item[data-id]");
  if (!row) return;
  const id = row.dataset.id;
  focusNode(id);
  openTemplateById(id, vizState.points.find((p) => p.id === id)?.title || id);
});

// 지도에 특정 노드를 강조(링)하고 다시 그린다.
function focusNode(id) {
  vizState.focusId = id;
  drawMap();
}

// 리스트에서 해당 행으로 스크롤 + 잠깐 깜빡. (현재 필터/검색으로 보이는 경우에만)
function flashListRow(id) {
  const row = vizListBody.querySelector(`.viz-item[data-id="${cssEscape(id)}"]`);
  if (!row) return;
  row.scrollIntoView({ behavior: "smooth", block: "center" });
  row.classList.remove("flash");
  void row.offsetWidth; // 애니메이션 재시작
  row.classList.add("flash");
}

function cssEscape(s) {
  return window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, "\\$&");
}

// id 로 원본 템플릿 모달 열기. 쿼리 결과에 본문이 있으면 그걸 쓰고, 없으면 서버에서 가져온다.
async function openTemplateById(id, fallbackTitle) {
  const cached = vizState.results.find((x) => x.id === id);
  if (cached) {
    openTemplateModal(cached.title, cached.document);
    return;
  }
  openTemplateModal(fallbackTitle, "불러오는 중…");
  try {
    const res = await fetch("/viz/template/" + encodeURIComponent(id));
    if (!res.ok) throw new Error((await safeDetail(res)) || res.statusText);
    const t = await res.json();
    document.querySelector(".modal-overlay")?.remove();
    openTemplateModal(t.title, t.document);
  } catch (err) {
    document.querySelector(".modal-overlay")?.remove();
    openTemplateModal(fallbackTitle, "원본을 불러오지 못했습니다: " + err.message);
  }
}

// ----- 좌표 변환: 정규화 좌표(0~1) -> 화면 px. y는 위가 커지도록 뒤집는다. -----
function toScreen(x, y, w, h) {
  return {
    sx: PAD + x * (w - 2 * PAD),
    sy: PAD + (1 - y) * (h - 2 * PAD),
  };
}

// ----- 캔버스 렌더 -----
function drawMap() {
  if (!vizState.loaded) return;
  const dpr = window.devicePixelRatio || 1;
  const w = vizCanvas.clientWidth;
  const h = vizCanvas.clientHeight;
  if (w === 0 || h === 0) return; // 숨겨져 있으면 그리지 않는다
  vizCanvas.width = w * dpr;
  vizCanvas.height = h * dpr;
  const ctx = vizCanvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const querying = !!vizState.queryPoint;
  const filtering = vizState.filterCluster !== null;
  const hasEmphasis = querying || filtering;
  const emphasized = (pt) => {
    if (querying) return vizState.resultIds.has(pt.id);
    if (filtering) return pt.cluster === vizState.filterCluster;
    return true;
  };
  vizState.screen = [];

  // 쿼리가 있으면: 쿼리 점 -> 매칭된 이웃으로 가는 옅은 연결선을 먼저(점 아래) 그린다.
  if (querying) {
    const q = toScreen(vizState.queryPoint.x, vizState.queryPoint.y, w, h);
    ctx.strokeStyle = "rgba(0,113,227,0.28)";
    ctx.lineWidth = 1;
    vizState.results.forEach((r) => {
      const p = toScreen(r.x, r.y, w, h);
      ctx.beginPath();
      ctx.moveTo(q.sx, q.sy);
      ctx.lineTo(p.sx, p.sy);
      ctx.stroke();
    });
  }

  // 모든 점. 강조(쿼리 결과 / 군집 필터 / 포커스)가 아닌 점은 흐리게.
  let focusScreen = null;
  vizState.points.forEach((pt) => {
    const { sx, sy } = toScreen(pt.x, pt.y, w, h);
    vizState.screen.push({ sx, sy, pt });
    const isResult = querying && vizState.resultIds.has(pt.id);
    const emp = emphasized(pt) || pt.id === vizState.focusId;
    if (pt.id === vizState.focusId) focusScreen = { sx, sy };
    const color = (vizState.clusterById[pt.cluster] || {}).color || "#86868b";
    ctx.beginPath();
    ctx.arc(sx, sy, isResult ? 5.5 : 3.5, 0, Math.PI * 2);
    ctx.globalAlpha = hasEmphasis && !emp ? 0.12 : 0.85;
    ctx.fillStyle = color;
    ctx.fill();
    if (isResult) {
      ctx.globalAlpha = 1;
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#fff";
      ctx.stroke();
    }
  });
  ctx.globalAlpha = 1;

  // 포커스된 노드(리스트/지도에서 선택)에 강조 링.
  if (focusScreen) {
    ctx.beginPath();
    ctx.arc(focusScreen.sx, focusScreen.sy, 9, 0, Math.PI * 2);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "#0071e3";
    ctx.stroke();
  }

  // 쿼리 점: 눈에 띄는 다이아몬드 + 라벨.
  if (querying) {
    const q = toScreen(vizState.queryPoint.x, vizState.queryPoint.y, w, h);
    drawDiamond(ctx, q.sx, q.sy, 9);
    ctx.fillStyle = "#0071e3";
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "#fff";
    ctx.stroke();
    // 라벨
    ctx.font = "600 12px -apple-system, system-ui, sans-serif";
    const label = "내 프롬프트";
    const tw = ctx.measureText(label).width;
    const lx = Math.min(Math.max(q.sx, PAD + tw / 2 + 6), w - PAD - tw / 2 - 6);
    const ly = q.sy - 16;
    ctx.fillStyle = "rgba(0,113,227,0.95)";
    roundRect(ctx, lx - tw / 2 - 6, ly - 13, tw + 12, 19, 6);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, lx, ly - 3);
    ctx.textAlign = "start";
    ctx.textBaseline = "alphabetic";
  }
}

function drawDiamond(ctx, cx, cy, r) {
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx + r, cy);
  ctx.lineTo(cx, cy + r);
  ctx.lineTo(cx - r, cy);
  ctx.closePath();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ----- 호버 툴팁 -----
vizCanvas.addEventListener("mousemove", (e) => {
  const rect = vizCanvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const hit = nearestPoint(mx, my, 7);
  if (!hit) {
    vizTooltip.hidden = true;
    vizCanvas.style.cursor = "crosshair";
    return;
  }
  const cl = vizState.clusterById[hit.pt.cluster] || {};
  const tags = (hit.pt.tags || []).slice(0, 3).join(", ");
  vizTooltip.innerHTML = `
    <div class="tt-title">${esc(hit.pt.title)}</div>
    <div class="tt-meta">${esc(cl.label || "")}${tags ? " · " + esc(tags) : ""}</div>`;
  vizTooltip.style.left = hit.sx + "px";
  vizTooltip.style.top = hit.sy + "px";
  vizTooltip.hidden = false;
  vizCanvas.style.cursor = "pointer"; // 모든 노드는 클릭하면 원본 템플릿을 본다
});
vizCanvas.addEventListener("mouseleave", () => (vizTooltip.hidden = true));

// 노드 클릭 -> 원본 템플릿 모달 + 강조 + 리스트의 같은 행으로 스크롤(양방향 연동).
vizCanvas.addEventListener("click", (e) => {
  const rect = vizCanvas.getBoundingClientRect();
  const hit = nearestPoint(e.clientX - rect.left, e.clientY - rect.top, 7);
  if (!hit) return;
  focusNode(hit.pt.id);
  flashListRow(hit.pt.id);
  openTemplateById(hit.pt.id, hit.pt.title);
});

function nearestPoint(mx, my, maxDist) {
  let best = null;
  let bestD = maxDist * maxDist;
  for (const s of vizState.screen) {
    const d = (s.sx - mx) ** 2 + (s.sy - my) ** 2;
    if (d <= bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

// ----- 쿼리 실행 -----
vizRunBtn.addEventListener("click", runViz);
vizPromptEl.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") runViz();
});

async function runViz() {
  const query = vizPromptEl.value.trim();
  if (!query) {
    vizPromptEl.focus();
    return;
  }
  if (!vizState.loaded) await loadMap();

  vizRunBtn.disabled = true;
  vizResultsEl.hidden = false;
  vizResultsEl.innerHTML = `<div class="spinner"></div>`;
  try {
    const res = await fetch("/viz/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, top_k: VIZ_TOP_K }),
    });
    if (!res.ok) throw new Error((await safeDetail(res)) || res.statusText);
    const data = await res.json();
    vizState.results = data.results || [];
    vizState.resultIds = new Set(vizState.results.map((r) => r.id));
    vizState.queryPoint = data.point;
    drawMap();
    renderResults();
  } catch (err) {
    vizResultsEl.innerHTML = `<div class="error">실패: ${esc(err.message)}</div>`;
  } finally {
    vizRunBtn.disabled = false;
  }
}

function renderResults() {
  const rows = vizState.results
    .map((r, i) => {
      const color = (vizState.clusterById[r.cluster] || {}).color || "#86868b";
      return `
      <div class="cand" data-idx="${i}">
        <span class="cand-rank">${r.chroma_rank}</span>
        <span class="cand-dot" style="background:${color}"></span>
        <span class="cand-title">${esc(r.title)}</span>
        <span class="chip">dist ${fmt(r.chroma_distance)}</span>
        <span class="cand-view">원본 ›</span>
      </div>`;
    })
    .join("");
  vizResultsEl.innerHTML = `
    <div class="muted-note">정제 없이 입력을 바로 임베딩해 가까운 템플릿 ${vizState.results.length}개를 찾았습니다
    (코사인 거리 = 1 − 유사도, 작을수록 유사). 지도에서 강조된 점이며, 행을 클릭하면 원본 템플릿을 봅니다.</div>
    <div style="margin-top:12px">${rows}</div>`;
}

// 결과 행 클릭 -> 원본 템플릿 모달.
vizResultsEl.addEventListener("click", (e) => {
  const row = e.target.closest(".cand[data-idx]");
  if (!row) return;
  const r = vizState.results[Number(row.dataset.idx)];
  if (r) openTemplateModal(r.title, r.document);
});

// 창 크기가 바뀌면 다시 그린다(시각화 탭이 보일 때만 의미 있음).
let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(drawMap, 150);
});

async function safeDetail(res) {
  try {
    const j = await res.json();
    return typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
  } catch (_) {
    return null;
  }
}
