/** ============================================
 *  Side Panel – 분석 전용
 *  - 탭 링크(요약/분석 이동)
 *  - 서버에서 문장 단위 분석 로드 → 카드 렌더
 *  - 비어 있으면: fullText에서 문장 4개 랜덤 생성(확률/유형/세부유형 랜덤)
 *  - 필터(전체/높음/중간/낮음)
 *  - 위치보기: 현재 탭 content script에 하이라이트 요청
 *  - 웹사이트 이동: www.kw.ac.kr 로 고정 이동
 * ============================================ */

const API_BASE = "http://localhost:8000";

const qs = new URLSearchParams(location.search);
const docId = qs.get("doc");

const SUMMARY_HTML = "sidepanel_summary.html";
const LAW_HTML = "sidepanel_law.html";

/** --------- 엘리먼트 캐시 ---------- */
const el = {
  status: document.getElementById("status"),
  actionRefresh: document.getElementById("actionRefresh"),
  actionClose: document.getElementById("actionClose"),

  tabSummary: document.getElementById("tabSummary"),
  tabLaw: document.getElementById("tabLaw"),

  chipAll: document.getElementById("chipAll"),
  chipHigh: document.getElementById("chipHigh"),
  chipMid: document.getElementById("chipMid"),
  chipLow: document.getElementById("chipLow"),

  countAll: document.getElementById("countAll"),
  countHigh: document.getElementById("countHigh"),
  countMid: document.getElementById("countMid"),
  countLow: document.getElementById("countLow"),

  list: document.getElementById("list"),
  empty: document.getElementById("empty"),
  emptyMessage: document.getElementById("emptyMessage"),
  progressInfo: document.getElementById("progressInfo"),
  sectionTitle: document.getElementById("sectionTitle"),
  sectionSubtitle: document.getElementById("sectionSubtitle"),

  jumpGo: document.getElementById("jumpGo"),
};

/** --------- 상태 ---------- */
const state = {
  items: /** @type {Array<AnalysisItem>} */ ([]),
  filter: /** 'all' | 'high' | 'mid' | 'low' */ ('all'),
  modelProgress: /** @type {{status: string, current: number, total: number} | null} */ (null),
};

/** @typedef {{
 *   text: string,
 *   probability?: number,          // 0~1 (또는 0~100)
 *   score?: number,
 *   label?: string,                // 예: "Urgency"
 *   subtype?: string,              // 예: "Countdown Timers"
 *   frameIndex?: number,
 *   range?: { start?: number, end?: number },
 *   meta?: any
 * }} AnalysisItem */

/** --------- 유틸 ---------- */
function setStatus(t) { if (el.status) el.status.textContent = t; }

function toPercentAndSeverity(item) {
  let p = 0;
  if (typeof item.probability === "number") {
    p = item.probability <= 1 ? Math.round(item.probability * 100) : Math.round(item.probability);
  } else if (typeof item.score === "number") {
    p = item.score <= 1 ? Math.round(item.score * 100) : Math.round(item.score);
  }
  p = Math.max(0, Math.min(100, p));

  let sev = "low";
  if (p >= 71) sev = "high";
  else if (p >= 31) sev = "mid";
  else if (p === 0) sev = "none";
  return { percent: p, severity: sev };
}

