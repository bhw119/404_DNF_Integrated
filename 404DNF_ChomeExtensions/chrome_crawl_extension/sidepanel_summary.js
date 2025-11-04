/* ============================================
 * Side Panel (Summary)
 * - 서버에서 문서/모델 데이터 조회
 * - 위험지수 계산( model 컬렉션 기반 )
 * - 분석 버킷 집계(높음/중간/낮음/해당안됨)
 * - TOP3 유형 집계(type별 카운트)
 * - UI 바인딩, 새로고침, 탭 이동
 * - 중앙 원 숫자 정렬 보정(CSS 주입)
 * ============================================ */

/* ──[1] 상수/유틸 ───────────────────────────────────────────────────────── */
const API_BASE = "http://localhost:8000";

// ?doc=... 지원: 명시되면 해당 문서, 아니면 현재 탭 URL 기준 최신 문서
const qs = new URLSearchParams(location.search);
const docIdFromQS = qs.get("doc");

// 요소 캐시
const el = {
  status: document.getElementById("status"),
  actionRefresh: document.getElementById("actionRefresh"),
  actionClose: document.getElementById("actionClose"),

  // 요약 섹션
  docId: document.getElementById("docId"),
  pageMeta: document.getElementById("pageMeta"),
  framesCount: document.getElementById("framesCount"),
  framesList: document.getElementById("framesList"),
  textPreview: document.getElementById("textPreview"),
  overallRiskText: document.getElementById("overallRiskText"),
  overallRiskValue: document.getElementById("overallRiskValue"),
  ringCenterLabel: document.querySelector(".ring-center b"),

  // 분석(버킷)
  vizArea: document.getElementById("vizArea"),
  highCount: document.getElementById("highCount"),
  midCount: document.getElementById("midCount"),
  lowCount: document.getElementById("lowCount"),
  noneCount: document.getElementById("noneCount"),
  highOutOf: document.getElementById("highOutOf"),
  midOutOf: document.getElementById("midOutOf"),
  lowOutOf: document.getElementById("lowOutOf"),
  noneOutOf: document.getElementById("noneOutOf"),

  // TOP3 유형
  top1Name: document.getElementById("top1Name"),
  top1Desc: document.getElementById("top1Desc"),
  top1Count: document.getElementById("top1Count"),
  top2Name: document.getElementById("top2Name"),
  top2Desc: document.getElementById("top2Desc"),
  top2Count: document.getElementById("top2Count"),
  top3Name: document.getElementById("top3Name"),
  top3Desc: document.getElementById("top3Desc"),
  top3Count: document.getElementById("top3Count"),
  rank2Card: document.getElementById("rank2Card"),
  rank3Card: document.getElementById("rank3Card"),
};

// 접근성용 상태 텍스트
function setStatus(t) { if (el.status) el.status.textContent = t; }

// 위험도 라벨(텍스트) 매핑
function riskLabel(percent) {
  if (percent >= 76) return "위험";
  if (percent >= 51) return "경고";
  if (percent >= 26) return "주의";
  return "안전";
}

// 라벨별 테마 색상 (rgb 문자열)
const RISK_THEME_RGB = {
  "안전": "16,185,129",  // #10B981
  "주의": "99,102,241",  // #6366F1
  "경고": "245,158,11",  // #F59E0B
  "위험": "239,68,68",   // #EF4444
};

// 라벨에 맞게 CSS 변수(--risk-rgb) 적용 
function applyRiskTheme(label) {
  const rgb = RISK_THEME_RGB[label] || RISK_THEME_RGB["위험"];
  document.documentElement.style.setProperty("--risk-rgb", rgb);
}

// model.id 정규화: 24자리 hex만 추출
function normalizeHexObjectId(v) {
  if (typeof v !== "string") return "";
  const m = v.match(/[a-f0-9]{24}/i);
  return m ? m[0].toLowerCase() : "";
}

// truthy 1/true/"1" 허용
function toBoolDark(v) { return v === true || v === 1 || v === "1"; }

/* 중앙 원 텍스트 완전 중앙 정렬 */
(function injectCenteringCSS() {
  const css = `
    .ring-center { display:flex !important; flex-direction:column; align-items:center; justify-content:center; }
    .ring-center .big { line-height:1; transform: translateY(0); }
  `;
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
})();

