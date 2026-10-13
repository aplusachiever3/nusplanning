/**
 * Smart Review V1.0 — deterministic, browser-safe rule engine.
 * This module offers writing-quality feedback only. It is not an official NUS
 * rubric, an authenticity checker, or an admissions predictor.
 */

export const SMART_REVIEW_CONFIG = Object.freeze({
  rubricVersion: "1.0.0",
  ruleSetVersion: "1.0.0",
  engineVersion: "1.0.0",
  dimensions: Object.freeze([
    { key: "contentCompleteness", label: "Content completeness", rules: ["D1-01","D1-02","D1-03","D1-04","D1-05","D1-06","D1-07"] },
    { key: "personalContribution", label: "Personal contribution", rules: ["D2-01","D2-02","D2-03","D2-04","D2-05","D2-06"] },
    { key: "outcomesAndImpact", label: "Outcomes and impact", rules: ["D3-01","D3-02","D3-03","D3-04","D3-05","D3-06"] },
    { key: "reflectionAndGrowth", label: "Reflection and growth", rules: ["D4-01","D4-02","D4-03","D4-04","D4-05","D4-06"] },
    { key: "evidenceAndVerifiability", label: "Evidence and verifiability", rules: ["D5-01","D5-02","D5-03","D5-04","D5-05","D5-06"] }
  ])
});

const DIMENSIONS = SMART_REVIEW_CONFIG.dimensions;
const norm = (v) => String(v ?? "").normalize("NFKC").trim();
const has = (s, re) => re.test(norm(s));
const any = (s, patterns) => patterns.some((re) => has(s, re));
const nonEmpty = (v) => norm(v).length > 0;