function escapeHTML(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function sampleWithoutReplacement(arr, n) {
  const a = arr.slice();
  const out = [];
  while (a.length && out.length < n) {
    const i = Math.floor(Math.random() * a.length);
    out.push(a.splice(i, 1)[0]);
  }
  return out;
}

function randomInt(min, max) { // inclusive
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** 랜덤 항목 생성용: 유형 → 세부유형 매핑 */
const TYPE_SUBTYPES = {
  "Urgency": ["Countdown Timers", "Limited-time Messages"],
  "Misdirection": ["Confirmshaming", "Trick Questions", "Pressured Selling"],
  "Social Proof": ["Activity Notifications", "Testimonials of Uncertain Origin"],
  "Scarcity": ["Low-stock Message", "High-demand Messages"],
};

function randomTypeAndSubtype() {
  const types = Object.keys(TYPE_SUBTYPES);
  const type = types[Math.floor(Math.random() * types.length)];
  const subs = TYPE_SUBTYPES[type];
  const subtype = subs[Math.floor(Math.random() * subs.length)];
  return { type, subtype };
}

function randomSeverityPercent() {
  const sev = ["high","mid","low"][Math.floor(Math.random()*3)];
  let percent = 0;
  if (sev === "high") percent = randomInt(91, 100);
  else if (sev === "mid") percent = randomInt(31, 70);
  else percent = randomInt(1, 30);
  return { sev, percent };
}

/** fullText → 임의 4문장 카드 생성 (비활성화 - 버그 방지) */
function buildItemsFromFullText(fullText) {
  // 이 함수는 더 이상 사용하지 않습니다.
  // 모델 결과가 없으면 빈 배열을 반환하여 fullText가 다크패턴으로 표시되는 버그 방지
  console.warn('[사용되지 않는 함수] buildItemsFromFullText는 더 이상 사용되지 않습니다.');
  return [];
}

/** --------- 데이터 로드 ---------- */
async function fetchDocForAnalysis() {
  try {
    setStatus("서버에서 데이터를 불러오는 중…");

    let url;
    if (docId) {
      url = `${API_BASE}/doc/${encodeURIComponent(docId)}`;
    } else {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabUrl = encodeURIComponent(tab?.url || "");
      url = `${API_BASE}/latest?tabUrl=${tabUrl}`;
    }

    const res = await fetch(url);
    if (!res.ok) throw new Error(`API ${res.status}`);
    const payload = await res.json();

    const d = payload?.doc || payload;

    // 모델링 진행 상황 확인
    let modelingStatus = d?.modelingStatus || 'pending';
    
    // 모델링이 진행 중이면 아무것도 표시하지 않음
    if (modelingStatus === 'processing') {
      state.items = [];
      renderCounts();
      renderList();
      setStatus("모델 분석이 진행 중입니다. 잠시만 기다려주세요...");
      return;
    }

    // 모델 결과를 /model API에서 가져오기
    let modelResults = [];
    try {
      const modelRes = await fetch(`${API_BASE}/model?id=${encodeURIComponent(d._id)}`);
      if (modelRes.ok) {
        modelResults = await modelRes.json();
      }
    } catch (e) {
      console.warn('모델 결과 조회 실패:', e);
    }

    // 모델 결과를 AnalysisItem 형식으로 변환
    // 중요: 모델링이 완료된 경우에만 결과를 표시
    if (modelingStatus === 'completed') {
      if (Array.isArray(modelResults) && modelResults.length > 0) {
        // 다크패턴만 필터링하고 표시
        const darkPatternItems = modelResults.filter(item => {
          // is_darkpattern이 1 또는 true인 경우만 필터링
          const isDark = item.is_darkpattern === 1 || item.is_darkpattern === true;
          // string은 원본 텍스트 (표시용), translatedString은 번역된 텍스트 (모델링용)
          // 원본 텍스트만 사용 (string 필드)
          const text = String(item.string ?? "");
          return isDark && text.length < 500; // 500자 이상이면 제외 (버그 방지)
        });
        
        if (darkPatternItems.length > 0) {
          state.items = darkPatternItems.map((it) => {
            // 원본 텍스트만 사용 (string 필드에 원본이 저장됨)
            // string이 원본 텍스트, translatedString은 번역된 텍스트 (사용하지 않음)
            const text = String(it.string ?? "");
            // 텍스트가 너무 길면 잘라서 표시 (버그 방지)
            const displayText = text.length > 500 ? text.substring(0, 500) + "..." : text;
            
            return {
              text: displayText,
              probability: typeof it.probability === "number" ? it.probability : undefined,
              label: it.type ?? "",
              subtype: it.predicate ?? "",
              meta: it,
            };
          });
        } else {
          // 모델 결과는 있지만 다크패턴이 없는 경우
          state.items = [];
        }
      } else {
        // 모델링이 완료되었지만 결과가 없는 경우
        state.items = [];
      }
    } else {
      // 모델링이 진행 중이거나 대기 중인 경우 - 아무것도 표시하지 않음
      state.items = [];
    }

    // fullText fallback 완전 제거 (버그 방지)
    // 모델 결과가 없으면 빈 배열로 표시

    renderCounts();
    renderList();
    setStatus("불러오기 완료");
  } catch (e) {
    console.error(e);
    setStatus(`불러오기 실패: ${e?.message || e}`);
    // 실패 시에도 완전 빈 화면 방지: 아무것도 못 받았으면 대체 없음 유지
    state.items = [];
    renderCounts();
    renderList();
  }
}

/** --------- 카운트/필터 렌더 ---------- */
function renderCounts() {
  let high=0, mid=0, low=0;
  for (const it of state.items) {
    const { severity } = toPercentAndSeverity(it);
    if (severity === "high") high++;
    else if (severity === "mid") mid++;
    else if (severity === "low") low++;
  }
  const all = high + mid + low;
  if (el.countAll)  el.countAll.textContent  = String(all);
  if (el.countHigh) el.countHigh.textContent = String(high);
  if (el.countMid)  el.countMid.textContent  = String(mid);
  if (el.countLow)  el.countLow.textContent  = String(low);
}

/** --------- 리스트 렌더 ---------- */
function renderList() {
  if (!el.list || !el.empty) return;
  el.list.innerHTML = "";

  const filtered = state.items.filter((it) => {
    const { severity } = toPercentAndSeverity(it);
    if (severity === "none") return false;
    if (state.filter === "all") return true;
    return severity === state.filter;
  });

  if (filtered.length === 0) {
    el.empty.classList.remove("hidden");
    
    // 모델 분석 중일 때 진행상황 표시
    if (state.modelProgress && state.modelProgress.status === 'processing') {
      const { current, total } = state.modelProgress;
      const percent = total > 0 ? Math.round((current / total) * 100) : 0;
      
      if (el.emptyMessage) {
        el.emptyMessage.textContent = "모델 분석 진행 중입니다...";
      }
      
      if (el.progressInfo) {
        el.progressInfo.style.display = "block";
        el.progressInfo.innerHTML = `
          <div style="display: flex; align-items: center; gap: 12px; justify-content: center;">
            <div style="flex: 1; max-width: 300px;">
              <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                <div style="flex: 1; background: #e5e7eb; border-radius: 999px; height: 8px; overflow: hidden;">
                  <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); height: 100%; width: ${percent}%; transition: width 0.3s ease;"></div>
                </div>
                <div style="font-weight: 700; font-size: 14px; color: #111827; min-width: 70px;">
                  ${current}/${total}
                </div>
              </div>
              <div style="font-size: 12px; color: #6b7280; text-align: center;">
                ${percent}% 완료
              </div>
            </div>
          </div>
        `;
      }
    } else {
      // 모델 분석 중이 아닐 때 기본 메시지
      if (el.emptyMessage) {
        el.emptyMessage.textContent = "표시할 항목이 없습니다.";
      }
      if (el.progressInfo) {
        el.progressInfo.style.display = "none";
      }
    }
    return;
  }
  el.empty.classList.add("hidden");

  filtered.forEach((it) => {
    const { percent, severity } = toPercentAndSeverity(it);
    const sevText = severity === "high" ? "높음" : severity === "mid" ? "중간" : "낮음";
    const badgeClass = severity === "high" ? "high" : severity === "mid" ? "mid" : "low";

    const card = document.createElement("div");
    card.className = "item";

    card.innerHTML = `
      <div class="toprow">
        <div class="scoreline"><b>${percent}%</b> 다크패턴입니다.</div>
        <button class="pill-locate" title="위치보기">위치보기</button>
      </div>

      <div class="sentence">${escapeHTML(it.text || "(문장 없음)")}</div>
      <div class="divider"></div>

      <div class="subhead">분석내용</div>
      <div class="kv">
        <div class="kv-row">
          <div class="kname">다크패턴 확률</div>
          <div class="kval"><span class="badge ${badgeClass}">${sevText}</span></div>
        </div>
        <div class="kv-row">
          <div class="kname">다크패턴 유형</div>
          <div class="kval"><span class="chip-outline">${escapeHTML(it.label || "-")}</span></div>
        </div>
        <div class="kv-row">
          <div class="kname">세부유형</div>
          <div class="kval"><span class="chip-outline">${escapeHTML(it.subtype || "-")}</span></div>
        </div>
      </div>
    `;

    // 위치보기: 현재 탭에 하이라이트 지시(가능하면 range/frameIndex 사용)
    card.querySelector(".pill-locate")?.addEventListener("click", async () => {
      try {
        const msg = {
          type: "highlight-in-page",
          payload: { text: it.text, range: it.range, frameIndex: it.frameIndex, docId }
        };
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id) await chrome.tabs.sendMessage(tab.id, msg);
      } catch (e) {
        console.warn("위치보기 전송 실패", e);
      }
    });

    el.list.appendChild(card);
  });
}

/** --------- 필터 칩 ---------- */
function setFilter(next) {
  state.filter = next;
  [el.chipAll, el.chipHigh, el.chipMid, el.chipLow].forEach(c => c?.classList.remove("active"));
  if (next === "all") el.chipAll?.classList.add("active");
  if (next === "high") el.chipHigh?.classList.add("active");
  if (next === "mid") el.chipMid?.classList.add("active");
  if (next === "low") el.chipLow?.classList.add("active");
  renderList();
}
el.chipAll?.addEventListener("click", () => setFilter("all"));
el.chipHigh?.addEventListener("click", () => setFilter("high"));
el.chipMid?.addEventListener("click", () => setFilter("mid"));
el.chipLow?.addEventListener("click", () => setFilter("low"));

/** --------- 헤더 아이콘 ---------- */
el.actionRefresh?.addEventListener("click", () => {
  fetchDocForAnalysis();
  if (docId) {
    checkModelProgress();
  }
});
el.actionClose?.addEventListener("click", () => {
  if (progressInterval) {
    clearInterval(progressInterval);
    progressInterval = null;
  }
  try { chrome.runtime.sendMessage?.({ type: "close-sidepanel" }); } catch (_) {}
  try { window.close(); } catch (_) {}
});

/** --------- 탭 이동(파일 분리) ---------- */
function buildHref(base) {
  const u = new URL(base, location.href);
  if (docId) u.searchParams.set("doc", docId);
  return u.toString();
}
if (el.tabSummary) {
  el.tabSummary.href = buildHref(SUMMARY_HTML);
  el.tabSummary.addEventListener("click", (e) => { e.preventDefault(); location.href = buildHref(SUMMARY_HTML); });
}
if (el.tabLaw) {
  el.tabLaw.href = buildHref(LAW_HTML);
  el.tabLaw.addEventListener("click", (e) => { e.preventDefault(); location.href = buildHref(LAW_HTML); });
}

/** --------- 웹사이트 고정 이동 ---------- */
async function jumpToKw() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) await chrome.tabs.update(tab.id, { url: "https://www.kw.ac.kr" });
  } catch (e) {
    console.warn("탭 이동 실패:", e);
  }
}
el.jumpGo?.addEventListener("click", jumpToKw);

