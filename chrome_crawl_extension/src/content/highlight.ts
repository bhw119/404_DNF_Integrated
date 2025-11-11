// Migrated from legacy content_highlight.js (IIFE removed)
const STYLE_ID = "dpd-highlight-style";
const BASE_CLASS = "dpd-highlight-mark";
const CLASS_BY_SEVERITY: Record<string, string> = {
  high: `${BASE_CLASS} ${BASE_CLASS}--high`,
  mid: `${BASE_CLASS} ${BASE_CLASS}--mid`,
  low: `${BASE_CLASS} ${BASE_CLASS}--low`,
  default: BASE_CLASS,
};
const ELEMENT_BASE_CLASS = "dpd-highlight-target";
const ELEMENT_CLASS_BY_SEVERITY: Record<string, string> = {
  high: `${ELEMENT_BASE_CLASS} ${ELEMENT_BASE_CLASS}--high`,
  mid: `${ELEMENT_BASE_CLASS} ${ELEMENT_BASE_CLASS}--mid`,
  low: `${ELEMENT_BASE_CLASS} ${ELEMENT_BASE_CLASS}--low`,
  default: ELEMENT_BASE_CLASS,
};
const ELEMENT_CLASS_VARIANTS = [
  ELEMENT_BASE_CLASS,
  `${ELEMENT_BASE_CLASS}--high`,
  `${ELEMENT_BASE_CLASS}--mid`,
  `${ELEMENT_BASE_CLASS}--low`,
  "blink",
];

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .${BASE_CLASS} { background: rgba(250, 204, 21, 0.45); outline: 2px solid rgba(245, 158, 11, .85); border-radius: 3px; padding: 0 .18em; box-shadow: 0 0 0 1px rgba(255,255,255,.6); transition: background .18s ease, outline-color .18s ease; }
    .${BASE_CLASS}--high { background: rgba(239, 68, 68, 0.28); outline-color: rgba(220, 38, 38, 0.95); }
    .${BASE_CLASS}--mid { background: rgba(245, 158, 11, 0.32); outline-color: rgba(217, 119, 6, 0.95); }
    .${BASE_CLASS}--low { background: rgba(34, 197, 94, 0.28); outline-color: rgba(22, 163, 74, 0.9); }
    .${BASE_CLASS}.blink { animation: dpd-blink 0.9s ease 0s 2; }
    @keyframes dpd-blink { 0%, 100% { outline-offset: 0; } 50% { outline-offset: 3px; } }
    .${ELEMENT_BASE_CLASS} { box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.65), 0 0 0 6px rgba(255, 255, 255, 0.55); border-radius: 6px; transition: box-shadow .2s ease; }
    .${ELEMENT_BASE_CLASS}--high { box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.75), 0 0 0 7px rgba(255, 255, 255, 0.6); }
    .${ELEMENT_BASE_CLASS}--mid { box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.75), 0 0 0 7px rgba(255, 255, 255, 0.6); }
    .${ELEMENT_BASE_CLASS}--low { box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.75), 0 0 0 7px rgba(255, 255, 255, 0.6); }
    .${ELEMENT_BASE_CLASS}.blink { animation: dpd-element-blink 1s ease 0s 2; }
    @keyframes dpd-element-blink { 0%, 100% { box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.65), 0 0 0 6px rgba(255, 255, 255, 0.55); } 50% { box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.85), 0 0 0 9px rgba(245, 158, 11, 0.75); } }
  `;
  document.documentElement.appendChild(style);
}

function clearHighlights(root: Document | Element = document) {
  const nodes = (root as Element | Document).querySelectorAll?.(
    `.${BASE_CLASS}`
  );
  nodes?.forEach((el) => {
    const parent = el.parentNode;
    if (!parent) return;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
    (parent as any).normalize?.();
  });
  const elementTargets = (root as Element | Document).querySelectorAll?.(
    `.${ELEMENT_BASE_CLASS}`
  );
  elementTargets?.forEach((el) => {
    ELEMENT_CLASS_VARIANTS.forEach((cls) => el.classList.remove(cls));
  });
}

function getTextNodes(root: Document | Element): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node: { parentNode: Element | null; nodeValue: string }) {
      const parent = node.parentNode as Element | null;
      if (!parent) return NodeFilter.FILTER_REJECT;
      const tag = parent.nodeName;
      if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT") {
        return NodeFilter.FILTER_REJECT;
      }
      const value = node.nodeValue || "";
      return value.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  } as any);
  const nodes: Text[] = [];
  let current: any;
  while ((current = walker.nextNode())) nodes.push(current);
  return nodes;
}

function escapeRegex(str: string) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildLooseRegex(query: string): RegExp | null {
  const cleaned = String(query || "")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  const chars = Array.from(cleaned);
  const pattern = chars
    .map((ch) => escapeRegex(ch))
    .join("[\\s\\u200B\\u200C\\uFEFF\\u00A0\\W]*");
  try {
    return new RegExp(pattern, "i");
  } catch {
    return null;
  }
}

function getDomPath(element: Element, depthLimit = 8): string {
  if (!element || element.nodeType !== Node.ELEMENT_NODE) return "";
  const parts: string[] = [];
  let node: Element | null = element;
  let depth = 0;
  while (node && node.nodeType === Node.ELEMENT_NODE && depth < depthLimit) {
    let part = node.tagName.toLowerCase();
    if (node.id) {
      part += `#${node.id}`;
    } else {
      const className = (node.className || "")
        .toString()
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .join(".");
      if (className) part += `.${className}`;
    }
    if (node.parentElement) {
      const siblings = Array.from(node.parentElement.children).filter(
        (child) => child.tagName === node!.tagName
      );
      if (siblings.length > 1) {
        const index = siblings.indexOf(node);
        part += `:nth-of-type(${index + 1})`;
      }
    }
    parts.push(part);
    node = node.parentElement;
    depth += 1;
  }
  return parts.reverse().join(" > ");
}