/* ──[2] 모델 퍼센트 계산 ───────────────────────────────────────────────── */
async function fetchRiskPercentFromModel(_docId) {
  const docId = normalizeHexObjectId(String(_docId));

  // 1) 서버 요약 API
  try {
    const url = `${API_BASE}/model/summary?id=${encodeURIComponent(docId)}&t=${Date.now()}`;
    const r = await fetch(url, { cache: "no-store" });
    if (r.ok) {
      const j = await r.json();
      if (j && j.ok === true && typeof j.percent === "number") {
        // 서버에서 계산된 퍼센트는 이미 (dark/total * 100)이므로 그대로 사용
        return Math.max(0, Math.min(100, Math.round(j.percent)));
      }
    }
  } catch (_) { /* ignore */ }

  // 2) 폴백: 상세 배열에서 계산 (다크패턴수/전체 * 100)
  const url2 = `${API_BASE}/model?id=${encodeURIComponent(docId)}&t=${Date.now()}`;
  const res = await fetch(url2, { cache: "no-store" });
  if (!res.ok) throw new Error(`model API ${res.status}`);
  const data = await res.json();

  if (Array.isArray(data)) {
    const filtered = data.filter(row => normalizeHexObjectId(row?.id) === docId);
    const total = filtered.length;
    const dark = filtered.filter(row => toBoolDark(row?.is_darkpattern)).length;
    return total > 0 ? Math.round((dark / total) * 100) : 0;
  }
  if (data && typeof data === "object") {
    const total = Number(data.total ?? 0);
    const dark = Number(data.dark ?? data.darkCount ?? 0);
    return total > 0 ? Math.round((dark / total) * 100) : 0;
  }
  return 0;
}

/* ──[3] 모델 버킷 집계 ─────────────────────────────────────────────────── */
async function fetchBucketsFromModel(_docId) {
  const docId = normalizeHexObjectId(String(_docId));
  const url = `${API_BASE}/model?id=${encodeURIComponent(docId)}&t=${Date.now()}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`model API ${res.status}`);
  const data = await res.json();

  let high = 0, mid = 0, low = 0, none = 0;
  let total = 0;  // 전체 개수 계산

  if (Array.isArray(data)) {
    const rows = data.filter(row => normalizeHexObjectId(row?.id) === docId);
    total = rows.length;

    for (const row of rows) {
      const isDark = toBoolDark(row?.is_darkpattern);
      const prob = Number(row?.probability ?? row?.prob ?? row?.score ?? 0);

      if (isDark) {
        if (prob >= 71 && prob <= 100) high++;
        else if (prob >= 31 && prob <= 70) mid++;
        else if (prob >= 1 && prob <= 30) low++;
      } else {
        none++;
      }
    }
  }
  return { high, mid, low, none, total };
}

/* ──[4] TOP3 유형 집계 ─────────────────────────────────────────────────── */
const TYPE_DESC_MAP = {
  "Urgency": "제한된 시간 내에 행동을 강요함으로써 사용자가 충분한 정보 없이 의사결정을 내리게 함",
  "Misdirection": "시각적 강조, 언어트릭 등으로 사용자의 관심을 다른 곳으로 돌려 의도와 다른 행동을 유도",
  "Social Proof": "타인의 행동이나 평가를 조작하여 다수가 선택했다는 착각을 유도함",
  "Scarcity": "상품이 곧 없어질 것 같은 인상을 주어 충동구매를 유도",
};

async function fetchTopTypesFromModel(_docId) {
  const docId = normalizeHexObjectId(String(_docId));
  const url = `${API_BASE}/model?id=${encodeURIComponent(docId)}&t=${Date.now()}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`model API ${res.status}`);
  const data = await res.json();

  const counter = new Map(); // type -> count

  if (Array.isArray(data)) {
    const rows = data.filter(row => normalizeHexObjectId(row?.id) === docId && toBoolDark(row?.is_darkpattern));
    for (const row of rows) {
      const type = String(row?.type ?? "Unknown").trim();
      if (!counter.has(type)) counter.set(type, 0);
      counter.set(type, counter.get(type) + 1);
    }
  }

  // 내림차순 정렬 후 상위 3개
  const sorted = Array.from(counter.entries())
    .sort((a,b) => b[1] - a[1])
    .slice(0, 3)
    .map(([type, count]) => ({ type, count, desc: TYPE_DESC_MAP[type] ?? "-" }));

  return sorted; // [{type, count, desc}, ...]
}

function bindTop3(sorted) {
  // 초기화/숨김 처리
  const fill = (i, item) => {
    if (i === 0) {
      if (item) {
        el.top1Name.textContent = item.type;
        el.top1Desc.textContent = item.desc;
        el.top1Count.textContent = String(item.count);
      } else {
        el.top1Name.textContent = "-"; el.top1Desc.textContent = "-"; el.top1Count.textContent = "0";
      }
    } else if (i === 1) {
      if (item) {
        el.top2Name.textContent = item.type;
        el.top2Desc.textContent = item.desc;
        el.top2Count.textContent = String(item.count);
        el.rank2Card.style.display = "";
      } else if (el.rank2Card) el.rank2Card.style.display = "none";
    } else if (i === 2) {
      if (item) {
        el.top3Name.textContent = item.type;
        el.top3Desc.textContent = item.desc;
        el.top3Count.textContent = String(item.count);
        el.rank3Card.style.display = "";
      } else if (el.rank3Card) el.rank3Card.style.display = "none";
    }
  };

  fill(0, sorted[0]);
  fill(1, sorted[1]);
  fill(2, sorted[2]);
}