const PATTERNS = Object.freeze({
  negation: /\b(?:did not|didn't|do not|don't|was not|wasn't|never|not responsible|not lead|no longer)\b|(?:没有|并非|不是我|未曾|未参与|没有负责|不负责|并没有)/i,
  firstPersonAction: /\bI\s+(?:designed|built|created|organised|organized|conducted|tested|guided|volunteered|researched|prepared|coordinated|checked|led|managed|changed|made|planned|developed|implemented|taught|trained|raised|collected|analysed|analyzed|presented|wrote|produced|helped|supported)\b|(?:我(?:设计|制作|组织|进行|测试|带领|志愿服务|研究|准备|协调|核对|调整|安排|开发|实施|教授|训练|收集|分析|汇报|撰写|完成|协助|支持|负责))/i,
  activity: /\b(?:designed|built|created|organised|organized|conducted|tested|guided|volunteered|researched|prepared|coordinated|attended|participated|trained|performed|competed|served|developed|implemented|helped|supported|taught|collected|presented|published|produced)\b|(?:设计|制作|组织|进行|测试|带领|志愿服务|研究|准备|协调|参加|参与|训练|表演|竞赛|服务|开发|实施|协助|支持|教授|收集|汇报|发布|产出)/i,
  role: /\b(?:appointed as|served as|president|captain|chairperson|chairman|chairwoman|treasurer|secretary|team leader|project leader|committee member|volunteer)\b|(?:担任|被任命为|主席|队长|组长|财务|秘书|委员|志愿者)/i,
  outcome: /\b(?:produced|completed|published|built|created|delivered|launched|raised|collected|increased|reduced|improved|won|reached|achieved|resulted in|presented|performed|tested)\b|(?:制作了|完成了|发布了|建立了|交付了|推出了|筹集了|收集了|增加至|减少至|提升至|获得|达到|实现|产出了|汇报了|表演了|测试了)/i,
  genericOutcome: /\b(?:great success|very successful|excellent|improved a lot|made a big difference|highly impactful)\b|(?:非常成功|表现优秀|大幅提升|效果很好|影响很大|收获巨大)/i,
  specificReflection: /\b(?:I learned to|I realised that|I realized that|I changed|I now|after this, I|afterwards I applied|this taught me to)\b|(?:我学会|我意识到|我调整|我现在会|这让我学会|后来我应用|之后我改为)/i,
  genericReflection: /\b(?:learned a lot|learned many things|valuable experience|grew a lot|I learnt a lot)\b|(?:学到了很多|收获很大|很有价值|成长了很多)/i,
  evidenceType: /\b(?:certificate|photos?|test log|attendance record|project folder|portfolio|report|minutes|published article|official record|spreadsheet|dataset|work sample|can confirm|records are kept)\b|(?:证书|照片|测试记录|出席记录|项目文件夹|作品集|报告|会议记录|公开文章|官方记录|表格|数据集|作品样本|可以确认|记录保存在|活动记录)/i,
  metric: /\b\d+(?:\.\d+)?\s*(?:%|percent|people|students|participants|hours|dollars|items|projects|sessions|times)\b|(?:\d+(?:\.\d+)?\s*(?:%|人|名学生|名参与者|小时|元|项|个项目|次))/i,
  time: /\b\d{4}-\d{2}-\d{2}\b|\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{4}\b|(?:\d{4}年\d{1,2}月至\d{1,2}月|\d{4}年\d{1,2}月\d{1,2}日)/i,
  subjectAmbiguous: /\b(?:the team|my teammate|another student|the team leader|the organiser|the organizer|the treasurer|we)\b|(?:队友|组长|其他同学|组织者|财务|我们)/i,
  futureApplication: /\b(?:I applied this|I will apply|in future I will|since then I|I now use)\b|(?:后来我应用|今后我会|从那以后我|现在我会用)/i
});

export function recognizeText(field, value) {
  const text = norm(value);
  const signals = [];
  const warnings = [];
  const add = (code, polarity = "positive") => signals.push({ code, matchedText: text, sourceField: field, polarity });
  if (!text) return { signals, warnings, confidence: "none" };

  const negated = PATTERNS.negation.test(text);
  const subjectAmbiguous = PATTERNS.subjectAmbiguous.test(text) && !/\bI\b/i.test(text) && !/我/.test(text);
  if (negated) warnings.push({ code: "NEGATION_PRESENT", matchedText: text, sourceField: field });
  if (subjectAmbiguous) warnings.push({ code: "SUBJECT_AMBIGUOUS", matchedText: text, sourceField: field });

  if (field === "title" && text) add("TITLE_PRESENT");
  if (PATTERNS.activity.test(text)) add("ACTIVITY_DETAIL_SIGNAL", negated ? "negative" : "positive");
  if (PATTERNS.role.test(text)) add("ROLE_SIGNAL", negated ? "negative" : "positive");
  if (PATTERNS.firstPersonAction.test(text)) add("PERSONAL_ACTION_SIGNAL", negated ? "negative" : subjectAmbiguous ? "uncertain" : "positive");
  if (PATTERNS.outcome.test(text)) add("OUTCOME_SIGNAL", negated ? "negative" : "positive");
  if (PATTERNS.genericOutcome.test(text)) {
    add("GENERIC_OUTCOME_SIGNAL", "uncertain");
    warnings.push({ code: "OUTCOME_GENERIC_ONLY", matchedText: text, sourceField: field });
  }
  if (PATTERNS.specificReflection.test(text)) add("REFLECTION_SPECIFIC_SIGNAL", negated ? "negative" : "positive");
  if (PATTERNS.genericReflection.test(text)) {
    add("REFLECTION_GENERIC_SIGNAL", "uncertain");
    warnings.push({ code: "REFLECTION_SIGNAL_ONLY", matchedText: text, sourceField: field });
  }
  if (PATTERNS.evidenceType.test(text)) add("EVIDENCE_TYPE_OR_ROUTE_SIGNAL");
  if (/\bverified by chatgpt\b/i.test(text) || /AI已经证明是真的/.test(text)) {
    add("UNSUPPORTED_VERIFICATION_CLAIM", "uncertain");
    warnings.push({ code: "NO_EXTERNAL_VERIFICATION", matchedText: text, sourceField: field });
  }
  if (PATTERNS.metric.test(text)) add("METRIC_SIGNAL", "uncertain");
  if (PATTERNS.time.test(text)) add("TIME_RANGE_SIGNAL");
  if (subjectAmbiguous && signals.some((s) => s.code === "PERSONAL_ACTION_SIGNAL")) {
    warnings.push({ code: "ACTION_SUBJECT_NEEDS_REVIEW", matchedText: text, sourceField: field });
  }
  const confidence = warnings.some((w) => ["NEGATION_PRESENT", "SUBJECT_AMBIGUOUS"].includes(w.code))
    ? "ambiguous" : signals.length ? "explicit" : "none";
  return { signals, warnings, confidence };
}

function resultDimension(status, score = null, details = {}) {
  return { status, score, matchedRules: [], reasonCodes: [], missingRules: [], suggestions: [], ...details };
}
function addRule(d, rule, reason, suggestion) {
  d.matchedRules.push(rule);
  if (reason && !d.reasonCodes.includes(reason)) d.reasonCodes.push(reason);
  if (suggestion && !d.suggestions.includes(suggestion)) d.suggestions.push(suggestion);
}
function unique(a) { return [...new Set(a)]; }
function isBlankAchievement(a) {
  return !["title","category","start","end","description","award","appointment","organisation","participationLevel","evidence"]
    .some((k) => nonEmpty(a?.[k])) && !(Array.isArray(a?.attachments) && a.attachments.length);
}
function safeDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(norm(s));
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2])-1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2])-1 && d.getUTCDate() === Number(m[3]) ? d : null;
}