function getHtmlSnippet(element: Element, maxLength = 220): string {
  if (!element) return "";
  const outer = element.outerHTML || "";
  if (!outer) return "";
  const singleLine = outer.replace(/\s+/g, " ").trim();
  if (singleLine.length <= maxLength) return singleLine;
  return `${singleLine.slice(0, maxLength)}…`;
}

function normalizeForLooseMatch(str: string) {
  return String(str || "")
    .replace(/[\s\u200B\u200C\uFEFF\u00A0]/g, "")
    .trim();
}

function normalizeChar(ch: string) {
  return ch.toLowerCase();
}

function tokenizeText(str: string): string[] {
  return (
    String(str || "")
      .toLowerCase()
      .match(/[a-z0-9가-힣]+/g) || []
  );
}

function computeOverlapScore(blockText: string, queryTokens: string[]): number {
  if (!queryTokens.length) return 0;
  const blockTokens = tokenizeText(blockText);
  if (!blockTokens.length) return 0;
  const blockSet = new Set(blockTokens);
  let matched = 0;
  for (const token of queryTokens) if (blockSet.has(token)) matched += 1;
  const coverage = matched / queryTokens.length;
  const density = matched / blockTokens.length;
  const sizeSimilarity =
    1 / (1 + Math.abs(blockTokens.length - queryTokens.length));
  return coverage * 0.7 + density * 0.2 + sizeSimilarity * 0.1;
}

function findMeaningfulAncestor(node: Text) {
  let current = node?.parentElement as Element | null;
  let depth = 0;
  let best: Element | null = null;
  while (current && depth < 6) {
    const text = (current.innerText || "").trim();
    const len = text.length;
    if (len >= 10 && len <= 1200) {
      best = current;
      break;
    }
    if (!best && len > 0) best = current;
    depth += 1;
    current = current.parentElement;
  }
  return best || (node?.parentElement as Element | null) || null;
}