/* ──[5] 문서 가져오기 + 바인딩 ──────────────────────────────────────────── */
async function fetchDoc({ bustCache = false } = {}) {
  try {
    setStatus("서버에서 데이터를 불러오는 중…");

    // 요청 URL 결정
    let url;
    if (docIdFromQS) {
      url = `${API_BASE}/doc/${encodeURIComponent(docIdFromQS)}`;
    } else {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabUrl = encodeURIComponent(tab?.url || "");
      url = `${API_BASE}/latest?tabUrl=${tabUrl}`;
    }
    if (bustCache) url += (url.includes("?") ? "&" : "?") + `t=${Date.now()}`;

    // 문서 조회
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`API ${res.status}`);
    const payload = await res.json();
    const d = payload?.doc || payload;
    if (!d || !d._id) { setStatus("문서를 찾지 못했습니다."); return; }

    // 메타/요약 바인딩
    if (el.docId) el.docId.textContent = d._id;
    if (el.pageMeta) el.pageMeta.textContent = `${d.tabTitle || "(제목 없음)"} — ${d.tabUrl}`;
    if (el.framesCount) el.framesCount.textContent = String(d.framesCollected ?? (d.frames?.length || 0));
    if (el.framesList) el.framesList.textContent = (d.frames || []).join("\n");
    if (el.textPreview) el.textPreview.textContent = (d.fullText || "").slice(0, 1000) || "(본문 없음)";

    // 분석 버킷 집계 (먼저 실행하여 total을 얻음)
    let buckets = { high: 0, mid: 0, low: 0, none: 0, total: 0 };
    try {
      buckets = await fetchBucketsFromModel(d._id);
      if (el.highCount) el.highCount.textContent = String(buckets.high);
      if (el.midCount) el.midCount.textContent = String(buckets.mid);
      if (el.lowCount) el.lowCount.textContent = String(buckets.low);
      if (el.noneCount) el.noneCount.textContent = String(buckets.none);
      
      // 전체 개수 동적 업데이트
      const total = buckets.total || 0;
      if (el.highOutOf) el.highOutOf.textContent = `/${total}`;
      if (el.midOutOf) el.midOutOf.textContent = `/${total}`;
      if (el.lowOutOf) el.lowOutOf.textContent = `/${total}`;
      if (el.noneOutOf) el.noneOutOf.textContent = `/${total}`;
    } catch (err) { console.warn("버킷 집계 실패:", err); }

    // 위험지수 계산 (다크패턴수/전체 * 100)
    let percent = 0;
    try {
      // 버킷에서 다크패턴 개수와 전체 개수를 사용하여 계산
      const darkCount = buckets.high + buckets.mid + buckets.low;
      const total = buckets.total || 0;
      if (total > 0) {
        percent = Math.round((darkCount / total) * 100);
      } else {
        // 폴백: 서버 API 사용
        percent = await fetchRiskPercentFromModel(d._id);
      }
    } catch (err) {
      console.warn("model 퍼센트 계산 실패 → d.overallRiskPercent 폴백 시도:", err);
      if (typeof d.overallRiskPercent === "number") percent = d.overallRiskPercent;
    }
    percent = Math.max(0, Math.min(100, Math.round(percent)));

    // UI 반영(요약 게이지)
    const label = riskLabel(percent);
    applyRiskTheme(label);
    if (el.overallRiskText) el.overallRiskText.textContent = `${percent}%`;
    if (el.overallRiskValue) el.overallRiskValue.textContent = `${percent}%`;
    if (el.ringCenterLabel) el.ringCenterLabel.textContent = label;

    // TOP3 유형 집계/바인딩
    try {
      const top3 = await fetchTopTypesFromModel(d._id);
      bindTop3(top3);
    } catch (err) {
      console.warn("TOP3 집계 실패:", err);
      bindTop3([]); // 초기화
    }

    setStatus("불러오기 완료");
  } catch (e) {
    console.error(e);
    setStatus(`불러오기 실패: ${e?.message || e}`);
  }
}

/* ──[6] 상단 아이콘 동작 ──────────────────────────────────────────────── */
el.actionRefresh?.addEventListener("click", () => { fetchDoc({ bustCache: true }); });
el.actionClose?.addEventListener("click", () => {
  try { chrome.runtime.sendMessage?.({ type: "close-sidepanel" }); } catch (_) {}
  try { window.close(); } catch (_) {}
});

/* ──[7] 탭 내비게이션 ─────────────────────────────────────────────────── */
function buildHref(base) {
  const u = new URL(base, location.href);
  if (docIdFromQS) u.searchParams.set("doc", docIdFromQS);
  return u.toString();
}
document.getElementById("tabAnalysis")?.addEventListener("click", (ev) => {
  ev.preventDefault();
  location.href = buildHref("sidepanel_analysis.html");
});
document.querySelectorAll(".tab").forEach((btn) => {
  if (btn.id === "tabAnalysis") return;
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((b) => {
      if (b.id !== "tabAnalysis") {
        b.classList.toggle("active", b === btn);
        b.setAttribute("aria-selected", b === btn ? "true" : "false");
      }
    });
    const id = btn.getAttribute("data-to");
    const section = document.getElementById(id);
    if (section) section.scrollIntoView({ behavior: "smooth", block: "start" });
  });
});

/* ──[8] 초기 로드 ─────────────────────────────────────────────────────── */
fetchDoc();  // 최초 1회 로드
