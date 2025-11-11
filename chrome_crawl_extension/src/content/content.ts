// Migrated from legacy content.js
const EXCLUDE_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"]);

function isHidden(el: Element): boolean {
  const style = window.getComputedStyle(el);
  return (
    style.display === "none" ||
    style.visibility === "hidden" ||
    style.opacity === "0"
  );
}

function collectTextFromNode(node: Node, texts: string[]): void {
  if (node.nodeType === Node.TEXT_NODE) {
    const t = node.nodeValue || "";
    const s = t.replace(/\s+/g, " ").trim();
    if (s) texts.push(s);
    return;
  }
  if (node.nodeType === Node.ELEMENT_NODE) {
    const el = node as Element;
    if (EXCLUDE_TAGS.has(el.tagName)) return;
    if (el.getAttribute && el.getAttribute("aria-hidden") === "true") return;
    if (isHidden(el)) return;
    const shadow = (el as any).shadowRoot as ShadowRoot | null | undefined;
    if (shadow) {
      shadow.childNodes.forEach((child) => collectTextFromNode(child, texts));
    }
    el.childNodes.forEach((child) => collectTextFromNode(child, texts));
  }
}

function extractFromDocument(doc: Document): string {
  const texts: string[] = [];
  if (!doc || !doc.body) return "";
  collectTextFromNode(doc.body, texts);
  const merged = texts.join(" ").replace(/\s+/g, " ").trim();
  const pretty = merged.replace(/([\.!\?])\s+/g, "$1\n");
  return pretty;
}

function extractAllFrames(win: Window): string {
  let all = extractFromDocument(win.document);
  const frames = win.frames;
  for (let i = 0; i < frames.length; i++) {
    try {
      const childWin = frames[i];
      if (childWin && (childWin as Window).document) {
        const sub = extractAllFrames(childWin as unknown as Window);
        if (sub) all += "\n" + sub;
      }
    } catch {
      // cross-origin frame: ignore
    }
  }
  return all.trim();
}

chrome.runtime.onMessage.addListener(
  (
    msg: { type: string },
    _sender: any,
    sendResponse: (arg0: string) => void
  ) => {
    if (msg?.type === "EXTRACT_TEXT") {
      try {
        const text = extractAllFrames(window);
        sendResponse(text);
      } catch {
        sendResponse("");
      }
      return;
    }
  }
);
