// main.js (webview 쪽) - 확장(extension.js)이 postMessage로 보내주는 교체 내역을
// 카드 목록으로 그린다. Node가 아니라 webview(브라우저 유사) 환경에서 동작한다.
//
// P4(UX 조화): 단어 단위 diff 강조 토글, 긴 본문 펼치기/접기, 아이콘 복사 버튼(+피드백),
//   채널별 좌측 악센트, 건수 표시. 색/폰트는 전부 테마 변수(main.css) - 하드코딩 없음.
(function () {
  const vscode = acquireVsCodeApi();
  const listEl = document.getElementById("list");
  const emptyEl = document.getElementById("empty");
  const searchEl = document.getElementById("search");
  const countEl = document.getElementById("count");
  const diffToggleEl = document.getElementById("diffToggle");

  let entries = [];
  let filter = "";
  let diffOn = false;

  const CLAMP_PX = 132; // main.css의 .text.clamp max-height와 맞춤
  const NS = "http://www.w3.org/2000/svg";

  window.addEventListener("message", function (e) {
    const msg = e.data;
    if (!msg) return;
    if (msg.type === "entries") {
      entries = Array.isArray(msg.entries) ? msg.entries : [];
      render();
    }
  });

  searchEl.addEventListener("input", function () {
    filter = searchEl.value.trim().toLowerCase();
    render();
  });

  if (diffToggleEl) {
    diffToggleEl.addEventListener("click", function () {
      diffOn = !diffOn;
      diffToggleEl.classList.toggle("active", diffOn);
      diffToggleEl.setAttribute("aria-pressed", diffOn ? "true" : "false");
      render();
    });
  }

  function matches(en) {
    if (!filter) return true;
    return (
      (en.before && en.before.toLowerCase().indexOf(filter) >= 0) ||
      (en.after && en.after.toLowerCase().indexOf(filter) >= 0) ||
      (en.model && en.model.toLowerCase().indexOf(filter) >= 0) ||
      (en.channel && en.channel.toLowerCase().indexOf(filter) >= 0)
    );
  }

  // 'YYYY-MM-DDTHH:MM:SS' -> 'MM-DD HH:MM:SS' (좁은 사이드바에 맞게 축약)
  function fmtTime(ts) {
    if (!ts || typeof ts !== "string") return "";
    const m = ts.match(/^\d{4}-(\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/);
    return m ? m[1] + " " + m[2] : ts;
  }

  // 채널 경로를 사람이 읽기 쉬운 짧은 라벨/클래스로.
  function channelLabel(ch) {
    if (!ch) return "";
    if (ch.indexOf("/v1/messages") >= 0) return "Claude";
    if (ch.indexOf("/responses") >= 0) return "GPT";
    if (ch.indexOf("/chat/completions") >= 0) return "BG";
    return ch;
  }
  function channelClass(ch) {
    if (!ch) return "";
    if (ch.indexOf("/v1/messages") >= 0) return "ch-claude";
    if (ch.indexOf("/responses") >= 0) return "ch-gpt";
    if (ch.indexOf("/chat/completions") >= 0) return "ch-bg";
    return "";
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // 가벼운 인라인 SVG 아이콘(codicon 폰트 동봉 없이 의존성 0 유지). currentColor로 테마색 상속.
  function makeSvg(shapes) {
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("class", "icon");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.3");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    for (let i = 0; i < shapes.length; i++) {
      const n = document.createElementNS(NS, shapes[i][0]);
      const attrs = shapes[i][1];
      for (const k in attrs) n.setAttribute(k, attrs[k]);
      svg.appendChild(n);
    }
    return svg;
  }
  const ICON = {
    copy: function () {
      return makeSvg([
        ["rect", { x: 6, y: 6, width: 8, height: 8, rx: 1.5 }],
        ["path", { d: "M3.5 10V4A1.5 1.5 0 0 1 5 2.5h6" }],
      ]);
    },
    check: function () {
      return makeSvg([["path", { d: "M3 8.5l3.2 3.2L13 4.5" }]]);
    },
    down: function () {
      return makeSvg([["path", { d: "M4 6l4 4 4-4" }]]);
    },
  };

  // ---- 단어 단위 diff (LCS) ----
  function tokenize(s) {
    return (s || "").split(/(\s+)/).filter(function (x) {
      return x.length;
    });
  }
  // before/after를 토큰으로 나눠 공통(same)/삭제(del)/추가(add)로 태깅.
  function diffTokens(aStr, bStr) {
    const a = tokenize(aStr);
    const b = tokenize(bStr);
    const n = a.length;
    const m = b.length;
    // 너무 크면(병적 입력) LCS 생략하고 통째 교체로 표시 - jank 방지.
    if (n > 2000 || m > 2000 || n * m > 1500000) {
      return {
        aTags: a.map(function (t) { return [t, "del"]; }),
        bTags: b.map(function (t) { return [t, "add"]; }),
      };
    }
    const dp = [];
    for (let i = 0; i <= n; i++) dp.push(new Int32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    const aTags = [];
    const bTags = [];
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) {
        aTags.push([a[i], "same"]);
        bTags.push([b[j], "same"]);
        i++;
        j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        aTags.push([a[i], "del"]);
        i++;
      } else {
        bTags.push([b[j], "add"]);
        j++;
      }
    }
    while (i < n) { aTags.push([a[i], "del"]); i++; }
    while (j < m) { bTags.push([b[j], "add"]); j++; }
    return { aTags: aTags, bTags: bTags };
  }

  function fillTokens(textEl, tags) {
    const frag = document.createDocumentFragment();
    for (let i = 0; i < tags.length; i++) {
      const tok = tags[i][0];
      const kind = tags[i][1];
      // 공백/같은 토큰은 강조하지 않는다.
      if (kind === "same" || /^\s+$/.test(tok)) {
        frag.appendChild(document.createTextNode(tok));
      } else {
        const s = el("span", "tok " + kind);
        s.textContent = tok;
        frag.appendChild(s);
      }
    }
    textEl.appendChild(frag);
  }

  // ---- 카드/블록 ----
  function makeBlock(label, text, kind, tags) {
    const block = el("div", "block " + kind + (tags ? " diff" : ""));

    const head = el("div", "block-head");
    head.appendChild(el("span", "label", label));
    const copy = el("button", "icon-btn");
    copy.title = "복사";
    copy.appendChild(ICON.copy());
    copy.addEventListener("click", function () {
      vscode.postMessage({ type: "copy", text: text || "" });
      copy.replaceChildren(ICON.check());
      copy.classList.add("ok");
      clearTimeout(copy._t);
      copy._t = setTimeout(function () {
        copy.replaceChildren(ICON.copy());
        copy.classList.remove("ok");
      }, 1200);
    });
    head.appendChild(copy);
    block.appendChild(head);

    const t = el("div", "text");
    if (tags) fillTokens(t, tags);
    else t.textContent = text || "";
    block.appendChild(t);

    const more = el("button", "more", "더 보기");
    more.hidden = true;
    more.addEventListener("click", function () {
      const expanded = t.classList.toggle("expanded");
      more.textContent = expanded ? "접기" : "더 보기";
    });
    block.appendChild(more);
    return block;
  }

  function arrowEl() {
    const a = el("div", "arrow");
    a.appendChild(ICON.down());
    return a;
  }

  function makeCard(en) {
    const card = el("div", "card " + channelClass(en.channel));

    const head = el("div", "card-head");
    const left = el("div", "meta");
    left.appendChild(el("span", "badge", channelLabel(en.channel)));
    if (en.model) left.appendChild(el("span", "model", en.model));
    head.appendChild(left);
    head.appendChild(el("span", "time", fmtTime(en.ts)));
    card.appendChild(head);

    let aTags = null;
    let bTags = null;
    if (diffOn && en.before && en.after) {
      const d = diffTokens(en.before, en.after);
      aTags = d.aTags;
      bTags = d.bTags;
    }
    card.appendChild(makeBlock("원본", en.before, "before", aTags));
    card.appendChild(arrowEl());
    card.appendChild(makeBlock("정제본", en.after, "after", bTags));
    return card;
  }

  // 본문이 실제로 넘칠 때만 클램프 + '더 보기'를 보인다(렌더 후 측정).
  function applyClamp() {
    const blocks = listEl.querySelectorAll(".block");
    for (let i = 0; i < blocks.length; i++) {
      const t = blocks[i].querySelector(".text");
      const more = blocks[i].querySelector(".more");
      if (!t || !more) continue;
      t.classList.add("clamp");
      t.classList.remove("expanded");
      more.textContent = "더 보기";
      if (t.scrollHeight > CLAMP_PX + 4) {
        more.hidden = false;
      } else {
        t.classList.remove("clamp");
        more.hidden = true;
      }
    }
  }

  function render() {
    const shown = entries.filter(matches);
    const total = entries.length;
    if (countEl) {
      countEl.textContent =
        filter && shown.length !== total ? shown.length + " / " + total + "건" : total + "건";
    }

    listEl.textContent = "";
    if (shown.length === 0) {
      emptyEl.textContent =
        total === 0
          ? "아직 교체 내역이 없습니다. 상태바의 'Refiner: 켜짐'을 확인하고 Copilot 채팅을 보내보세요."
          : "검색 결과가 없습니다.";
      emptyEl.style.display = "block";
      return;
    }
    emptyEl.style.display = "none";

    // 최신 항목이 위로 오도록 역순으로 그린다.
    const frag = document.createDocumentFragment();
    for (let i = shown.length - 1; i >= 0; i--) {
      frag.appendChild(makeCard(shown[i]));
    }
    listEl.appendChild(frag);
    requestAnimationFrame(applyClamp);
  }

  // 준비 완료를 알리면 확장이 현재 내역을 보내준다.
  vscode.postMessage({ type: "ready" });
})();
