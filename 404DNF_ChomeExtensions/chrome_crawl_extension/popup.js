const statusEl = document.getElementById('status');
const extractBtn = document.getElementById('extractBtn');
const viewAnalysisBtn = document.getElementById('viewAnalysisBtn');

function setStatus(msg) {
  statusEl.textContent = msg;
}

// 저장된 문서 ID (사이드패널 열기용)
let savedDocId = null;

let inFlight = false;

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}
function sanitizeFilename(name) {
  return (name || 'page').replace(/[\\/:*?"<>|]+/g, '_').trim();
}

/* =========================
   한글 감지 함수
   ========================= */
function containsKorean(text) {
  if (!text || typeof text !== 'string') {
    return false;
  }
  // 한글 유니코드 범위: AC00-D7AF (가-힣)
  const koreanRegex = /[가-힣]/;
  return koreanRegex.test(text);
}

/* =========================
   프레임별 텍스트 추출 (Box/문장 단위)
   ========================= */
function frameExtractorClean() {
  const EXCLUDE_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE',
    'PRE', 'CODE', 'KBD', 'SAMP',
    'TEXTAREA', 'INPUT', 'SELECT', 'BUTTON',
    'SVG', 'CANVAS', 'IFRAME'
  ]);
  const EXCLUDE_CLASS_RE = /(code|syntax|prettyprint|hljs|gist|prism|highlight)/i;

  function looksCodey(text) {
    if (!text) return false;
    const t = text.trim();
    if (t.length < 40) return false;

    const jsKeywords = /(function|var\s|const\s|let\s|return|=>|parseInt|document|window|eval|JSON|\bfor\s*\(|while\s*\(|try\s*\{|catch\s*\(|finally|Object\.|Array\.|Math\.)/;
    const hexPattern = /0x[0-9a-fA-F]+/;
    const longRunNoSpace = /\S{60,}/;
    const manySemicolons = /(;|\{|\}|\(|\)){6,}/;
    const base64ish = /[A-Za-z0-9+/=]{80,}/;

    let score = 0;
    if (jsKeywords.test(t)) score++;
    if (hexPattern.test(t)) score++;
    if (longRunNoSpace.test(t)) score++;
    if (manySemicolons.test(t)) score++;
    if (base64ish.test(t)) score++;

    const cleaned = t.replace(/[A-Za-z0-9가-힣\s.,:;!?'"()\-_/]/g, '');
    const nonWordRatio = cleaned.length / t.length;
    if (nonWordRatio > 0.35) score++;

    return score >= 2;
  }

  function isHiddenElement(el) {
    const style = getComputedStyle(el);
    return (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.opacity === '0'
    );
  }

  function shouldSkipElement(el) {
    if (!el || EXCLUDE_TAGS.has(el.tagName)) return true;
    if (el.getAttribute('aria-hidden') === 'true') return true;
    if (isHiddenElement(el)) return true;
    if (EXCLUDE_CLASS_RE.test(el.className || '')) return true;
    const style = getComputedStyle(el);
    if (style.whiteSpace.includes('pre')) return true;
    if ((style.fontFamily || '').toLowerCase().includes('mono')) return true;
    return false;
  }

  function collectText(root) {
    const out = [];
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const el = /** @type {Element} */ (node);
            return shouldSkipElement(el)
              ? NodeFilter.FILTER_REJECT
              : NodeFilter.FILTER_SKIP;
          } else if (node.nodeType === Node.TEXT_NODE) {
            return NodeFilter.FILTER_ACCEPT;
          }
          return NodeFilter.FILTER_SKIP;
        }
      }
    );

    let current = walker.currentNode;
    while (current) {
      if (current.nodeType === Node.TEXT_NODE) {
        const t = current.nodeValue || '';
        const s = t.replace(/\s+/g, ' ').trim();
        if (s && !looksCodey(s)) out.push(s);
      }
      current = walker.nextNode();
    }
    return out;
  }

  const doc = document;
  const title = doc.title || '';
  const url = location.href || '';
  let texts = [];

  try {
    if (doc.body) texts = collectText(doc.body);
  } catch (_) {}

  const merged = texts.join(' ').replace(/\s+/g, ' ').trim();
  
  // 텍스트를 의미 있는 단위로 구분: 문장 단위로 *로 분리
  // 마침표/물음표/느낌표 뒤에 * 추가하여 박스 단위 구분
  let pretty = merged
    .replace(/([\.!\?])\s+/g, '$1*')  // 문장 끝에 * 추가
    .replace(/([가-힣a-zA-Z0-9])\s+([A-Z가-힣])/g, '$1*$2')  // 대문자/한글 시작 전에도 * (새 문장)
    .replace(/\*+/g, '*')  // 연속된 *를 하나로
    .replace(/^\*+|\*+$/g, '')  // 시작과 끝의 * 제거
    .trim();

  // 링크/URL 목록은 반환하지 않음
  return { frameUrl: url, title, text: pretty };
}

/* =========================
   파일 저장용 문자열 조립
   ========================= */
function assembleOutput(tabInfo, frameResults) {
  const ts = new Date().toISOString();
  const parts = [];

  parts.push(`# Page Snapshot
- Collected At: ${ts}
- Tab URL: ${tabInfo.url || ''}
- Tab Title: ${tabInfo.title || ''}
- Frames Collected: ${frameResults.length}
`);

  const texts = [];
  frameResults.forEach((r, i) => {
    if (r.text && r.text.trim()) {
      texts.push(`\n---\n[Frame ${i+1}] ${r.frameUrl}\n\n${r.text.trim()}`);
    }
  });
  const fullText = texts.join('\n');

  // URL 섹션 완전 제거
  parts.push(`\n\n# TEXT (All Frames, Cleaned)\n${fullText || '(no text)'}\n`);

  return parts.join('');
}

/* =========================
   번역 함수 (Google Translate)
   ========================= */
async function translateGoogle(text) {
  try {
    if (!text || !text.trim()) {
      throw new Error('번역할 텍스트가 없습니다.');
    }
    
    // URL 길이 제한을 고려하여 텍스트 길이 조정 (약 2000자 정도가 안전)
    let maxTextLength = 1500;
    let textToTranslate = text;
    
    // 텍스트를 점진적으로 줄여가며 URL 길이 체크
    while (textToTranslate.length > 0) {
      const testUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=ko&tl=en&dt=t&q=${encodeURIComponent(textToTranslate.substring(0, maxTextLength))}`;
      if (testUrl.length < 2000) {
        break;
      }
      maxTextLength -= 100;
      if (maxTextLength < 100) {
        maxTextLength = 100;
        break;
      }
    }
    
    textToTranslate = text.length > maxTextLength ? text.substring(0, maxTextLength) : text;
    
    const encodedText = encodeURIComponent(textToTranslate);
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=ko&tl=en&dt=t&q=${encodedText}`;
    
    if (url.length > 2000) {
      throw new Error(`URL이 너무 깁니다: ${url.length}자 (최대 2000자)`);
    }
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      }
    });
    
    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      
      // 400 에러인 경우 텍스트를 더 짧게 줄여서 재시도
      if (response.status === 400 && textToTranslate.length > 200) {
        const shorterText = textToTranslate.substring(0, Math.floor(textToTranslate.length * 0.7));
        return await translateGoogle(shorterText);
      }
      
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    
    // 응답 형식 확인 및 파싱
    if (data && Array.isArray(data) && data[0] && Array.isArray(data[0])) {
      let translated = '';
      for (const item of data[0]) {
        if (Array.isArray(item) && item[0] && typeof item[0] === 'string') {
          translated += item[0];
        }
      }
      
      if (translated && translated.trim()) {
        // 원문이 잘린 경우 나머지 부분도 번역하여 합치기
        if (text.length > textToTranslate.length) {
          const remaining = text.substring(textToTranslate.length);
          try {
            const remainingTranslated = await translateGoogle(remaining);
            return (translated.trim() + ' ' + remainingTranslated.trim()).trim();
          } catch (e) {
            return translated.trim();
          }
        }
        
        return translated.trim();
      }
    }
    
    throw new Error('Google Translate API 응답 형식 오류');
  } catch (error) {
    console.error('[EXTENSION] Google Translate 오류:', error.message);
    throw error;
  }
}