/** --------- 모델 진행 상황 표시 ---------- */
let progressInterval = null;

function showModelProgress(progress) {
  const { status, progress: prog, error } = progress;
  const current = prog?.current || 0;
  const total = prog?.total || 0;
  const percent = total > 0 ? Math.round((current / total) * 100) : 0;

  // 상태 업데이트
  state.modelProgress = {
    status,
    current,
    total
  };

  // 섹션 제목과 부제목 업데이트
  if (el.sectionTitle) {
    if (status === 'processing') {
      el.sectionTitle.textContent = '모델이 분석 중입니다..';
    } else if (status === 'completed') {
      el.sectionTitle.textContent = '분석 결과';
    } else if (status === 'failed') {
      el.sectionTitle.textContent = '분석 실패';
    } else {
      el.sectionTitle.textContent = '분석 결과';
    }
  }

  if (el.sectionSubtitle) {
    if (status === 'processing') {
      el.sectionSubtitle.textContent = `진행 중 (${current}/${total})`;
    } else if (status === 'completed') {
      el.sectionSubtitle.textContent = '다크패턴이 탐지된 문장입니다';
    } else if (status === 'failed') {
      el.sectionSubtitle.textContent = error || '분석 중 오류가 발생했습니다';
    } else {
      el.sectionSubtitle.textContent = '다크패턴이 탐지된 문장입니다';
    }
  }
  
  // 상단 고정 진행 상황 바 제거 (디자인상 별로라서 삭제)
  let progressEl = document.getElementById('modelProgress');
  if (progressEl) {
    progressEl.remove();
  }
  
  if (status === 'processing') {
    // 진행 중일 때는 결과를 표시하지 않도록 빈 배열로 설정
    state.items = [];
    renderCounts();
    renderList();
  } else if (status === 'completed') {
    // 상태 초기화
    state.modelProgress = null;
    // 모델링이 완료되었으므로 결과 로드
    fetchDocForAnalysis();
    if (progressInterval) {
      clearInterval(progressInterval);
      progressInterval = null;
    }
  } else if (status === 'failed') {
    // 상태 초기화
    state.modelProgress = null;
    if (progressInterval) {
      clearInterval(progressInterval);
      progressInterval = null;
    }
  } else {
    // pending 상태 - 아무것도 표시하지 않음
    state.items = [];
    state.modelProgress = null;
    renderCounts();
    renderList();
  }
}