function findBestNodeMatch(nodes: Text[], query: string) {
  const baseRegex = buildLooseRegex(query);
  if (!baseRegex) return null;
  const queryTokens = tokenizeText(query);
  let best: any = null;
  for (const node of nodes) {
    const value = node?.nodeValue;
    if (!value || !value.trim()) continue;
    const regex = new RegExp(baseRegex.source, baseRegex.flags);
    const match = regex.exec(value);
    if (!match) continue;
    const start = match.index;
    const end = match.index + match[0].length;
    const ancestor = findMeaningfulAncestor(node);
    const ancestorText = (ancestor as Element | null)?.innerText || value;
    const score = computeOverlapScore(ancestorText, queryTokens);
    const tieBreaker = Math.abs((ancestorText || "").length - query.length);
    if (
      !best ||
      score > best.score ||
      (score === best.score && tieBreaker < best.tieBreaker)
    ) {
      best = { node, start, end, score, tieBreaker, ancestor };
    }
  }
  return best;
}

function wrapRangeWithMark(
  range: Range,
  className: string,
  query: string,
  severity?: string
) {
  if (!range) return null;
  const mark = document.createElement("mark");
  mark.className = className;
  (mark as any).dataset.dpdText = query;
  if (severity) (mark as any).dataset.dpdSeverity = severity;
  const fragment = range.extractContents();
  mark.appendChild(fragment);
  range.insertNode(mark);
  return mark;
}

function wrapRange(
  textNode: Text,
  start: number,
  end: number,
  className: string,
  query: string,
  severity?: string
) {
  const text = textNode.nodeValue || "";
  const parent = textNode.parentNode;
  if (!parent) return { mark: null, tail: null };
  const before = text.slice(0, start);
  const target = text.slice(start, end);
  const after = text.slice(end);
  const fragment = document.createDocumentFragment();
  if (before) fragment.appendChild(document.createTextNode(before));
  const mark = document.createElement("mark");
  mark.className = className;
  (mark as any).dataset.dpdText = query;
  if (severity) (mark as any).dataset.dpdSeverity = severity;
  mark.textContent = target;
  fragment.appendChild(mark);
  let tail: Text | null = null;
  if (after) {
    tail = document.createTextNode(after);
    fragment.appendChild(tail);
  }
  parent.replaceChild(fragment, textNode);
  return { mark, tail };
}

function highlightAcrossNodes(nodes: Text[], query: string, severity?: string) {
  if (!nodes?.length) return [];
  const className =
    CLASS_BY_SEVERITY[severity || ""] || CLASS_BY_SEVERITY.default;
  const normalizedQuery = normalizeForLooseMatch(query);
  if (!normalizedQuery) return [];
  const indexMap: Array<{ node: Text; offset: number } | null> = [];
  const normalizedChars: string[] = [];
  for (const node of nodes) {
    if (!node?.nodeValue) continue;
    const value = node.nodeValue;
    for (let i = 0; i < value.length; i++) {
      const ch = value[i];
      if (/[\s\u200B\u200C\uFEFF\u00A0]/.test(ch)) continue;
      if (!/\S/.test(ch) && /\S/.test(normalizedQuery[0] || "")) continue;
      normalizedChars.push(normalizeChar(ch));
      indexMap.push({ node, offset: i });
    }
    normalizedChars.push(" ");
    indexMap.push(null);
  }
  const aggregate = normalizedChars.join("");
  const target = normalizeForLooseMatch(query).toLowerCase();
  if (!aggregate || !target) return [];
  const idx = aggregate.indexOf(target);
  if (idx === -1) return [];
  let startInfo: any = null;
  let endInfo: any = null;
  let consumed = 0;
  for (let i = idx; i < aggregate.length; i++) {
    const mapEntry = indexMap[i];
    if (!mapEntry) continue;
    if (!startInfo) startInfo = mapEntry;
    consumed += 1;
    if (consumed >= target.length) {
      endInfo = mapEntry;
      break;
    }
  }
  if (!startInfo || !endInfo) return [];
  const range = document.createRange();
  range.setStart(startInfo.node, startInfo.offset);
  range.setEnd(endInfo.node, endInfo.offset + 1);
  const mark = wrapRangeWithMark(range, className, query, severity);
  return mark ? [mark] : [];
}