/* =========================
   텍스트 청크 단위로 번역 (API 제한 대응)
   ========================= */
async function translateTextChunked(text, onProgress = null) {
  if (!text || !text.trim()) {
    return text;
  }
  
  if (!containsKorean(text)) {
    return text;
  }

  // 텍스트를 * 기준으로 분리 (박스/문장 단위)
  const parts = text.split(/\*+/).filter(p => p.trim());
  
  if (parts.length === 0) {
    return text;
  }

  const totalParts = parts.length;
  
  // 각 박스/문장을 번역
  const translatedParts = [];
  
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].trim();
    if (!part) continue;
    
    // 진행 상황 업데이트
    if (onProgress) {
      onProgress(i + 1, totalParts);
    }
    
    if (containsKorean(part)) {
      try {
        const translated = await translateGoogle(part);
        translatedParts.push(translated);
        
        // API 제한 대비 지연
        if (parts.length > 1 && i < parts.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      } catch (error) {
        console.error(`[번역 ${i + 1}/${totalParts}] 번역 실패, 원문 사용:`, error.message);
        translatedParts.push(part);
      }
    } else {
      translatedParts.push(part);
    }
  }

  const result = translatedParts.join('*');
  return result;
}

/* =========================
   다크패턴 전처리: 박스 단위(연결된 단어 집합)로 필터링
   ========================= */