export function evaluateAchievement(achievement = {}, options = {}) {
  try {
    const a = structuredCloneSafe(achievement ?? {});
    if (isBlankAchievement(a)) return {
      status: "empty", totalScore: null, scores: Object.fromEntries(DIMENSIONS.map(d => [d.key, resultDimension("empty")])),
      suggestions: [], reviewMeta: versions(options), inputSnapshot: snapshot(a)
    };

    const desc = norm(a.description);
    const evidence = norm(a.evidence);
    const roleText = [a.appointment, a.participationLevel].map(norm).filter(Boolean).join(" ");
    const attachments = Array.isArray(a.attachments) ? a.attachments : [];
    const allText = [a.title,a.category,a.start,a.end,desc,a.award,a.appointment,a.organisation,a.participationLevel,evidence].map(norm).filter(Boolean).join(" ");
    const hasActivity = PATTERNS.activity.test(desc);
    const hasAction = PATTERNS.firstPersonAction.test(desc) && !PATTERNS.negation.test(desc);
    const hasRole = nonEmpty(a.appointment) || PATTERNS.role.test(roleText);
    const hasOutcome = PATTERNS.outcome.test(desc) || PATTERNS.outcome.test(norm(a.award));
    const genericOutcome = PATTERNS.genericOutcome.test(desc) || PATTERNS.genericOutcome.test(norm(a.award));
    const hasSpecificReflection = PATTERNS.specificReflection.test(desc);
    const genericReflection = PATTERNS.genericReflection.test(desc);
    const hasEvidenceRoute = PATTERNS.evidenceType.test(evidence) || PATTERNS.evidenceType.test(desc);
    const hasTime = nonEmpty(a.start) || nonEmpty(a.end) || PATTERNS.time.test(desc);
    const contradictoryDates = Boolean(safeDate(a.start) && safeDate(a.end) && safeDate(a.start) > safeDate(a.end));
    const subjectAmbiguous = PATTERNS.subjectAmbiguous.test(desc) && !/\bI\b/i.test(desc) && !/我/.test(desc);
    const scores = {};

    // D1 — Content completeness
    {
      const d = resultDimension("scored", 0);
      const title = nonEmpty(a.title), category = nonEmpty(a.category), organisation = nonEmpty(a.organisation);
      const activity = hasActivity || nonEmpty(desc);
      const role = hasRole || hasAction;
      const dateKnown = hasTime;
      if (title) addRule(d,"D1-01","TITLE_IDENTIFIABLE");
      if (activity) addRule(d,"D1-02","ACTIVITY_DESCRIPTION_PRESENT");
      if (category || organisation) addRule(d,"D1-03","BACKGROUND_PRESENT");
      if (role) addRule(d,"D1-04","PARTICIPATION_IDENTIFIABLE");
      if (dateKnown) addRule(d,"D1-05","TIME_INFORMATION_PRESENT");
      if (contradictoryDates) addRule(d,"D1-06","DATE_CONTRADICTION","Check the start and end dates; the end date appears earlier than the start date.");
      const coreCount = [title, activity, category || organisation, role, dateKnown].filter(Boolean).length;
      if (!title) { d.missingRules.push("D1-01"); d.suggestions.push("Add a short, recognisable activity or achievement title."); }
      if (!activity) { d.missingRules.push("D1-02"); d.suggestions.push("Describe the activity or experience in one or two concrete sentences."); }
      if (!role) { d.missingRules.push("D1-04"); d.suggestions.push("Clarify your role or what you personally did."); }
      if (!dateKnown) { d.missingRules.push("D1-05"); d.suggestions.push("Add the time period if applicable, or clarify why dates do not apply."); }
      if (contradictoryDates) { d.score = 1; }
      else if (!activity && !title && !organisation) { d.status = "needs-info"; d.score = null; d.reasonCodes.push("CONTENT_TOO_SPARSE_TO_ASSESS"); }
      else if (coreCount <= 1) d.score = 1;
      else if (coreCount === 2) d.score = 2;
      else if (coreCount <= 4) d.score = 3;
      else d.score = 4;
      if (d.score === 0) addRule(d,"D1-07","NO_USABLE_CONTENT");
      d.matchedRules = unique(d.matchedRules); d.reasonCodes = unique(d.reasonCodes); d.missingRules = unique(d.missingRules); d.suggestions = unique(d.suggestions);
      scores.contentCompleteness = d;
    }

    // D2 — Personal contribution. Role/title alone is never high-scoring evidence.
    {
      const d = resultDimension("needs-info", null);
      if (hasRole) addRule(d,"D2-01","ROLE_IDENTIFIABLE");
      if (hasAction) addRule(d,"D2-02","PERSONAL_ACTION_SIGNAL");
      if (hasAction && hasRole) addRule(d,"D2-03","ACTION_ROLE_LINK");
      if (subjectAmbiguous) { d.reasonCodes.push("SUBJECT_UNCLEAR"); d.suggestions.push("Clarify which actions were yours and which were performed by other people."); }
      else if (!hasAction) {
        d.reasonCodes.push(hasRole ? "ROLE_ONLY" : "PERSONAL_ACTION_MISSING");
        d.suggestions.push("Describe one specific action you personally took and what it involved.");
        if (nonEmpty(desc) || hasRole) {
          d.status = "scored"; d.score = 1;
          addRule(d,"D2-01","ROLE_OR_CONTEXT_ONLY");
        }
      } else {
        d.status = "scored";
        d.score = 2;
        if (hasRole) d.score = 3;
        if (hasAction && hasRole && /\b(?:because|so that|in order to|decided|solved|adapted|resolved|negotiated|planned|coordinated)\b|(?:因此|为了|决定|解决|调整|协调|规划)/i.test(desc)) {
          d.score = 4; addRule(d,"D2-06","DECISION_OR_PROBLEM_SOLVING_SIGNAL");
        }
        addRule(d,"D2-04","ACTION_SCOPE_SIGNAL");
        if (/\b(?:I|my)\b|我/.test(desc)) addRule(d,"D2-05","PERSONAL_TEAM_DISTINCTION_SIGNAL");
      }
      d.matchedRules = unique(d.matchedRules); d.reasonCodes = unique(d.reasonCodes); d.suggestions = unique(d.suggestions);
      scores.personalContribution = d;
    }

    // D3 — Outcomes and impact
    {
      const d = resultDimension("needs-info", null);
      if (hasOutcome && !genericOutcome) {
        d.status = "scored"; d.score = 2;
        addRule(d,"D3-01","OUTCOME_IDENTIFIABLE");
        addRule(d,"D3-04","ACTION_OUTCOME_TEXT_PRESENT");
        if (PATTERNS.metric.test(desc) || PATTERNS.metric.test(norm(a.award))) {
          addRule(d,"D3-05","METRIC_SIGNAL_NEEDS_CONTEXT");
          d.reasonCodes.push("METRIC_CONTEXT_MAY_BE_NEEDED");
          d.suggestions.push("If you use a number, explain its baseline, scope and how it was measured.");
        }
        if (/\b(?:for\s+\d+|among|across|serving|reached|participants|students|community)\b|(?:为\d+|覆盖|服务|参与者|学生|社区)/i.test(desc)) {
          d.score = 3; addRule(d,"D3-03","IMPACT_SCOPE_SIGNAL");
        }
      } else if (genericOutcome) {
        d.status = "scored"; d.score = 1;
        d.reasonCodes.push("OUTCOME_GENERIC_ONLY");
        d.suggestions.push("Replace general praise with the actual output or result, if known.");
      } else if (nonEmpty(desc) || nonEmpty(a.award)) {
        d.status = "scored"; d.score = 0;
        addRule(d,"D3-02","NO_IDENTIFIABLE_OUTCOME");
        d.suggestions.push("State what was produced, completed, changed or achieved. If no outcome is known, say so.");
      } else {
        d.reasonCodes.push("OUTCOME_CONTEXT_MISSING");
        d.suggestions.push("Describe the result or output of your actions, if there was one.");
      }
      if (d.score === 4) d.score = 3; // V1.0 text signals alone cannot justify the top anchor.
      d.matchedRules = unique(d.matchedRules); d.reasonCodes = unique(d.reasonCodes); d.suggestions = unique(d.suggestions);
      scores.outcomesAndImpact = d;
    }

    // D4 — Reflection and growth
    {
      const d = resultDimension("needs-info", null);
      if (hasSpecificReflection) {
        d.status = "scored"; d.score = 2;
        addRule(d,"D4-01","SPECIFIC_LEARNING_SIGNAL");
        addRule(d,"D4-03","EXPERIENCE_LEARNING_LINK_SIGNAL");
        if (PATTERNS.futureApplication.test(desc)) {
          d.score = 4; addRule(d,"D4-05","FUTURE_APPLICATION_SIGNAL");
        } else if (/\b(?:changed|now|instead|adjusted|approach|behaviour|behavior)\b|(?:改变|调整|现在|做法|行为)/i.test(desc)) {
          d.score = 3; addRule(d,"D4-04","CHANGE_SIGNAL");
        } else {
          d.suggestions.push("Explain how this learning changed your approach or how you may apply it later.");
        }
      } else if (genericReflection) {
        d.status = "scored"; d.score = 1;
        d.reasonCodes.push("REFLECTION_GENERIC");
        d.suggestions.push("Name one specific lesson or challenge rather than saying only that you learned a lot.");
      } else if (nonEmpty(desc)) {
        d.status = "scored"; d.score = 0;
        addRule(d,"D4-01","NO_REFLECTION_SIGNAL");
        d.suggestions.push("Add a reflection on what you learned, what challenged you, or what you would do differently.");
      } else {
        d.reasonCodes.push("REFLECTION_CONTEXT_MISSING");
        d.suggestions.push("Add a brief reflection if you have one; do not invent a lesson.");
      }
      d.matchedRules = unique(d.matchedRules); d.reasonCodes = unique(d.reasonCodes); d.suggestions = unique(d.suggestions);
      scores.reflectionAndGrowth = d;
    }

    // D5 — Evidence and verifiability
    {
      const d = resultDimension("needs-info", null);
      if (nonEmpty(evidence)) addRule(d,"D5-01","EVIDENCE_NOTE_PRESENT");
      if (hasEvidenceRoute) {
        d.status = "scored"; d.score = 3;
        addRule(d,"D5-02","EVIDENCE_TYPE_OR_ROUTE_IDENTIFIABLE");
        addRule(d,"D5-03","POSSIBLE_CHECK_ROUTE_IDENTIFIABLE");
        addRule(d,"D5-04","EVIDENCE_LINK_SIGNAL");
      } else if (attachments.length) {
        d.status = "scored"; d.score = 2;
        addRule(d,"D5-05","ATTACHMENT_METADATA_PRESENT");
        d.reasonCodes.push("ATTACHMENT_NOT_AUTHENTICITY_VERIFIED");
        d.suggestions.push("Note what each attachment supports. The app does not verify file authenticity.");
      } else if (nonEmpty(evidence)) {
        d.status = "scored"; d.score = 1;
        d.reasonCodes.push("EVIDENCE_DESCRIPTION_VAGUE");
        d.suggestions.push("Name the evidence type or a reasonable source that could corroborate the claim.");
      } else {
        d.reasonCodes.push("EVIDENCE_ROUTE_MISSING");
        d.suggestions.push("If available, note a record, work sample or person who could corroborate the experience. An upload is not mandatory.");
      }
      if (attachments.length && hasEvidenceRoute) addRule(d,"D5-05","ATTACHMENT_METADATA_PRESENT");
      d.matchedRules = unique(d.matchedRules); d.reasonCodes = unique(d.reasonCodes); d.suggestions = unique(d.suggestions);
      scores.evidenceAndVerifiability = d;
    }

    const hasNeedsInfo = Object.values(scores).some(d => d.status === "needs-info");
    const status = hasNeedsInfo ? "partial" : "completed";
    const totalScore = hasNeedsInfo ? null : Object.values(scores).reduce((sum,d)=>sum+d.score,0);
    const suggestions = unique(Object.values(scores).flatMap(d => d.suggestions));
    return {
      status, totalScore, scores, suggestions,
      reviewMeta: versions(options),
      inputSnapshot: snapshot(a),
      warnings: unique(Object.values(scores).flatMap(d => d.reasonCodes).filter(c => /CONTRADICTION|UNCLEAR|MAY_BE_NEEDED|NOT_AUTHENTICITY/.test(c)))
    };
  } catch (error) {
    return {
      status: "error", totalScore: null,
      scores: Object.fromEntries(DIMENSIONS.map(d => [d.key, resultDimension("error", null, { reasonCodes: ["ENGINE_ERROR"] })])),
      suggestions: [], error: String(error?.message || error), reviewMeta: versions(options),
      inputSnapshot: null
    };
  }
}

