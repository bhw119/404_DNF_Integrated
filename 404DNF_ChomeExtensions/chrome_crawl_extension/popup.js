/* ──────────────────────────────────────────────────────────────
  popup.js — 초단단 수집 + 중복제거 통합(프레임 내부/외부 모두)
  - 블록: article/section/main/div/p/li/h1~h6/figure/table/caption
  - 블록별 구분자: '#', 단어 구분자: '*'
  - 가시 요소만 수집(visibility/display/size)
  - 리프 블록만 채택
  - 프레임 내부 1차 중복제거(블록 내부/블록 단위)
  - 전 프레임 통합 2차 중복제거
  - 폴백: body.innerText
────────────────────────────────────────────────────────────── */

const statusEl = document.getElementById('status');
const extractBtn = document.getElementById('extractBtn');
const viewAnalysisBtn = document.getElementById('viewAnalysisBtn');

function setStatus(m){ if(statusEl) statusEl.textContent=m; }

let inFlight = false;
let savedDocId = null;

function containsKorean(text){
  if(!text) return false;
  return /[가-힣]/.test(text.replace(/[\s*#]+/g,' '));
}

async function translateGoogle(text){
  const trimmed = (text || '').trim();
  if(!trimmed) throw new Error('빈 텍스트');
  const encoded = encodeURIComponent(trimmed);
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=ko&tl=en&dt=t&q=${encoded}`;
  if(url.length > 2000){
    throw new Error(`URL too long: ${url.length}`);
  }
  const res = await fetch(url,{
    method:'GET',
    headers:{'Accept':'application/json'}
  });
  if(!res.ok){
    const msg = await res.text().catch(()=> '');
    throw new Error(`HTTP ${res.status}: ${msg}`);
  }
  const data = await res.json();
  if(!Array.isArray(data) || !Array.isArray(data[0])){
    throw new Error('Unexpected response');
  }
  let out = '';
  for(const chunk of data[0]){
    if(Array.isArray(chunk) && typeof chunk[0] === 'string'){
      out += chunk[0];
    }
  }
  return out.trim();
}

async function translateBlocks(blocks, onProgress){
  const translated = [];
  for(let i=0;i<blocks.length;i++){
    const block = blocks[i];
    if(onProgress) onProgress(i+1, blocks.length);
    if(!containsKorean(block)){
      translated.push(block);
      continue;
    }
    const plain = block.replace(/\*/g,' ');
    try{
      const result = await translateGoogle(plain);
      const normalized = result
        .replace(/\s+/g,' ')
        .trim()
        .replace(/\s+/g,' ')
        .replace(/ /g,'*');
      translated.push(normalized || block);
      if(i < blocks.length - 1){
        await new Promise(r => setTimeout(r, 300));
      }
    }catch(err){
      console.warn('[번역 실패] 블록 유지:', err);
      translated.push(block);
    }
  }
  return translated;
}

function shouldKeepBlock(block){
  const text = typeof block === 'string' ? block : (block && typeof block.text === 'string' ? block.text : '');
  const trimmed = (text || '').trim();
  if(!trimmed) return false;

  const plain = trimmed.replace(/\*/g, ' ').replace(/\s+/g, ' ').trim();
  const dateLike =
    /\d{1,2}\s*월\s*\d{1,2}\s*일/.test(plain) ||
    /\d{4}\s*[./-]\s*\d{1,2}\s*[./-]\s*\d{1,2}/.test(plain) ||
    /\d{1,2}\s*[./-]\s*\d{1,2}\s*[./-]\s*\d{2,4}/.test(plain);
  if(dateLike) return false;
  if(plain.length < 4) return false;

  const digitRatio = (plain.match(/\d/g) || []).length / plain.length;
  if(digitRatio >= 0.8) return false;

  const specialRatio = (plain.match(/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/g) || []).length / plain.length;
  if(specialRatio > 0.5) return false;

  const noSpace = plain.replace(/\s+/g, '');
  if(!noSpace) return false;

  const meaningfulChars = plain.replace(/[\d\s!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/g, '');
  if(!meaningfulChars) return false;

  const words = plain.split(/\s+/).filter(Boolean);
  if(words.length === 1 && words[0].length <= 3) return false;

  const excludePatterns = [
    /^(home|로그인|login|sign up|회원가입|sign in|logout|로그아웃|menu|메뉴|search|검색|about|소개|contact|연락처|click here|click|here|more|더보기|view|보기|close|닫기|next|다음|previous|이전|back|뒤로|skip|건너뛰기)$/i,
    /^\d{4}[-\/]\d{1,2}[-\/]\d{1,2}$/,
    /^\d{1,2}:\d{2}(:\d{2})?$/,
    /^[\w\.-]+@[\w\.-]+\.\w+$/,
    /^https?:\/\/.+/i,
    /^[\d\s\-\(\)\+]+$/,
    /^[\w가-힣]{1,2}$/,
    /^[a-zA-Z0-9]$/
  ];
  if(excludePatterns.some((re) => re.test(plain))) return false;

  if(plain.length <= 10){
    const keywordPatterns = [
      /\b(limited|한정|제한|today only|지금|now|마감|마지막|stock|재고|남았|remaining)\b/i,
      /\b(discount|할인|sale|세일|save|off|무료 배송|buy now|구매|order|주문|checkout|결제)\b/i,
      /\b(must|해야|필수|mandatory|exclusive|독점|only|오직)\b/i,
      /\b(terms|조건|동의|accept|consent|승인)\b/i,
      /\b(sign up|가입|register|등록|subscribe|구독|membership|회원)\b/i,
      /\b(price|가격|cost|비용|fee|수수료|charge|요금)\b/i,
      /\b(benefit|혜택|promotion|프로모션|offer|제안|deal|특별)\b/i
    ];
    if(!keywordPatterns.some((re) => re.test(plain))) return false;
  }

  const numberTokens = plain.match(/[\d%]+/g) || [];
  const stockKeywords = [
    '주식','코스피','코스닥','나스닥','지수','증권','상승','하락',
    '거래량','거래대금','종목','선물','옵션','포인트','환율',
    '삼성전자','sk하이닉스','카카오','네이버','lg에너지','시가','종가','코스피200'
  ];
  const weatherKeywords = [
    '기온','맑음','흐림','비','눈','강수','미세','초미세','먼지',
    '습도','체감','날씨','구름','풍속','기상','예보','최저','최고',
    '자외선','오존','일출','일몰','강우','황사'
  ];

  const plainLower = plain.toLowerCase();
  const containsStock = stockKeywords.some((kw) => plainLower.includes(kw));
  const containsWeather = weatherKeywords.some((kw) => plainLower.includes(kw));
  const hasManyNumbers = numberTokens.length >= 2;

  if((containsStock || containsWeather) && hasManyNumbers){
    return false;
  }

  return true;
}

/* 활성 탭 */
async function getActiveTab(){
  const [tab] = await chrome.tabs.query({ active:true, currentWindow:true });
  return tab;
} 

/* ===== 전 프레임 통합 dedupe(확장 컨텍스트에서 수행) ===== */
function canonKeyGlobal(entry){
  const isObject = entry && typeof entry === 'object';
  const rawText = typeof entry === 'string' ? entry : (isObject && typeof entry.text === 'string' ? entry.text : '');
  const normalizedText = rawText
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^0-9\p{L}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if(!isObject){
    return `text|${normalizedText}`;
  }
  const tag = (entry.tag || '').toString().toLowerCase();
  const selector = (entry.selector || '').toString().toLowerCase();
  const blockType = (entry.blockType || '').toString().toLowerCase();
  const frameIdx = Number.isFinite(entry.frameBlockIndex) ? entry.frameBlockIndex : '';
  const frameId = Number.isFinite(entry.frameId) ? entry.frameId : (entry.frameId || '');
  const linkHref = (entry.linkHref || '').toString().toLowerCase();
  const linkSelector = (entry.linkSelector || '').toString().toLowerCase();
  return [
    'obj',
    tag,
    selector,
    blockType,
    frameIdx,
    frameId,
    linkSelector,
    linkHref,
    normalizedText
  ].join('|');
}

function dedupeBlocksGlobal(blocks){
  const seen = new Set();
  const out = [];
  for(const b of blocks){
    const k = canonKeyGlobal(b);
    if(!k) continue;
    if(seen.has(k)) continue;
    seen.add(k);
    out.push(b);
  }
  return out;
}

function dedupeInsideBlockGlobal(block){
  if(!block) return block;
  const text = typeof block === 'string' ? block : block.text;
  if(!text) return block;
  const toks = text.split('*').map(t => t.trim()).filter(Boolean);
  const seen = new Set();
  const out = [];
  for(const t of toks){
    const k = canonKeyGlobal(t);
    if(!k) continue;
    if(seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  const joined = out.join('*');
  if(typeof block === 'string') return joined;
  return {
    ...block,
    text: joined,
    plainText: joined.replace(/\*/g, ' '),
    rawText: block.rawText ?? block.text,
    rawPlainText: block.rawPlainText ?? block.plainText
  };
}

function mergeFramesAndDedupe(frameResults){
  const allBlocks = [];
  for(const r of frameResults){
    if(Array.isArray(r?.blocks)){
      for(const blk of r.blocks){
        allBlocks.push({
          ...blk,
          frameUrl: blk.frameUrl || r.frameUrl || '',
          frameTitle: blk.frameTitle || r.title || '',
          frameId: blk.frameId ?? r.frameId ?? null
        });
      }
      continue;
    }
    const text = (r?.text || '').trim();
    if(!text) continue;
    const bs = text.split('#').map(s => s.trim()).filter(Boolean).map((str, idx) => ({
      text: str,
      plainText: str.replace(/\*/g, ' '),
      rawText: str,
      rawPlainText: str.replace(/\*/g, ' '),
      selector: '',
      tag: '',
      frameUrl: r.frameUrl || '',
      frameTitle: r.title || '',
      frameBlockIndex: idx,
      blockType: 'legacy',
      frameId: r.frameId ?? null,
      linkHref: '',
      linkSelector: ''
    }));
    allBlocks.push(...bs);
  }
  const normalizedBlocks = allBlocks.map(dedupeInsideBlockGlobal);
  return dedupeBlocksGlobal(normalizedBlocks);
}

function normalizeBlockText(block){
  if(!block) return '';
  const raw = typeof block === 'string' ? block : (block.plainText || block.text || '');
  return raw
    .toString()
    .replace(/\*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/* ===== 프레임 내부에서 실행되는 함수(주입 함수) ===== */
function frameCollectByBlocks(){
  // ── 프레임 내부에서도 사용 가능한 dedupe 유틸(여기 정의 必)
  function canonKeyLocal(entry){
    const isObject = entry && typeof entry === 'object';
    const rawText = typeof entry === 'string' ? entry : (isObject && typeof entry.text === 'string' ? entry.text : '');
    const normalizedText = rawText
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^0-9\p{L}]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if(!isObject){
      return `text|${normalizedText}`;
    }
    const tag = (entry.tag || '').toString().toLowerCase();
    const selector = (entry.selector || '').toString().toLowerCase();
    const blockType = (entry.blockType || '').toString().toLowerCase();
    const frameIdx = Number.isFinite(entry.frameBlockIndex) ? entry.frameBlockIndex : '';
  const linkHref = (entry.linkHref || '').toString().toLowerCase();
  const linkSelector = (entry.linkSelector || '').toString().toLowerCase();
    return [
      'obj',
      tag,
      selector,
      blockType,
      frameIdx,
    linkSelector,
    linkHref,
      normalizedText
    ].join('|');
  }

function dedupeBlocksLocal(blocks){
    const seen = new Set();
    const out = [];
    for(const b of blocks){
      const k = canonKeyLocal(b);
      if(!k) continue;
      if(seen.has(k)) continue;
      seen.add(k);
      out.push(b);
    }
    return out;
  }

  function dedupeInsideBlockLocal(block){
    if(!block) return block;
    const text = typeof block === 'string' ? block : block.text;
    if(!text) return block;
    const toks = text.split('*').map(t => t.trim()).filter(Boolean);
    const seen = new Set();
    const out = [];
    for(const t of toks){
      const k = canonKeyLocal(t);
      if(!k) continue;
      if(seen.has(k)) continue;
      seen.add(k);
      out.push(t);
    }
    const joined = out.join('*');
    if(typeof block === 'string') return joined;
  return {
    ...block,
    text: joined,
    plainText: joined.replace(/\*/g, ' '),
    rawText: block.rawText ?? block.text,
    rawPlainText: block.rawPlainText ?? block.plainText
  };
  }

  const EXCLUDE = new Set([
    'SCRIPT','STYLE','NOSCRIPT','TEMPLATE',
    'IFRAME','SVG','CANVAS','CODE','PRE','KBD','SAMP','TEXTAREA','INPUT','SELECT','BUTTON','LABEL','FORM','NAV','MENU'
  ]);

  const BLOCK_SEL = [
    'article','section','main','[role="main"]',
    'div','p','li',
    'h1','h2','h3','h4','h5','h6',
    'figure','figcaption','table','caption'
  ].join(',');

  const URL_RE = /\b(?:https?:\/\/|www\.)\S+/gi;

  function isVisible(el){
    if(!el) return false;
    if(EXCLUDE.has(el.tagName)) return false;
    const s = getComputedStyle(el);
    if(s.display==='none' || s.visibility==='hidden' || s.opacity==='0') return false;
    const r = el.getBoundingClientRect();
    if((r.width<=0 || r.height<=0) && (el.offsetWidth<=0 || el.offsetHeight<=0)) return false;
    return true;
  }

  function extractText(el){
    const walker = document.createTreeWalker(
      el,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(n){
          const t = n.nodeValue || '';
          if(!t.trim()) return NodeFilter.FILTER_REJECT;
          let p = n.parentElement;
          while(p){
            if(EXCLUDE.has(p.tagName)) return NodeFilter.FILTER_REJECT;
            p = p.parentElement;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );
    let parts = [], node = walker.nextNode();
    while(node){
      parts.push(node.nodeValue);
      node = walker.nextNode();
    }
    let txt = parts.join(' ').replace(URL_RE,' ').replace(/\s+/g,' ').trim();
    return txt;
  }

  function pickLeafBlocks(nodes){
    const set = new Set(nodes);
    const keep = [];
    for(const el of nodes){
      let hasTextChild = false;
      for(const ch of el.querySelectorAll('div,p,li,h1,h2,h3,h4,h5,h6,figure,figcaption,table,caption')){
        if(set.has(ch)) continue;
        const t = (ch.textContent||'').trim();
        if(t.length >= 2){ hasTextChild = true; break; }
      }
      if(!hasTextChild) keep.push(el);
    }
    return keep;
  }

  function toStarWords(text){
    if(!text) return '';
    return text.split(/\s+/).filter(Boolean).join('*');
  }

function extractPrimaryLink(el){
  if(!el) return null;
  const anchor = el.closest('a[href]') || el.querySelector('a[href]');
  if(anchor && typeof anchor.href === 'string' && anchor.href.trim()){
    return {
      href: anchor.href,
      selector: getDomPath(anchor)
    };
  }
  return null;
}

  function getTitle(){
    const og = document.querySelector('meta[property="og:title"]')?.content?.trim();
    const tw = document.querySelector('meta[name="twitter:title"]')?.content?.trim();
    const h1 = document.querySelector('h1')?.textContent?.trim();
    const dt = document.title || '';
    return [og,tw,h1,dt].filter(Boolean)[0] || '';
  }

  function getDomPath(el){
    if(!el || el.nodeType !== Node.ELEMENT_NODE) return '';
    const segments = [];
    let current = el;
    while(current && current.nodeType === Node.ELEMENT_NODE){
      let segment = current.tagName.toLowerCase();
      if(current.id){
        segment += `#${current.id}`;
        segments.unshift(segment);
        break;
      }
      const parent = current.parentElement;
      if(parent){
        const siblings = Array.from(parent.children).filter(child => child.tagName === current.tagName);
        if(siblings.length > 1){
          const index = siblings.indexOf(current);
          segment += `:nth-of-type(${index + 1})`;
        }
      }
      segments.unshift(segment);
      current = current.parentElement;
    }
    return segments.join(' > ');
  }

  const all = Array.from(document.querySelectorAll(BLOCK_SEL)).filter(isVisible);
  const texty = all.filter(el => (el.textContent||'').trim().length >= 2);
  const leafs = pickLeafBlocks(texty);

  let blocks = [];
  const title = getTitle();
  if(title){
    const starTitle = toStarWords(title);
    const frameBlockIndex = blocks.length;
    blocks.push({
      text: starTitle,
      plainText: title,
      rawText: starTitle,
      rawPlainText: title,
      selector: 'head > title',
      tag: 'title',
      frameUrl: location.href || '',
      frameTitle: title || '',
      frameBlockIndex,
      blockType: 'title',
      linkHref: null,
      linkSelector: null
    });
  }

  for(const el of leafs){
    const t = extractText(el);
    if(!t) continue;
    if(t.length < 2) continue;
    const star = toStarWords(t);
    const frameBlockIndex = blocks.length;
    const linkMeta = extractPrimaryLink(el);
    blocks.push({
      text: star,
      plainText: t,
      rawText: star,
      rawPlainText: t,
      selector: getDomPath(el),
      tag: el.tagName.toLowerCase(),
      frameUrl: location.href || '',
      frameTitle: title || '',
      frameBlockIndex,
      blockType: 'content',
      linkHref: linkMeta?.href || null,
      linkSelector: linkMeta?.selector || null
    });
  }

  if(blocks.length === 0){
    const t = (document.body?.innerText || '').replace(/\s+/g,' ').trim();
    if(t){
      const star = toStarWords(t);
      if(star) blocks.push({
        text: star,
        plainText: t,
        rawText: star,
        rawPlainText: t,
        selector: 'body',
        tag: 'body',
        frameUrl: location.href || '',
        frameTitle: title || '',
        frameBlockIndex: 0,
        blockType: 'fallback',
        linkHref: null,
        linkSelector: null
      });
    }
  }

  // 프레임 내부 1차 정리: 블록 내부/블록 단위 중복 제거
  blocks = blocks.map(dedupeInsideBlockLocal);
  blocks = dedupeBlocksLocal(blocks);

  return {
    frameUrl: location.href || '',
    title: title || '',
    blocks,
    text: blocks.map(b => b.text).join('#')
  };
}

