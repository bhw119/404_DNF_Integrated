(() => {
  const HIGHLIGHT_CLASS = "dpd-highlight-mark";
  const STYLE_ID = "dpd-highlight-style";

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .${HIGHLIGHT_CLASS} {
        background: rgba(250, 204, 21, 0.6);
        outline: 2px solid rgba(245, 158, 11, .9);
        border-radius: 3px;
        padding: 0 .15em;
        box-shadow: 0 0 0 2px rgba(255,255,255,.6);
        transition: background .2s ease, outline-color .2s ease;
      }
      .${HIGHLIGHT_CLASS}.blink {
        animation: dpd-blink 0.9s ease 0s 2;
      }
      @keyframes dpd-blink {
        0%, 100% { outline-color: rgba(245, 158, 11, .9); }
        50%      { outline-color: rgba(245, 158, 11, .0); }
      }
    `;
    document.documentElement.appendChild(style);
  }

  function clearHighlights(root = document) {
    const nodes = root.querySelectorAll?.(`.${HIGHLIGHT_CLASS}`);
    if (!nodes?.length) return;
    nodes.forEach((el) => {
      const parent = el.parentNode;
      if (!parent) return;
      while (el.firstChild) parent.insertBefore(el.firstChild, el);
      parent.removeChild(el);
      parent.normalize?.();
    });
  }

  function getTextNodes(root) {
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const parent = node.parentNode;
          if (!parent) return NodeFilter.FILTER_REJECT;
          const tag = parent.nodeName;
          if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT") {
            return NodeFilter.FILTER_REJECT;
          }
          const value = node.nodeValue || "";
          return value.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        }
      }
    );
    const result = [];
    let current;
    while ((current = walker.nextNode())) result.push(current);
    return result;
  }

  function highlightInTextNode(textNode, queryLower, severity) {
    let node = textNode;
    let firstMark = null;

    while (node && node.nodeType === Node.TEXT_NODE) {
      const value = node.nodeValue || "";
      const lower = value.toLowerCase();
      const idx = lower.indexOf(queryLower);
      if (idx === -1) break;

      const range = document.createRange();
      range.setStart(node, idx);
      range.setEnd(node, idx + queryLower.length);

      const mark = document.createElement("mark");
      mark.className = HIGHLIGHT_CLASS;
      if (severity) {
        mark.dataset.severity = severity;
      }

      range.surroundContents(mark);
      if (!firstMark) firstMark = mark;

      const nextNode = mark.nextSibling;
      if (!nextNode || nextNode.nodeType !== Node.TEXT_NODE) break;
      node = nextNode;
    }

    return firstMark;
  }

  function highlightText(query, { severity = "", scroll = false, clear = true } = {}) {
    if (!query || typeof query !== "string") return false;
    const clean = query.trim();
    if (!clean) return false;

    ensureStyle();
    if (clear) clearHighlights(document);

    const queryLower = clean.toLowerCase();
    const nodes = getTextNodes(document);
    let firstMark = null;

    for (const node of nodes) {
      const mark = highlightInTextNode(node, queryLower, severity);
      if (mark && !firstMark) firstMark = mark;
    }

    if (scroll && firstMark) {
      try {
        firstMark.scrollIntoView({ block: "center", behavior: "smooth" });
        firstMark.classList.add("blink");
        setTimeout(() => firstMark?.classList?.remove("blink"), 1200);
      } catch (_) {}
      return true;
    }

    return Boolean(firstMark);
  }

  function highlightBulk(items) {
    try {
      ensureStyle();
      clearHighlights(document);
      let count = 0;
      for (const it of items) {
        const text = String(it?.text || "").trim();
        if (!text) continue;
        const severity = String(it?.severity || "");
        if (highlightText(text, { severity, scroll: false, clear: false })) {
          count++;
        }
      }
      return count;
    } catch (err) {
      return 0;
    }
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === "bulk-highlight") {
      const items = Array.isArray(msg.items) ? msg.items : [];
      const count = highlightBulk(items);
      sendResponse?.({ ok: true, count });
      return;
    }
    if (msg?.type === "highlight-in-page") {
      const payload = msg.payload || {};
      const text = String(payload.text || "");
      const severity = String(payload.severity || "");
      const ok = highlightText(text, { severity, scroll: true, clear: true });
      sendResponse?.({ ok });
      return;
    }
  });
})();