export function evaluatePortfolio(achievements = [], options = {}) {
  const items = Array.isArray(achievements) ? achievements : [];
  const results = items.map((a, index) => ({
    achievementId: a?.achievementId ?? a?.id ?? `entry-${index + 1}`,
    ...evaluateAchievement(a, options)
  }));
  const scored = results.filter(r => r.status === "completed" && typeof r.totalScore === "number");
  return {
    achievements: results,
    averageScore: scored.length ? scored.reduce((n,r)=>n+r.totalScore,0)/scored.length : null,
    averageSampleCount: scored.length
  };
}

export function clarificationFor(reasonCode) {
  const map = {
    ACTIVITY_CONTEXT_MISSING: ["What did the activity involve?", "Describe one concrete task or activity."],
    BACKGROUND_MISSING: ["What was the context or audience?", "Add the organisation, setting or audience if relevant."],
    TIME_RANGE_UNCLEAR: ["When did it start and end?", "Give the time period, or say why dates do not apply."],
    ROLE_ONLY: ["What were you personally responsible for?", "Describe your own responsibilities."],
    PERSONAL_ACTION_MISSING: ["What specific action did you take?", "Name an action and its task or object."],
    SUBJECT_UNCLEAR: ["Was this action yours or someone else's?", "Clarify who performed the action."],
    OUTCOME_CONTEXT_MISSING: ["What result or output followed?", "Describe the outcome if known; do not invent one."],
    METRIC_CONTEXT_MAY_BE_NEEDED: ["What are the baseline, measure and scope for this number?", "Explain how the number was defined or measured."],
    REFLECTION_GENERIC: ["What specifically did you learn?", "Describe one specific lesson or challenge."],
    EVIDENCE_ROUTE_MISSING: ["What record or source could support this experience?", "Name a reasonable evidence type or check route, if available."]
  };
  const entry = map[reasonCode];
  return entry ? { reasonCode, question: entry[0], guidance: entry[1] } : null;
}

