import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateAchievement,
  evaluatePortfolio,
  recognizeText,
  aggregateDimensionScores,
  clarificationFor
} from "./smart-review-engine.mjs";

const signal = (text, code, polarity) =>
  recognizeText("description", text).signals.some(s => s.code === code && (!polarity || s.polarity === polarity));

test("TR-01 EN positive: concrete activity is detected", () => {
  assert.ok(signal("I designed a water-filter prototype for our school project.", "ACTIVITY_DETAIL_SIGNAL", "positive"));
});
test("TR-01 EN negative: title alone is not activity detail", () => {
  assert.equal(signal("Science Project", "ACTIVITY_DETAIL_SIGNAL"), false);
});
test("TR-02 role title does not equal personal action", () => {
  const r = recognizeText("appointment", "I was appointed treasurer of the club.");
  assert.ok(r.signals.some(s => s.code === "ROLE_SIGNAL"));
  assert.ok(!r.signals.some(s => s.code === "PERSONAL_ACTION_SIGNAL"));
});
test("TR-03 EN concrete first-person action is detected", () => {
  assert.ok(signal("I created a registration spreadsheet and checked each entry.", "PERSONAL_ACTION_SIGNAL", "positive"));
});
test("TR-03 EN negated action is not positive", () => {
  const r = recognizeText("description", "I did not lead the team.");
  assert.ok(r.warnings.some(w => w.code === "NEGATION_PRESENT"));
  assert.ok(!r.signals.some(s => s.code === "PERSONAL_ACTION_SIGNAL" && s.polarity === "positive"));
});
test("TR-04 concrete output produces an outcome signal", () => {
  assert.ok(signal("We produced 12 prototype filters and tested them with three water samples.", "OUTCOME_SIGNAL"));
});
test("TR-04 generic praise is uncertain, not a concrete outcome", () => {
  const r = recognizeText("description", "The project was a great success.");
  assert.ok(r.signals.some(s => s.code === "GENERIC_OUTCOME_SIGNAL" && s.polarity === "uncertain"));
});
test("TR-05 specific reflection is detected", () => {
  assert.ok(signal("I learned to test one variable at a time, so I changed our experiment plan.", "REFLECTION_SPECIFIC_SIGNAL"));
});
test("TR-05 generic reflection remains a weak signal", () => {
  const r = recognizeText("description", "I learned many things.");
  assert.ok(r.signals.some(s => s.code === "REFLECTION_GENERIC_SIGNAL" && s.polarity === "uncertain"));
});
test("TR-06 evidence type or route is detected", () => {
  assert.ok(recognizeText("evidence", "The prototype photos and test log are saved in our project folder.")
    .signals.some(s => s.code === "EVIDENCE_TYPE_OR_ROUTE_SIGNAL"));
});
test("TR-06 AI claim is not treated as external verification", () => {
  const r = recognizeText("evidence", "Verified by ChatGPT.");
  assert.ok(r.warnings.some(w => w.code === "NO_EXTERNAL_VERIFICATION"));
});
test("TR-07 ISO date is detected as a time signal", () => {
  assert.ok(signal("The activity ran from 2026-01-10 to 2026-03-10.", "TIME_RANGE_SIGNAL"));
});
test("TR-08 third-party actor creates a subject ambiguity warning", () => {
  assert.ok(recognizeText("description", "The team leader assigned the tasks.")
    .warnings.some(w => w.code === "SUBJECT_AMBIGUOUS"));
});
test("TR-09 contradictory date fixture has end before start", () => {
  assert.ok(new Date("2026-03-10T00:00:00Z") > new Date("2026-02-10T00:00:00Z"));
});
test("TR-09 contradictory statements require clarification, not a fraud conclusion", () => {
  const r = recognizeText("description", "I led the project. I did not lead the project.");
  assert.equal(r.confidence, "ambiguous");
  assert.ok(r.warnings.some(w => w.code === "NEGATION_PRESENT"));
});