async function checkModelProgress() {
  if (!docId) return;
  
  try {
    const res = await fetch(`${API_BASE}/model/progress/${encodeURIComponent(docId)}`);
    if (!res.ok) return;
    
    const data = await res.json();
    if (data.ok && data.progress) {
      showModelProgress(data.progress);
      
      // 완료되면 polling 중지
      if (data.progress.status === 'completed' || data.progress.status === 'failed') {
        if (progressInterval) {
          clearInterval(progressInterval);
          progressInterval = null;
        }
      }
    }
  } catch (e) {
    console.warn('진행 상황 확인 실패:', e);
  }
}

/** --------- 시작 ---------- */
// 문서 ID가 있으면 진행 상황 확인 시작
if (docId) {
  // 초기 상태: 빈 배열로 시작 (버그 방지)
  state.items = [];
  renderCounts();
  renderList();
  
  // 즉시 한 번 확인
  checkModelProgress();
  // 1초마다 진행 상황 확인
  progressInterval = setInterval(checkModelProgress, 1000);
  
  // 진행 상황 확인 후 모델링 상태에 따라 데이터 로드
  // 모델링이 완료된 경우에만 데이터 로드
  setTimeout(async () => {
    try {
      const res = await fetch(`${API_BASE}/model/progress/${encodeURIComponent(docId)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.ok && data.progress) {
          // 모델링이 완료되었거나 실패한 경우에만 데이터 로드
          if (data.progress.status === 'completed' || data.progress.status === 'failed') {
            fetchDocForAnalysis();
          }
          // processing이나 pending 상태일 때는 아무것도 로드하지 않음
        } else {
          // 진행 상황 정보가 없으면 모델링 완료 여부 확인 후 로드
          // 모델링이 완료되지 않았을 수 있으므로 로드하지 않음
        }
      }
      // res.ok가 false인 경우도 로드하지 않음 (버그 방지)
    } catch (e) {
      // 진행 상황 확인 실패 시에도 로드하지 않음 (버그 방지)
      console.warn('진행 상황 확인 실패, 데이터 로드 건너뜀:', e);
    }
  }, 500);
} else {
  // 문서 ID가 없으면 바로 데이터 로드
  fetchDocForAnalysis();
}