/* ===== 디버그(선택) ===== */
function assembleOutput(tabInfo, frameResults){
  const ts = new Date().toISOString();
  return [
    `# Snapshot @ ${ts}`,
    `Tab: ${tabInfo.title || ''} | ${tabInfo.url || ''}`,
    `Frames: ${frameResults.length}`,
    frameResults.map((r,i)=>{
      if(Array.isArray(r?.blocks)){
        const preview = r.blocks.slice(0,5).map((blk,idx)=>{
          const plain = (blk?.plainText || blk?.text || '').replace(/\*/g,' ');
          return `[Block ${idx+1}] ${plain.slice(0,160)}${plain.length>160?'…':''}`;
        }).join('\n');
        return `---\n[Frame ${i+1}] ${r.frameUrl}\n${preview}`;
      }
      return `---\n[Frame ${i+1}] ${r.frameUrl}\n${(r.text||'').slice(0,800)}...`;
    }).join('\n')
  ].join('\n');
}

/* ===== 서버 전송 ===== */
const API_BASE = "http://localhost:8000";
const API_KEY  = "";

async function sendToApi(payload){
  const headers = { "Content-Type": "application/json" };
  if(API_KEY) headers["x-api-key"] = API_KEY;
  const res = await fetch(`${API_BASE}/collect`,{
    method:'POST', headers, body: JSON.stringify(payload)
  });
  if(!res.ok){
    const msg = await res.text().catch(()=> "");
    throw new Error(`API ${res.status}: ${msg}`);
  }
  return res.json();
}