function highlightText(
  query: string,
  options: {
    severity?: string;
    scroll?: boolean;
    clear?: boolean;
    log?: boolean;
  } = {},
  internal: { disableSegments?: boolean } = {}
) {
  if (!query || typeof query !== "string") return false;
  const target = query.trim();
  if (!target) return false;
  const { disableSegments = false } = internal;
  const {
    severity = "",
    scroll = false,
    clear = true,
    log = true,
  } = options || {};
  ensureStyle();
  if (clear) clearHighlights(document);
  const nodes = getTextNodes(document);
  let first: Element | null = null;
  const className = CLASS_BY_SEVERITY[severity] || CLASS_BY_SEVERITY.default;
  const bestMatch = findBestNodeMatch(nodes, target);
  if (bestMatch) {
    const { mark } = wrapRange(
      bestMatch.node,
      bestMatch.start,
      bestMatch.end,
      className,
      target,
      severity
    );
    if (mark) {
      first = mark;
      if (log) {
        const rect = mark.getBoundingClientRect();
        console.log("[DPD][Highlight] 위치보기 매치", {
          index: 0,
          text: target,
          severity,
          rect: {
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
            bottom: rect.bottom,
            right: rect.right,
          },
          domPath: getDomPath(
            (bestMatch.ancestor as Element) || mark.parentElement || mark
          ),
        });
        console.log("[DPD][Highlight] 위치보기 요소 HTML", {
          index: 0,
          snippet: getHtmlSnippet(
            (bestMatch.ancestor as Element) || mark.parentElement || mark
          ),
        });
      }
    }
  }
  if (scroll && first) {
    try {
      first.scrollIntoView({ block: "center", behavior: "smooth" });
      (first as any).classList.add("blink");
      setTimeout(() => (first as any)?.classList?.remove("blink"), 1200);
    } catch {
      /* noop */
    }
    return true;
  }
  const found = Boolean(first);
  if (!found && log) {
    const crossMarks = highlightAcrossNodes(nodes, target, severity);
    if (crossMarks.length > 0) {
      const mark = crossMarks[0] as any;
      if (scroll) {
        try {
          mark.scrollIntoView({ block: "center", behavior: "smooth" });
          mark.classList.add("blink");
          setTimeout(() => mark?.classList?.remove("blink"), 1200);
        } catch {
          /* noop */
        }
      }
      if (log) {
        crossMarks.forEach((m: any, idx: number) => {
          const rect = m.getBoundingClientRect();
          console.log("[DPD][Highlight] 위치보기 매치(분할)", {
            index: idx,
            text: target,
            severity,
            rect: {
              top: rect.top,
              left: rect.left,
              width: rect.width,
              height: rect.height,
              bottom: rect.bottom,
              right: rect.right,
            },
            domPath: getDomPath(m.parentElement || m),
          });
          console.log("[DPD][Highlight] 위치보기 요소 HTML", {
            index: idx,
            snippet: getHtmlSnippet(m.parentElement || m),
          });
        });
      }
      return true;
    }
    if (!disableSegments) {
      const sentenceSegments = splitByPunctuation(target).filter(
        (seg) => seg.length >= 2
      );
      if (sentenceSegments.length > 1) {
        let success = false;
        for (let idx = 0; idx < sentenceSegments.length; idx++) {
          const seg = sentenceSegments[idx];
          const segFound = highlightText(
            seg,
            {
              severity,
              scroll: scroll && !success,
              clear: idx === 0 ? clear : false,
              log,
            },
            { disableSegments: true }
          );
          if (segFound) {
            success = true;
            break;
          }
        }
        if (success) return true;
      }
      const wordSegments = splitIntoWords(target).filter(
        (seg) => seg.length >= 1
      );
      if (wordSegments.length > 1) {
        let success = false;
        for (let idx = 0; idx < wordSegments.length; idx++) {
          const seg = wordSegments[idx];
          const segFound = highlightText(
            seg,
            {
              severity,
              scroll: scroll && !success,
              clear: idx === 0 ? clear : false,
              log,
            },
            { disableSegments: true }
          );
          if (segFound) {
            success = true;
            break;
          }
        }
        if (success) return true;
      }
    }
    console.log("[DPD][Highlight] 위치보기 매치 실패", {
      text: target,
      severity,
    });
  }
  return found;
}