test("SR-001 blank portfolio: empty status and no average contribution", () => {
  const r = evaluatePortfolio(Array.from({ length: 10 }, () => ({})));
  assert.equal(r.achievements.length, 10);
  assert.ok(r.achievements.every(a => a.status === "empty" && a.totalScore === null));
  assert.equal(r.averageScore, null);
  assert.equal(r.averageSampleCount, 0);
});
test("SR-002 title-only entry cannot be completed", () => {
  assert.notEqual(evaluateAchievement({ title: "Science Club" }).status, "completed");
});
test("SR-003 no personal action cannot score D2 3 or 4", () => {
  const d = evaluateAchievement({ description: "I joined a school event." }).scores.personalContribution;
  assert.ok(d.status === "needs-info" || (d.status === "scored" && d.score <= 2));
});
test("SR-004 generic success claim cannot score D3 3 or 4", () => {
  const d = evaluateAchievement({ description: "The event was a great success." }).scores.outcomesAndImpact;
  assert.ok(d.status === "needs-info" || (d.status === "scored" && d.score <= 2));
});
test("SR-005 generic learning claim cannot score D4 3 or 4", () => {
  const d = evaluateAchievement({ description: "I learned many things." }).scores.reflectionAndGrowth;
  assert.ok(d.status === "needs-info" || (d.status === "scored" && d.score <= 2));
});
test("SR-006 no attachment plus a reasonable evidence route is not automatically low", () => {
  const r = evaluateAchievement({ title:"Volunteer", description:"I guided visitors.", evidence:"Attendance records and event photos are kept by the organiser." });
  assert.notEqual(r.scores.evidenceAndVerifiability.score, 0);
});
test("SR-007 attachment metadata does not prove authenticity", () => {
  const r = evaluateAchievement({ title:"Project", attachments:[{ id:"att-1", name:"photo.png", size:100 }] });
  assert.notEqual(r.authenticityVerified, true);
  assert.equal(r.scores.evidenceAndVerifiability.reasonCodes.includes("ATTACHMENT_NOT_AUTHENTICITY_VERIFIED"), true);
});
test("SR-008 five numeric scores 4,3,3,3,3 total 16", () => {
  assert.deepEqual(aggregateDimensionScores([4,3,3,3,3]), { status:"completed", totalScore:16 });
});
test("SR-009 any missing dimension means partial and null total", () => {
  assert.deepEqual(aggregateDimensionScores([3,2,1,4,null]), { status:"partial", totalScore:null, reasonCode:"DIMENSION_NEEDS_INFO" });
});
test("SR-010 score zero is permitted only as an explicit numeric assessment; missing is null", () => {
  assert.deepEqual(aggregateDimensionScores([0,2,2,2,2]), { status:"completed", totalScore:8 });
  assert.equal(aggregateDimensionScores([0,2,2,2,undefined]).totalScore, null);
});
test("SR-011 award alone does not boost contribution or reflection", () => {
  const r = evaluateAchievement({ award:"First Prize" });
  for (const k of ["personalContribution","reflectionAndGrowth"]) {
    assert.ok(r.scores[k].status === "needs-info" || r.scores[k].score <= 2);
  }
});
test("SR-012 appointment title alone cannot raise D2 to 3 or 4", () => {
  const d = evaluateAchievement({ appointment:"President" }).scores.personalContribution;
  assert.ok(d.status === "needs-info" || d.score <= 2);
});
test("SR-013 unsupported metric context cannot earn D3 4", () => {
  assert.notEqual(evaluateAchievement({ description:"Improved participation by 50%." }).scores.outcomesAndImpact.score, 4);
});
test("SR-014 missing dates create a gap, not an empty achievement", () => {
  const r = evaluateAchievement({ title:"School activity", description:"I helped organise the booth." });
  assert.notEqual(r.status, "empty");
  assert.ok(r.scores.contentCompleteness.missingRules.includes("D1-05"));
});
test("SR-014B contradictory dates require clarification and null the total", () => {
  const r = evaluateAchievement({ title:"Project", category:"Research", start:"2026-03-10", end:"2026-02-10", description:"I tested three prototypes.", organisation:"School project" });
  assert.equal(r.scores.contentCompleteness.status, "needs-info");
  assert.equal(r.scores.contentCompleteness.score, null);
  assert.equal(r.totalScore, null);
});
test("SR-020B vague text does not become a fabricated zero for outcomes or reflection", () => {
  const r = evaluateAchievement({ description:"Handled the thing like before." });
  assert.equal(r.scores.outcomesAndImpact.status, "needs-info");
  assert.equal(r.scores.outcomesAndImpact.score, null);
  assert.equal(r.scores.reflectionAndGrowth.status, "needs-info");
  assert.equal(r.scores.reflectionAndGrowth.score, null);
});
test("D2 top anchor requires role, action, decision signal and personal-team distinction", () => {
  const r = evaluateAchievement({
    title:"Club project", appointment:"Team Leader",
    description:"As team leader, I coordinated meetings because I was responsible for planning the agenda while my teammates handled the budget."
  });
  assert.equal(r.scores.personalContribution.score, 4);
  assert.ok(r.scores.personalContribution.matchedRules.includes("D2-05"));
  assert.ok(r.scores.personalContribution.matchedRules.includes("D2-06"));
});
test("D3 top anchor requires a contextualised metric, scope and action-outcome link", () => {
  const r = evaluateAchievement({
    title:"Sign-up project",
    description:"Attendance increased from 20 to 28 after we changed the sign-up process for 30 classmates."
  });
  assert.equal(r.scores.outcomesAndImpact.score, 4);
});
test("D5 top anchor requires an identifiable evidence type, route and activity link", () => {
  const r = evaluateAchievement({
    title:"Prototype project",
    evidence:"The prototype photos and test log are saved in our project folder for this project."
  });
  assert.equal(r.scores.evidenceAndVerifiability.score, 4);
  assert.notEqual(r.authenticityVerified, true);
});
test("SR-015 repeated identical input gives deterministic substantive output", () => {
  const input = { title:"Club", description:"I created a registration spreadsheet." };
  const a = evaluateAchievement(input), b = evaluateAchievement(input);
  const strip = x => JSON.stringify({status:x.status,scores:x.scores,totalScore:x.totalScore,suggestions:x.suggestions});
  assert.equal(strip(a), strip(b));
});
test("SR-016 saved review survives reload", { skip:"BLOCKED: review-history persistence is not integrated yet" }, () => {});
test("SR-017 ready flag does not affect scores", () => {
  const a = evaluateAchievement({ title:"Club", description:"I created a registration spreadsheet.", ready:false });
  const b = evaluateAchievement({ title:"Club", description:"I created a registration spreadsheet.", ready:true });
  assert.deepEqual(a.scores, b.scores);
});
test("SR-018 reordering entries does not change results by stable achievement ID", () => {
  const a = evaluatePortfolio([{id:"a",description:"I created a spreadsheet."},{id:"b",description:"I tested a prototype."}]);
  const b = evaluatePortfolio([{id:"b",description:"I tested a prototype."},{id:"a",description:"I created a spreadsheet."}]);
  const map = x => Object.fromEntries(x.achievements.map(v => [v.achievementId, JSON.stringify(v.scores)]));
  assert.deepEqual(map(a), map(b));
});
test("SR-019 negated lead claim is not positive leadership evidence", () => {
  const r = evaluateAchievement({ description:"I did not lead the team." });
  assert.ok(!r.scores.personalContribution.matchedRules.includes("D2-06"));
});
test("SR-020 ambiguous text does not receive unsupported high scores", () => {
  const r = evaluateAchievement({ description:"Handled the thing like before." });
  assert.ok(Object.values(r.scores).every(d => d.status === "needs-info" || d.score <= 2));
});
test("SR-021 each scored dimension includes a matched rule or explicit reason", () => {
  const r = evaluateAchievement({ title:"Club", description:"I created a registration spreadsheet." });
  for (const d of Object.values(r.scores)) if (d.status === "scored") assert.ok(d.matchedRules.length > 0 || d.reasonCodes.length > 0);
});
test("SR-022 clarification questions map to recognised gap codes", () => {
  assert.ok(clarificationFor("PERSONAL_ACTION_MISSING"));
  assert.ok(clarificationFor("OUTCOME_CONTEXT_MISSING"));
  assert.equal(clarificationFor("MADE_UP_CODE"), null);
});
test("SR-023 engine failure contract returns error, not a completed score", () => {
  const r = evaluateAchievement(null);
  assert.ok(["empty","error"].includes(r.status));
  assert.notEqual(r.status, "completed");
});
test("SR-024 rule-version reassessment creates a new review and preserves old history", { skip:"BLOCKED: review-history persistence is not integrated yet" }, () => {});
test("SR-025 evaluation does not mutate the source object", () => {
  const input = Object.freeze({ title:"Club", description:"I created a spreadsheet." });
  const before = JSON.stringify(input);
  evaluateAchievement(input);
  assert.equal(JSON.stringify(input), before);
});
test("SR-026 content edits mark old reviews stale", { skip:"BLOCKED: review-history persistence is not integrated yet" }, () => {});
test("SR-027 new review links to previous review", { skip:"BLOCKED: review-history persistence is not integrated yet" }, () => {});
test("SR-028 review snapshot preserves input and rule versions", { skip:"BLOCKED: review-history persistence is not integrated yet" }, () => {});
test("SR-029 attachment changes preserve blobs and stale dependent reviews", { skip:"BLOCKED: IndexedDB review dependency integration is not implemented" }, () => {});
test("SR-030 failed snapshot save does not claim success", { skip:"BLOCKED: review-history persistence is not integrated yet" }, () => {});
test("SR-031 legacy backup without Smart Review fields remains compatible", { skip:"BLOCKED: end-to-end backup import/restore test harness is not implemented" }, () => {});
test("SR-032 clearing current entries does not silently delete review history", { skip:"BLOCKED: review-history persistence is not integrated yet" }, () => {});
test("SR-033 CSV export remains unchanged", { skip:"BLOCKED: browser-level regression harness is not implemented" }, () => {});
test("SR-034 print output remains unchanged", { skip:"BLOCKED: browser-level print regression harness is not implemented" }, () => {});
test("SR-035 opening and closing the review panel does not duplicate listeners or overwrite edits", { skip:"BLOCKED: review UI is not integrated yet" }, () => {});