/* ===== 메인 핸들러 ===== */
viewAnalysisBtn?.addEventListener('click', async ()=>{
  if(!savedDocId){
    setStatus('⚠️ 저장된 분석 결과가 없습니다.');
    return;
  }
  try{
    const activeTab = await getActiveTab();
    if(!activeTab?.id){
      setStatus('⚠️ 활성 탭을 찾지 못했습니다.');
      return;
    }
    if(chrome?.sidePanel?.setOptions){
      await chrome.sidePanel.setOptions({
        tabId: activeTab.id,
        path: `sidepanel_analysis.html?doc=${encodeURIComponent(savedDocId)}`
      });
    }
    if(chrome?.sidePanel?.open){
      await chrome.sidePanel.open({ tabId: activeTab.id });
      setStatus('분석 결과를 열었습니다.');
    }else{
      setStatus('⚠️ Side Panel API를 지원하지 않습니다.');
    }
  }catch(err){
    console.error('[사이드패널 열기 실패]', err);
    setStatus(`⚠️ 분석 페이지 열기 실패: ${err?.message || err}`);
  }
});

extractBtn.addEventListener('click', async ()=>{
  if(inFlight) return;
  inFlight = true;
  setStatus('수집 중...');
  savedDocId = null;
  if(viewAnalysisBtn){
    viewAnalysisBtn.style.display = 'none';
  }

  try{
    const tab = await getActiveTab();
    if(!tab?.id){ setStatus('활성 탭 없음'); return; }

    const results = await chrome.scripting.executeScript({
      target:{ tabId: tab.id, allFrames: true },
      func: frameCollectByBlocks
    });

    const frameResults = (results||[])
      .map((entry) => {
        if(!entry || !entry.result) return null;
        const base = { ...entry.result };
        if(typeof entry.frameId === 'number') base.frameId = entry.frameId;
        if(typeof entry.documentId === 'string') base.documentId = entry.documentId;
        return base;
      })
      .filter(Boolean);

    // 비어있을 경우 최상위 프레임 폴백
    const any = frameResults.some(r => {
      if(Array.isArray(r?.blocks)) return r.blocks.length > 0;
      return Boolean((r?.text || '').trim().length);
    });
    if(!any){
      const retry = await chrome.scripting.executeScript({
        target:{ tabId: tab.id, allFrames: false },
        func: frameCollectByBlocks
      });
      const rr = (retry||[])
        .map((entry) => {
          if(!entry || !entry.result) return null;
          const base = { ...entry.result };
          if(typeof entry.frameId === 'number') base.frameId = entry.frameId;
          if(typeof entry.documentId === 'string') base.documentId = entry.documentId;
          return base;
        })
        .filter(Boolean);
      frameResults.push(...rr);
    }

    if(frameResults.length===0 || !frameResults.some(r=>{
      if(Array.isArray(r?.blocks)) return r.blocks.some(b => (b?.text || '').trim());
      return (r?.text || '').trim();
    })){
      setStatus('수집된 데이터가 없습니다(폴백 실패).');
      console.debug('DEBUG(no-data):', assembleOutput(tab, frameResults));
      return;
    }

    console.debug(assembleOutput(tab, frameResults));

    // 전 프레임 통합 2차 dedupe
    const mergedBlocks = mergeFramesAndDedupe(frameResults);

    const filteredBlocks = mergedBlocks.filter(shouldKeepBlock);
    const uniqueBlocks = [];
    const seenBlockKeys = new Set();
    for(const block of filteredBlocks){
      if(!block) continue;
      const normalizedText = normalizeBlockText(block);
      if(!normalizedText) continue;
      const selectorKey = (block.selector || '').toString();
      const frameKey = (block.frameUrl || '').toString();
      const linkKey = (block.linkHref || '').toString();
      const linkSelectorKey = (block.linkSelector || '').toString();
      const combinedKey = `${normalizedText}|${selectorKey}|${frameKey}|${linkKey}|${linkSelectorKey}`;
      if(seenBlockKeys.has(combinedKey)) continue;
      seenBlockKeys.add(combinedKey);
      uniqueBlocks.push(block);
    }

    if(uniqueBlocks.length === 0){
      setStatus('⚠️ 유의미한 텍스트가 없습니다.');
      console.warn('[필터] 유지된 블록이 없어 전송을 중단합니다.');
      return;
    }

    const originalBlocks = uniqueBlocks.map((block, index) => ({
      ...block,
      index,
      originalText: block.text,
      originalPlainText: block.plainText ?? block.text.replace(/\*/g, ' ')
    }));

    const originalText = originalBlocks.map(b => b.originalText).join('#');

    let translatedBlocks = originalBlocks.map(block => ({ ...block }));
    if(translatedBlocks.some(b => containsKorean(b.text))){
      setStatus('번역 중... (1/' + translatedBlocks.length + ')');
      const translatedTexts = await translateBlocks(translatedBlocks.map(b => b.text), (cur,total)=>{
        setStatus(`번역 중... (${cur}/${total})`);
      });
      translatedBlocks = translatedBlocks.map((block, idx) => {
        const nextText = (translatedTexts && translatedTexts[idx]) ? translatedTexts[idx] : block.text;
        const translatedPlain = nextText.replace(/\*/g, ' ');
        return {
          ...block,
          text: nextText,
          translated: nextText !== block.originalText,
          translatedPlainText: translatedPlain
        };
      });
      setStatus('번역 완료');
    }else{
      translatedBlocks = translatedBlocks.map(block => ({
        ...block,
        translated: false,
        translatedPlainText: block.text.replace(/\*/g, ' ')
      }));
    }

    const fullText = translatedBlocks.map(b => b.text).join('#');

    const payload = {
      tabUrl: tab.url || '',
      tabTitle: tab.title || '',
      collectedAt: new Date().toISOString(),
      framesCollected: frameResults.length,
      fullText,
      originalText,
      frames: frameResults.map(r=>r.frameUrl),
      frameMetadata: frameResults.map((r, idx) => ({
        index: idx,
        frameUrl: r.frameUrl,
        frameId: typeof r.frameId === 'number' ? r.frameId : null,
        title: r.title,
        blocks: Array.isArray(r.blocks) ? r.blocks.length : ((r.text || '').split('#').filter(Boolean).length)
      })),
      structuredBlocks: translatedBlocks.map(block => ({
        index: block.index,
        selector: block.selector,
        tag: block.tag,
        frameUrl: block.frameUrl,
        frameTitle: block.frameTitle,
        frameBlockIndex: block.frameBlockIndex,
        blockType: block.blockType,
        frameId: block.frameId ?? null,
        linkHref: block.linkHref || null,
        linkSelector: block.linkSelector || null,
        text: block.text,
        plainText: block.plainText ?? block.text.replace(/\*/g, ' '),
        originalText: block.originalText,
        originalPlainText: block.originalPlainText,
        rawText: block.rawText,
        rawPlainText: block.rawPlainText,
        translatedPlainText: block.translatedPlainText,
        translated: block.translated
      }))
    };

    let apiRes = null;
    try{ apiRes = await sendToApi(payload); }
    catch(e){ console.warn('API 전송 실패:', e); }

    try{
      const savedId = apiRes && typeof apiRes==='object' && apiRes.id ? apiRes.id : null;
      if(chrome?.sidePanel?.setOptions && chrome?.sidePanel?.open){
        const activeTab = await getActiveTab();
        await chrome.sidePanel.setOptions({
          tabId: activeTab.id,
          path: savedId ? `sidepanel_summary.html?doc=${encodeURIComponent(savedId)}` : `sidepanel_summary.html`
        });
        await chrome.sidePanel.open({ tabId: activeTab.id });
      }
    }catch(e){ console.warn('사이드패널 열기 실패:', e); }

    if(apiRes && typeof apiRes === 'object' && apiRes.id){
      savedDocId = apiRes.id;
      if(viewAnalysisBtn){
        viewAnalysisBtn.style.display = 'block';
      }
    }else if(viewAnalysisBtn){
      viewAnalysisBtn.style.display = 'none';
    }

    setStatus('완료');
  }catch(err){
    console.error(err);
    setStatus(`오류: ${err?.message || err}`);
    if(viewAnalysisBtn){
      viewAnalysisBtn.style.display = 'none';
    }
  }finally{
    inFlight = false;
  }
});