function preprocessForDarkPattern(text) {
  if (!text || !text.trim()) return '';
  
  // 박스 단위로 분리: * (별표)를 기준으로 각 박스(텍스트 블록)를 분리
  const boxes = text
    .split(/\*+/g)
    .map(box => box.trim())
    .filter(box => box.length > 0);
  
  // 제거할 매우 짧은 단어/패턴들 (다크패턴 확률 0%로 판단되는 것들)
  const EXCLUDE_SHORT_WORDS = [
    // 단일 단어 (너무 짧음)
    /^(home|홈|login|로그인|sign up|회원가입|sign in|로그아웃|logout|menu|메뉴|search|검색|about|about us|소개|contact|연락처|click|클릭|here|여기|more|더보기|read more|자세히|view|보기|close|닫기|next|다음|previous|이전|back|뒤로|skip|건너뛰기)$/i,
    // 날짜/시간만
    /^\d{4}[-\/]\d{1,2}[-\/]\d{1,2}$/,
    /^\d{1,2}:\d{2}(:\d{2})?$/,
    // 이메일 주소만
    /^[\w\.-]+@[\w\.-]+\.\w+$/,
    // URL만
    /^https?:\/\/.+/i,
    // 전화번호만
    /^[\d\s\-\(\)\+]+$/,
    // 숫자만
    /^\d+$/,
    // 1-2자 단어 (한글 포함)
    /^[\w가-힣]{1,2}$/,
    // 단일 알파벳/숫자
    /^[a-zA-Z0-9]$/,
  ];
  
  // 제외할 패턴들 (저작권, 법적 고지 등)
  const EXCLUDE_PATTERNS = [
    /^(copyright|저작권|©|all rights reserved|all rights|무단.*금지|©\s*\d{4})/i,
    /^(privacy policy|개인정보처리방침|terms|이용약관|terms of service|terms of use|이용.*약관)/i,
  ];
  
  // 의미있는 키워드 패턴 (다크패턴 관련)
  const DARK_PATTERN_KEYWORDS = [
    // 긴급성/희소성
    /\b(limited|제한|한정|only|오직|today only|오늘|지금|now|바로|hurry|서두르|last chance|마지막|ending soon|곧 종료|sale ends|세일 종료|stock|재고|left|남았|remaining|잔여)\b/i,
    // 할인/특가 관련
    /\b(discount|할인|sale|세일|save|절약|off|% off|퍼센트|free shipping|무료 배송|buy now|지금 구매|purchase|구매|order|주문|checkout|결제)\b/i,
    // 압박/강요
    /\b(must|해야|should|필요|required|필수|mandatory|의무|cannot|불가|unable|못하|only|오직|exclusive|독점)\b/i,
    // 조건/제약
    /\b(terms|조건|condition|terms and conditions|이용.*조건|agree|동의|accept|수락|consent|승인)\b/i,
    // 가입/등록
    /\b(sign up|가입|register|등록|join|참여|membership|회원|subscribe|구독|newsletter|뉴스레터)\b/i,
    // 조항/정책
    /\b(policy|정책|rule|규칙|regulation|규정|guideline|지침|agreement|협정|contract|계약)\b/i,
    // 기간/제한
    /\b(expires|만료|expiry|유효기간|valid until|유효|until|까지|before|전에|within|이내|deadline|마감)\b/i,
    // 가격/비용
    /\b(price|가격|cost|비용|fee|수수료|charge|요금|payment|지불|pricing|요금제)\b/i,
    // 혜택/프로모션
    /\b(benefit|혜택|promotion|프로모션|offer|제안|deal|딜|special|특별|bonus|보너스|reward|보상)\b/i,
  ];
  
  const filtered = boxes.filter(box => {
    // 4자 미만 제외
    if (box.length < 4) return false;
    
    // 제외 패턴에 해당하는 박스 제거
    if (EXCLUDE_PATTERNS.some(pattern => pattern.test(box))) {
      return false;
    }
    
    // 숫자 비율이 너무 높으면 제외 (예: "1234 5678 9012")
    // 완화: 80% 이상인 경우만 제외 (이전: 60%)
    const digitRatio = (box.match(/\d/g) || []).length / box.length;
    if (digitRatio > 0.8) return false;
    
    // 특수문자 비율이 너무 높으면 제외 (예: "!@#$%")
    // 완화: 50% 이상인 경우만 제외 (이전: 30%)
    const specialCharRatio = (box.match(/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/g) || []).length / box.length;
    if (specialCharRatio > 0.5) return false;
    
    // 공백만 있는 경우 제외
    if (!box.replace(/\s+/g, '').trim()) return false;
    
    // 4자 이상이면 유지 (키워드 유무와 관계없이)
    // 의미있는 키워드가 있으면 우선적으로 유지하지만, 키워드가 없어도 4자 이상이면 유지
    return true;
  });
  
  // 필터링된 박스들을 다시 조합 (*로 구분하여 원래 구조 유지)
  return filtered.join('*').trim();
}