function splitByPunctuation(text: string): string[] {
  const result: string[] = [];
  if (!text) return result;
  let buffer = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    buffer += ch;
    if (/[.!?]/.test(ch)) {
      const segment = buffer.trim();
      if (segment) result.push(segment);
      buffer = "";
    }
  }
  const tail = buffer.trim();
  if (tail) result.push(tail);
  return result;
}
function splitIntoWords(text: string): string[] {
  return String(text || "")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 0);
}

function highlightElement(
  element: Element,
  { severity = "", scroll = true, log = true } = {}
) {
  if (!element) return false;
  ensureStyle();
  clearHighlights(document);
  const className =
    ELEMENT_CLASS_BY_SEVERITY[severity] || ELEMENT_CLASS_BY_SEVERITY.default;
  const classList = className.split(/\s+/).filter(Boolean);
  (element as any).classList.add(...classList);
  (element as any).classList.add("blink");
  if (scroll) {
    try {
      element.scrollIntoView({ block: "center", behavior: "smooth" });
    } catch {
      /* noop */
    }
  }
  setTimeout(() => (element as any).classList.remove("blink"), 1400);
  if (log) {
    const rect = element.getBoundingClientRect();
    console.log("[DPD][Highlight] element highlight", {
      severity,
      selector: getDomPath(element),
      rect: {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
        bottom: rect.bottom,
        right: rect.right,
      },
    });
  }
  return true;
}

function highlightBulk(items: Array<{ text?: string; severity?: string }>) {
  try {
    ensureStyle();
    clearHighlights(document);
    let count = 0;
    for (const it of items) {
      const text = String(it?.text || "").trim();
      if (!text) continue;
      const severity = String(it?.severity || "");
      if (
        highlightText(text, {
          severity,
          scroll: false,
          clear: false,
          log: false,
        })
      )
        count++;
    }
    return count;
  } catch {
    return 0;
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "bulk-highlight") {
    const items = Array.isArray(msg.items) ? msg.items : [];
    console.log("[DPD][Highlight] bulk-highlight 수신", {
      count: items.length,
    });
    const count = highlightBulk(items);
    sendResponse?.({ ok: true, count });
    return;
  }
  if (msg?.type === "highlight-in-page") {
    const payload = msg.payload || {};
    const text = String(payload.text || "");
    const severity = String(payload.severity || "");
    const structuredMeta = payload.structuredMeta || {};
    console.log("[DPD][Highlight] highlight-in-page 수신", {
      textSample: text.slice(0, 120),
      severity,
      length: text.length,
    });
    let ok = false;
    if (structuredMeta?.linkSelector) {
      const element = document.querySelector(
        structuredMeta.linkSelector as string
      );
      if (element)
        ok = highlightElement(element, { severity, scroll: true, log: true });
    }
    if (!ok && structuredMeta?.selector) {
      const element = document.querySelector(structuredMeta.selector as string);
      if (element)
        ok = highlightElement(element, { severity, scroll: true, log: true });
    }
    if (!ok)
      ok = highlightText(text, {
        severity,
        scroll: true,
        clear: true,
        log: true,
      });
    sendResponse?.({ ok });
    return;
  }
});
