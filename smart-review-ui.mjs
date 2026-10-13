import { evaluateAchievement, SMART_REVIEW_CONFIG } from "./smart-review-engine.mjs";

const STORAGE_KEY = "nusmedicine-smart-review-history-v1";
const FIELD_KEYS = ["title","category","start","end","description","award","appointment","organisation","participationLevel","evidence"];
const CLARIFICATION_QUESTIONS = {
  TITLE_MISSING: "What is a short, recognisable title for this experience?",
  ACTIVITY_CONTEXT_MISSING: "What did the activity involve?",
  BACKGROUND_MISSING: "What was the context or audience?",
  TIME_RANGE_UNCLEAR: "When did the activity start and end?",
  DATE_CONTRADICTION_NEEDS_CLARIFICATION: "Please clarify the start and end dates before relying on this review.",
  ROLE_ONLY: "What were you personally responsible for?",
  PERSONAL_ACTION_MISSING: "What specific action did you take?",
  SUBJECT_UNCLEAR: "Was this action yours or someone else's?",
  RESPONSIBILITY_SCOPE_UNCLEAR: "Which parts did you own versus the team?",
  OUTCOME_CONTEXT_MISSING: "What result or output followed?",
  OUTCOME_SCOPE_UNCLEAR: "Who or what was affected, and to what extent?",
  METRIC_CONTEXT_MAY_BE_NEEDED: "What are the baseline, measure and scope for this number?",
  REFLECTION_GENERIC: "What specifically did you learn?",
  GROWTH_CHANGE_MISSING: "What changed in your approach or judgement?",
  APPLICATION_MISSING: "How did you apply this learning afterwards?",
  EVIDENCE_ROUTE_MISSING: "What record or source could support this experience?",
  ATTACHMENT_NOT_AUTHENTICITY_VERIFIED: "What claim does this attachment support? Its authenticity has not been verified by the app."
};
const DIMENSION_LABELS = {
  contentCompleteness: "Content completeness",
  personalContribution: "Personal contribution",
  outcomesAndImpact: "Outcomes and impact",
  reflectionAndGrowth: "Reflection and growth",
  evidenceAndVerifiability: "Evidence and verifiability"
};
const $ = (id) => document.getElementById(id);
const safeString = (v) => String(v ?? "").normalize("NFKC").trim();

