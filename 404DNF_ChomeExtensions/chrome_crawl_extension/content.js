// 특정 요소/노드 타입은 제외 (script/style/noscript/template 등)
const EXCLUDE_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);

function isHidden(el) {
  const style = window.getComputedStyle(el);
  return (
    style.display === 'none' ||
    style.visibility === 'hidden' ||
    style.opacity === '0'
  );
}

function collectTextFromNode(node, texts) {
  // 텍스트 노드
  if (node.nodeType === Node.TEXT_NODE) {
    const t = node.nodeValue || '';
    const s = t.replace(/\s+/g, ' ').trim();
    if (s) texts.push(s);
    return;
  }

  // 요소 노드
  if (node.nodeType === Node.ELEMENT_NODE) {
    const el = /** @type {Element} */ (node);

    if (EXCLUDE_TAGS.has(el.tagName)) return;
    if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') return;
    if (isHidden(el)) return;

    // shadow DOM 지원
    const shadow = el.shadowRoot;
    if (shadow) {
      for (const child of shadow.childNodes) {
        collectTextFromNode(child, texts);
      }
    }

    // 일반 자식 순회
    for (const child of el.childNodes) {
      collectTextFromNode(child, texts);
    }
  }
}

function extractFromDocument(doc) {
  const texts = [];
  if (!doc || !doc.body) return '';

  // body 전체를 걷되, 보이는 텍스트 위주로 수집
  // (innerText 하나로도 충분한 경우가 많지만, 정밀 제어를 위해 수동 순회)
  collectTextFromNode(doc.body, texts);

  // 문단 단위로 결과 정리
  const merged = texts.join(' ').replace(/\s+/g, ' ').trim();

  // 너무 길면 줄바꿈 넣기(가독용) – 원문은 그대로이니 필요시 제거하세요
  // 간단히 마침표/물음표/느낌표 뒤에 줄바꿈
  const pretty = merged.replace(/([\.!\?])\s+/g, '$1\n');
  return pretty;
}

// iframe(동일 출처)의 텍스트도 합치기
function extractAllFrames(win) {
  let all = extractFromDocument(win.document);

  const frames = win.frames;
  for (let i = 0; i < frames.length; i++) {
    try {
      const childWin = frames[i];
      // 동일 출처만 접근 가능
      if (childWin && childWin.document) {
        const sub = extractAllFrames(childWin);
        if (sub) all += '\n' + sub;
      }
    } catch (e) {
      // 교차 출처 보안으로 접근 불가한 경우 무시
      // console.warn('Cross-origin frame skipped:', e);
    }
  }
  return all.trim();
}

// 메시지 핸들러: popup.js -> content.js
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'EXTRACT_TEXT') {
    try {
      const text = extractAllFrames(window);
      sendResponse(text);
    } catch (e) {
      sendResponse('');
    }
    // 비동기 응답이 아니므로 true 반환 불필요
    return;
  }
});