function versions(options) {
  return {
    rubricVersion: options.rubricVersion ?? SMART_REVIEW_CONFIG.rubricVersion,
    ruleSetVersion: options.ruleSetVersion ?? SMART_REVIEW_CONFIG.ruleSetVersion,
    engineVersion: options.engineVersion ?? SMART_REVIEW_CONFIG.engineVersion
  };
}
function snapshot(a) {
  const fields = ["title","category","start","end","description","award","appointment","organisation","participationLevel","evidence"];
  return {
    ...Object.fromEntries(fields.map(k => [k, norm(a?.[k])])),
    attachments: (Array.isArray(a?.attachments) ? a.attachments : []).map(x => ({
      id: norm(x?.id), name: norm(x?.name), type: norm(x?.type), size: Number.isFinite(x?.size) ? x.size : null
    }))
  };
}
function structuredCloneSafe(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value ?? {}));
}


/** Aggregate five dimension scores under the V1.0 null-total contract. */
export function aggregateDimensionScores(scores) {
  if (!Array.isArray(scores) || scores.length !== 5) {
    return { status: "error", totalScore: null, reasonCode: "FIVE_DIMENSIONS_REQUIRED" };
  }
  if (scores.some((s) => s === null || s === undefined || !Number.isInteger(s) || s < 0 || s > 4)) {
    return { status: "partial", totalScore: null, reasonCode: "DIMENSION_NEEDS_INFO" };
  }
  return { status: "completed", totalScore: scores.reduce((sum, score) => sum + score, 0) };
}