function readPlanner() {
  try {
    const saved = JSON.parse(localStorage.getItem("nusmedicine-top10-v1") || "{}");
    return Array.isArray(saved.data) ? saved.data : Array.from({length:10}, () => ({}));
  } catch {
    return Array.from({length:10}, () => ({}));
  }
}
function readHistory() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}
function snapshotOf(entry) {
  return {
    ...Object.fromEntries(FIELD_KEYS.map(k => [k, safeString(entry?.[k])])),
    attachments: (Array.isArray(entry?.attachments) ? entry.attachments : []).map(a => ({
      id: safeString(a?.id), name: safeString(a?.name), type: safeString(a?.type),
      size: Number.isFinite(a?.size) ? a.size : null
    }))
  };
}
function sameSnapshot(a,b) {
  return JSON.stringify(a) === JSON.stringify(b);
}
function id() {
  return globalThis.crypto?.randomUUID?.() || ("review-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2));
}
function persistHistory(next) {
  const serialized = JSON.stringify(next);
  localStorage.setItem(STORAGE_KEY, serialized);
}
function updateStaleFlags() {
  const current = readPlanner();
  const history = readHistory();
  let changed = false;
  const next = history.map(record => {
    const latestEntry = current[record.entryIndex] || {};
    const stale = !sameSnapshot(snapshotOf(latestEntry), record.inputSnapshot);
    if (record.stale !== stale) changed = true;
    return stale === record.stale ? record : {...record, stale};
  });
  if (changed) {
    try { persistHistory(next); }
    catch { showMessage("Could not update review-history status. Your saved reviews have not been overwritten.", true); }
  }
  return next;
}
function showMessage(message, isError = false) {
  const el = $("srMessage");
  if (!el) return;
  el.textContent = message;
  el.className = "sr-message" + (isError ? " is-error" : "");
}
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[ch]));
}
function dimensionHtml(key, dimension) {
  const score = dimension.status === "scored" ? `${dimension.score}/4` : dimension.status === "needs-info" ? "Needs information" : dimension.status;
  const rules = dimension.matchedRules?.length ? `<div class="sr-meta"><strong>Rules:</strong> ${escapeHtml(dimension.matchedRules.join(", "))}</div>` : "";
  const reasons = dimension.reasonCodes?.length ? `<div class="sr-meta"><strong>Reasons:</strong> ${escapeHtml(dimension.reasonCodes.join(", "))}</div>` : "";
  const suggestions = dimension.suggestions?.length ? `<ul>${dimension.suggestions.map(s => `<li>${escapeHtml(s)}</li>`).join("")}</ul>` : "";
  const codes = [...(dimension.reasonCodes || []), ...(dimension.missingRules || [])];
  const questions = [...new Set(codes.map(code => CLARIFICATION_QUESTIONS[code] || ({
    "D1-01":"What is a short, recognisable title for this experience?",
    "D1-02":"What did the activity involve?",
    "D1-03":"What was the context or audience?",
    "D1-05":"When did the activity start and end?"
  })[code]).filter(Boolean))];
  const questionHtml = questions.length ? `<div class="sr-clarification"><strong>Clarifying question:</strong><ul>${questions.map(q => `<li>${escapeHtml(q)}</li>`).join("")}</ul></div>` : "";
  return `<div class="sr-dimension"><div class="sr-dimension-head"><strong>${escapeHtml(DIMENSION_LABELS[key] || key)}</strong><span>${escapeHtml(score)}</span></div>${rules}${reasons}${questionHtml}${suggestions}</div>`;
}
function renderHistory() {
  const host = $("srResults");
  if (!host) return;
  const history = updateStaleFlags();
  if (!history.length) {
    host.innerHTML = '<p class="sr-empty">No reviews saved yet. Select “Review all entries” to assess non-empty entries.</p>';
    return;
  }
  const latest = new Map();
  history.forEach(record => {
    const prev = latest.get(record.achievementId);
    if (!prev || prev.reviewedAt < record.reviewedAt) latest.set(record.achievementId, record);
  });
  host.innerHTML = [...latest.values()].sort((a,b)=>a.entryIndex-b.entryIndex).map(record => {
    const status = record.status === "completed" ? "Completed" : record.status === "partial" ? "Needs follow-up" : record.status === "error" ? "Error" : "Empty";
    const total = record.totalScore === null ? "Total unavailable" : `${record.totalScore}/20`;
    const stale = record.stale ? '<span class="sr-stale">Content changed since this review</span>' : "";
    const dimensions = Object.entries(record.scores || {}).map(([key,value])=>dimensionHtml(key,value)).join("");
    return `<article class="sr-result"><div class="sr-result-head"><div><h3>Achievement ${record.entryIndex + 1}: ${escapeHtml(record.inputSnapshot.title || "Untitled entry")}</h3><p>${escapeHtml(status)} · ${escapeHtml(total)} · ${escapeHtml(new Date(record.reviewedAt).toLocaleString())}</p></div>${stale}</div><div class="sr-dimensions">${dimensions}</div><details><summary>Review trace</summary><p class="sr-meta">Review ID: ${escapeHtml(record.reviewId)}</p><p class="sr-meta">Rubric ${escapeHtml(record.rubricVersion)} · Rules ${escapeHtml(record.ruleSetVersion)} · Engine ${escapeHtml(record.engineVersion)}</p><p class="sr-meta">Previous review: ${escapeHtml(record.previousReviewId || "None")}</p><pre>${escapeHtml(JSON.stringify(record.inputSnapshot,null,2))}</pre></details></article>`;
  }).join("");
}
function reviewAll() {
  const entries = readPlanner();
  const oldHistory = readHistory();
  const nextHistory = [...oldHistory];
  let assessed = 0;
  try {
    entries.forEach((entry, index) => {
      const result = evaluateAchievement(entry);
      if (result.status === "empty") return;
      const achievementId = `entry-${index + 1}`;
      const previous = oldHistory.filter(r => r.achievementId === achievementId).sort((a,b)=>b.reviewedAt.localeCompare(a.reviewedAt))[0];
      nextHistory.push({
        reviewId: id(),
        achievementId,
        entryIndex: index,
        contentRevision: String(oldHistory.filter(r=>r.achievementId===achievementId).length + 1),
        rubricVersion: result.reviewMeta.rubricVersion,
        ruleSetVersion: result.reviewMeta.ruleSetVersion,
        engineVersion: result.reviewMeta.engineVersion,
        reviewedAt: new Date().toISOString(),
        inputSnapshot: result.inputSnapshot,
        status: result.status,
        scores: result.scores,
        totalScore: result.totalScore,
        suggestions: result.suggestions,
        previousReviewId: previous?.reviewId || null,
        stale: false
      });
      assessed++;
    });
    persistHistory(nextHistory);
    showMessage(`Review saved for ${assessed} non-empty entr${assessed === 1 ? "y" : "ies"}. Original achievement text was not changed.`);
    renderHistory();
  } catch (error) {
    showMessage("Could not save the review. Existing review history was retained. " + String(error?.message || error), true);
  }
}
function installStyles() {
  const style = document.createElement("style");
  style.textContent = `
    #smartReviewPanel .sr-message{margin:12px 0;color:#285d49;font-size:13px}
    #smartReviewPanel .sr-message.is-error{color:#a54141}
    #smartReviewPanel .sr-actions{display:flex;gap:10px;flex-wrap:wrap;margin:14px 0}
    #smartReviewPanel .sr-actions button{border:1px solid #cbd9d2;background:#fff;border-radius:9px;padding:10px 14px;font-weight:700;color:#173d34}
    #smartReviewPanel .sr-actions .sr-primary{background:#123c35;color:#fff;border-color:#123c35}
    #smartReviewPanel .sr-result{border:1px solid #dce6e1;border-radius:12px;padding:16px;margin:14px 0;background:#fff;break-inside:avoid}
    #smartReviewPanel .sr-result-head{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}
    #smartReviewPanel .sr-result h3{margin:0;font-size:16px}
    #smartReviewPanel .sr-result-head p{margin:4px 0;color:#61736e;font-size:12px}
    #smartReviewPanel .sr-stale{font-size:12px;color:#8a5414;background:#fff5df;border-radius:6px;padding:5px 8px;height:max-content}
    #smartReviewPanel .sr-dimensions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:12px}
    #smartReviewPanel .sr-dimension{border:1px solid #e4ebe7;border-radius:8px;padding:10px;min-width:0}
    #smartReviewPanel .sr-dimension-head{display:flex;justify-content:space-between;gap:8px;font-size:13px}
    #smartReviewPanel .sr-dimension-head span{font-weight:800;white-space:nowrap}
    #smartReviewPanel .sr-clarification{margin-top:8px;padding:8px;background:#f7f9f7;border-radius:6px;font-size:12px}\n    #smartReviewPanel .sr-clarification ul{margin:5px 0 0;padding-left:18px}\n    #smartReviewPanel .sr-meta{font-size:11px;color:#61736e;overflow-wrap:anywhere;margin:6px 0}
    #smartReviewPanel .sr-dimension ul{padding-left:18px;font-size:12px;margin:8px 0 0}
    #smartReviewPanel .sr-empty{color:#61736e;font-size:13px}
    #smartReviewPanel details{margin-top:12px;font-size:12px}
    #smartReviewPanel pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f6f8f6;padding:10px;border-radius:6px}
    @media(max-width:700px){#smartReviewPanel .sr-dimensions{grid-template-columns:1fr}}
    @media print{#smartReviewPanel{display:none!important}}
  `;
  document.head.append(style);
}
function installPanel() {
  if ($("smartReviewPanel")) return;
  const panel = document.createElement("section");
  panel.className = "panel";
  panel.id = "smartReviewPanel";
  panel.innerHTML = `
    <h2>Smart Review <span style="font-size:11px;letter-spacing:.08em;color:#61736e">V1.0 BETA</span></h2>
    <p class="sub">A deterministic writing-quality review across five dimensions. This is a preparation aid, not an official NUS scoring system or an admission prediction.</p>
    <div class="notice">Review feedback is stored separately from your achievement entries. The engine does not verify claims or attachments. Missing information is marked “Needs information” rather than guessed.</div>
    <div class="sr-actions"><button type="button" class="sr-primary" id="srRun">Review all entries</button><button type="button" id="srRefresh">Refresh review status</button></div>
    <p id="srMessage" class="sr-message" role="status" aria-live="polite">No new review has been run.</p>
    <div id="srResults"></div>`;
  const target = $("achievementPanel");
  if (target) target.insertAdjacentElement("afterend", panel);
  else document.querySelector("main")?.append(panel);
  $("srRun")?.addEventListener("click", reviewAll);
  $("srRefresh")?.addEventListener("click", () => { renderHistory(); showMessage("Review status refreshed."); });
}
function init() {
  installStyles();
  installPanel();
  renderHistory();
  document.addEventListener("input", () => { updateStaleFlags(); renderHistory(); }, true);
  document.addEventListener("change", () => { updateStaleFlags(); renderHistory(); }, true);
  const items = $("items");
  if (items && "MutationObserver" in window) {
    const observer = new MutationObserver(() => {
      updateStaleFlags();
      renderHistory();
    });
    observer.observe(items, { childList:true, subtree:true });
  }
}
init();