/* =========================
   서버 전송 세팅
   ========================= */
const API_BASE = "http://localhost:8000";  // 배포 시 실제 API 주소로 교체
const API_KEY = ""; // server/.env에 API_KEY 설정했다면 동일 값 입력 (없으면 빈 문자열)

async function sendToApi(payload) {
  const headers = { "Content-Type": "application/json" };
  if (API_KEY) headers["x-api-key"] = API_KEY;

  try {
    const res = await fetch(`${API_BASE}/collect`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    });
    
    if (!res.ok) {
      const msg = await res.text().catch(() => "");
      throw new Error(`API error ${res.status}: ${msg}`);
    }
    
    return res.json();
  } catch (error) {
    if (error.name === 'TypeError' && error.message.includes('Failed to fetch')) {
      console.error('[서버 연결 실패]', error);
      throw new Error(`서버에 연결할 수 없습니다. ${API_BASE} 서버가 실행 중인지 확인해주세요.`);
    }
    throw error;
  }
}

/* =========================
   "분석 보기" 버튼 클릭 핸들러
   ========================= */
viewAnalysisBtn?.addEventListener('click', async () => {
  if (!savedDocId) {
    setStatus('⚠️ 저장된 문서 ID가 없습니다.');
    return;
  }

  try {
    const activeTab = await getActiveTab();
    if (!activeTab?.id) {
      setStatus('⚠️ 활성 탭을 찾지 못했습니다.');
      return;
    }

    // 사이드패널 경로 설정
    if (chrome?.sidePanel?.setOptions) {
      await chrome.sidePanel.setOptions({
        tabId: activeTab.id,
        path: `sidepanel_analysis.html?doc=${encodeURIComponent(savedDocId)}`
      });
    }

    // 사이드패널 열기 (사용자 제스처에서 호출되므로 가능)
    if (chrome?.sidePanel?.open) {
      await chrome.sidePanel.open({ tabId: activeTab.id });
      console.log("[사이드패널] 분석 페이지 열기 완료");
      setStatus('✅ 분석 페이지가 열렸습니다.');
    } else {
      setStatus('⚠️ Side Panel API를 지원하지 않습니다.');
    }
  } catch (e) {
    console.error("사이드패널 열기 실패:", e);
    setStatus(`⚠️ 사이드패널 열기 실패: ${e.message}`);
  }
});

/* =========================
   메인 핸들러
   ========================= */
extractBtn.addEventListener('click', async () => {
  if (inFlight) return;        // 중복 클릭 무시
  inFlight = true;
  
  // "분석 보기" 버튼 숨김
  if (viewAnalysisBtn) {
    viewAnalysisBtn.style.display = 'none';
  }
  savedDocId = null;
  
  setStatus('페이지 추출 중...');

  try {
    const tab = await getActiveTab();
    if (!tab?.id) {
      setStatus('활성 탭을 찾지 못했습니다.');
      inFlight = false;
      return;
    }

    console.log('[크롤링 시작] 프레임 추출 중...');
    setStatus('프레임 추출 중...');

    const injectionResults = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: frameExtractorClean
    });

    const frameResults = (injectionResults || [])
      .map(r => r.result)
      .filter(Boolean);

    if (frameResults.length === 0) {
      setStatus('프레임에서 수집된 데이터가 없습니다.');
      inFlight = false;
      return;
    }

    // 모든 프레임의 텍스트를 하나로 합치기 (* 기준으로)
    setStatus('크롤링 중... (텍스트 수집 중)');
    console.log('[크롤링] 프레임별 텍스트 수집 중...');
    
    const allTexts = frameResults
      .map((r, idx) => {
        // 프레임 수집 진행 상황 표시
        setStatus(`크롤링 중... (프레임 ${idx + 1}/${frameResults.length})`);
        console.log(`[크롤링] 프레임 ${idx + 1}/${frameResults.length} 처리`);
        return (r.text || '').trim();
      })
      .filter(Boolean);
    
    const combinedText = allTexts.join('*');
    
    // * 기준으로 문장 단위로 분리 (모든 단어가 다 들어가도록)
    setStatus('크롤링 중... (문장 분리 중)');
    const sentences = combinedText.split(/\*+/).filter(s => s.trim());
    const totalSentences = sentences.length;
    
    console.log(`[크롤링 완료] 총 ${frameResults.length}개 프레임, ${totalSentences}개 문장 발견`);
    
    if (totalSentences === 0) {
      setStatus('수집된 텍스트가 없습니다.');
      inFlight = false;
      return;
    }
    
    setStatus(`크롤링 완료! (${totalSentences}개 문장 발견)`);

    // 다크패턴 전처리 적용 (번역 전에 먼저 적용)
    setStatus('전처리 중... (다크패턴 관련 문장만 필터링)');
    console.log('[전처리] 다크패턴 전처리 시작');
    
    const preprocessedOriginal = preprocessForDarkPattern(combinedText);
    const preprocessedBoxCount = preprocessedOriginal.split(/\*+/).filter(s => s.trim()).length;
    console.log(`[전처리] 원본: ${totalSentences}개 → ${preprocessedBoxCount}개 박스 (필터링 완료)`);
    
    if (preprocessedBoxCount === 0) {
      setStatus('⚠️ 전처리 후 분석 가능한 텍스트가 없습니다.');
      inFlight = false;
      return;
    }

    // 한글 포함 여부 확인 (전처리된 텍스트 기준)
    const hasKorean = containsKorean(preprocessedOriginal);
    let translatedText = preprocessedOriginal;
    
    // 번역 단계 (전처리된 텍스트를 번역)
    if (hasKorean) {
      console.log('[번역 시작] 전처리된 한글 텍스트를 영어로 번역합니다...');
      
      try {
        // 진행 상황 콜백 함수
        const updateTranslationProgress = (current, total) => {
          setStatus(`번역 중... (${current}/${total})`);
          console.log(`[번역 진행] ${current}/${total}`);
        };
        
        translatedText = await translateTextChunked(preprocessedOriginal, updateTranslationProgress);
        console.log('[번역 완료] 모든 텍스트 번역 완료');
        setStatus('번역 완료! 문장 처리 중...');
      } catch (error) {
        console.error('[번역 실패] 원문 사용:', error);
        setStatus('번역 실패. 원문으로 진행합니다...');
        translatedText = preprocessedOriginal; // 번역 실패 시 원문 사용
      }
    } else {
      console.log('[번역] 한글이 없어 번역하지 않습니다.');
    }
    
    // 번역된 텍스트를 * 기준으로 분리
    const processedSentences = translatedText.split(/\*+/).filter(s => s.trim());
    const finalSentenceCount = processedSentences.length;
    
    console.log(`[문장 처리] ${finalSentenceCount}개 문장 처리 완료`);
    
    // 문장 처리 완료 표시
    setStatus(`문장 처리 완료 (${finalSentenceCount}개 문장)`);

    // 최종 텍스트 (모든 문장을 *로 합치기)
    const fullText = processedSentences.join('*');
    
    // 원본 텍스트 (전처리된 원본 텍스트)
    const originalText = preprocessedOriginal;

    // 서버 전송용 JSON 페이로드
    const collectedAt = new Date().toISOString();
    const framesCollected = frameResults.length;

    // frames: 프레임 URL만 배열로 저장
    const frames = frameResults
      .map(r => r.frameUrl)
      .filter(Boolean);

    // 최종 페이로드
    const payload = {
      tabUrl: tab.url || '',
      tabTitle: tab.title || '',
      collectedAt,
      framesCollected,
      fullText,      // 번역된 텍스트 (모든 문장이 *로 구분됨) - 모델링용
      originalText,  // 원본 텍스트 (번역 전 원래 텍스트) - 표시용
      frames         // URL string 배열
    };

    // ====== DB에 저장 ======
    setStatus('DB에 보내는 중...');
    console.log('[DB 전송] 데이터를 DB에 저장 중...');
    
    let apiRes = null;
    try {
      apiRes = await sendToApi(payload);
      console.log("[DB 전송 완료] Saved to Mongo:", apiRes);
      setStatus(`✅ 완료! (${finalSentenceCount}개 문장 처리됨)`);
    } catch (e) {
      console.error("[DB 전송 실패]", e);
      console.warn("API 전송 실패:", e);
      setStatus(`⚠️ 저장 실패: ${e.message}`);
    }

    // === 저장 성공 시 사이드패널 설정 및 "분석 보기" 버튼 표시 ===
    savedDocId = (apiRes && typeof apiRes === 'object' && apiRes.id) ? apiRes.id : null;
    
    if (savedDocId) {
      try {
        // 사이드패널 경로 설정 (사용자가 클릭하면 자동으로 열리도록)
        if (chrome?.sidePanel?.setOptions) {
          const activeTab = await getActiveTab();
          await chrome.sidePanel.setOptions({
            tabId: activeTab.id,
            path: `sidepanel_analysis.html?doc=${encodeURIComponent(savedDocId)}`
          });
          console.log("[사이드패널] 경로 설정 완료 (사용자 클릭 시 자동 열림)");
        }
      } catch (e) {
        console.warn("사이드패널 경로 설정 실패:", e);
      }
      
      // "분석 보기" 버튼 표시
      if (viewAnalysisBtn) {
        viewAnalysisBtn.style.display = 'block';
      }
    } else {
      // 저장 실패 시 버튼 숨김
      if (viewAnalysisBtn) {
        viewAnalysisBtn.style.display = 'none';
      }
    }

  } catch (err) {
    console.error('[오류 발생]', err);
    setStatus(`오류: ${err?.message || err}`);
  } finally {
    inFlight = false;
  }
});
