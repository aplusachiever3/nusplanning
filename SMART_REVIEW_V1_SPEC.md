# Smart Review V1.0 — Recognition Rules and Acceptance Plan

**Status:** Initial implementation on an isolated feature branch. This is not an official NUS assessment rubric and does not predict admission.

## 1. Safety and scoring contract

- Pure JavaScript. No API, network request, or external AI service.
- Text patterns create auditable candidate signals; they do not prove that a claim is true.
- The engine must not infer admission probability or claim that NUS uses this scoring system.
- Five dimensions are assessed from 0–4: content completeness, personal contribution, outcomes and impact, reflection and growth, and evidence and verifiability.
- A missing or ambiguous dimension uses status `needs-info` and a `null` score. Missing information is not zero.
- A score of zero is permitted only where the available context is sufficient to assess the dimension and the relevant content is absent.
- The overall score is shown only when all five dimensions have numeric scores. No partial rescaling.
- Attachments are never treated as authenticity-verified merely because metadata exists.
- Original achievement fields must never be rewritten by the review engine.
- Every review record should retain rubric, rule-set and engine versions, an input snapshot, and its predecessor link.
- Changing scored content or linked attachment metadata should mark the old review stale; changing only the `ready` checkbox should not.

## 2. Recognition result contract

`recognizeText(field, value)` returns:
- `signals[]`: code, matched text, source field, and polarity (`positive`, `negative`, or `uncertain`)
- `warnings[]`: negation, ambiguous subject, generic claim, or unsupported verification warning
- `confidence`: surface-pattern confidence only, not truth confidence

The V1 detector is deliberately shallow. Complex negation, quotations, pronouns across sentences, sarcasm, and context-dependent meaning may require a user clarification. The implementation contains multilingual pattern support, but the test fixtures and documentation in this specification are English-only.

## 3. Text-recognition rules

### TR-01 — Activity detail (D1)
**Positive examples**
- “I designed a water-filter prototype for our school project.”
- “I volunteered at the school open house and guided visitors to the science booths.”
- “I attended weekly training sessions for the school robotics team.”

**Negative examples**
- “Science Project.”
- “I did many things.”
- “I participated in many activities.”

A title or generic participation phrase does not establish concrete activity detail.

### TR-02 — Role versus action (D2)
**Role-only examples**
- “I was appointed treasurer of the club.”
- “I was the team captain.”

These establish a possible role only, not what the student actually did.

**Action examples**
- “As project leader, I coordinated the weekly meetings.”
- “I prepared the event budget and checked each expense.”

**Counterexamples**
- “The treasurer prepared the budget.” (the subject may be someone else)
- “I was a leader.” (role only, no action)

### TR-03 — Personal action (D2)
**Positive**
- “I created a registration spreadsheet and checked each entry.”
- “I tested three prototype designs and recorded the results.”

**Negative or ambiguous**
- “I did not lead the team.”
- “The team leader assigned the tasks.”
- “My teammate presented the final results.”

Negated actions and third-party actions must not be credited as the user's positive contribution.

### TR-04 — Outcome and impact (D3)
**Concrete outcome examples**
- “We produced 12 prototype filters and tested them with three water samples.”
- “Attendance rose from 20 to 28 after we changed the sign-up process.”
- “I published a project report and presented the findings to 30 classmates.”

**Weak examples**
- “The project was a great success.”
- “Participation improved by 50%.” (no metric definition or baseline)

Numbers and outcome verbs are candidate signals only. They do not independently prove impact, causation, or accuracy.

### TR-05 — Reflection and growth (D4)
**Specific examples**
- “I learned to test one variable at a time, so I changed our experiment plan before the next trial.”
- “I realised that our instructions were unclear, so I rewrote them and tested them with new participants.”

**Generic counterexamples**
- “I learned many things.”
- “The experience was valuable.”
- “I grew a lot.”

The engine does not judge sincerity. Generic reflection cannot independently support a high score.

### TR-06 — Evidence type and route (D5)
**Examples**
- “The prototype photos and test log are saved in our project folder.”
- “The club secretary can confirm my role.”
- “The final report is published on the school website.”

**Counterexamples**
- “I have proof.”
- “Verified by ChatGPT.”

Evidence notes may describe a reasonable checking route. The application does not authenticate files or claims. Uploading a file is not mandatory.

### TR-07 — Time information (D1)
**Examples**
- “From January to March 2026, I attended weekly sessions.”
- “The project ran from 2026-01-10 to 2026-03-10.”

**Weak examples**
- “I did this for some time.”
- “I participated for a while.”

Unparseable dates should be flagged rather than guessed. Missing dates are a gap, not a reason to treat the whole achievement as empty.

### TR-08 — Negation and subject ownership
Negation patterns include “did not”, “never”, “not responsible”, and “no longer”. Subject ambiguity includes “my teammate”, “the team leader”, and “another student”. These checks are safeguards, not a full natural-language parser. Ambiguous cases should trigger clarification.

### TR-09 — Contradictions and overclaiming
An end date earlier than a valid start date is a structural contradiction. Conflicting statements about leading or not leading a project require clarification. The engine must not infer fraud, select one statement arbitrarily, or assume that team and individual work are necessarily contradictory.

## 4. Clarification question catalogue

| Reason code | Question | Expected useful response |
|---|---|---|
| `ACTIVITY_CONTEXT_MISSING` | What did the activity involve? | One concrete task or activity |
| `BACKGROUND_MISSING` | What was the context or audience? | Setting, organisation or audience |
| `TIME_RANGE_UNCLEAR` | When did it start and end? | Time period, or why dates do not apply |
| `ROLE_ONLY` | What were you personally responsible for? | Personal responsibility |
| `PERSONAL_ACTION_MISSING` | What specific action did you take? | Action and task or object |
| `SUBJECT_UNCLEAR` | Was this action yours or someone else's? | Clear actor |
| `RESPONSIBILITY_SCOPE_UNCLEAR` | Which parts did you own versus the team? | Individual/team boundary |
| `OUTCOME_CONTEXT_MISSING` | What result or output followed? | Result if known; do not invent one |
| `OUTCOME_SCOPE_UNCLEAR` | Who or what was affected, and to what extent? | Audience or scope, if known |
| `METRIC_CONTEXT_MAY_BE_NEEDED` | What are the baseline, measure and scope for this number? | Metric definition or an explicit unknown |
| `REFLECTION_GENERIC` | What specifically did you learn? | Specific lesson or challenge |
| `GROWTH_CHANGE_MISSING` | What changed in your approach or judgement? | Specific change, or that no change is identified |
| `APPLICATION_MISSING` | How did you apply this learning afterwards? | Later application, or not yet applied |
| `EVIDENCE_ROUTE_MISSING` | What record or source could support this experience? | Evidence type or check route, if available |
| `EVIDENCE_LINK_UNCLEAR` | Which claim does this material support? | Link between evidence and claim |
| `CONTRADICTION_NEEDS_CLARIFICATION` | What do these two statements refer to, and how do they fit together? | Clarification of scope/context |
| `TEXT_NOT_PARSEABLE` | Could you describe your action, result or learning in one or two direct sentences? | Plain-language clarification |

Answers must be stored separately from the original description, with source `user-confirmed` and a timestamp. “I don't know” or “I have no evidence” is recorded as such; it must not be converted into a fabricated fact or automatically treated as a bad achievement.

## 5. Acceptance test status

- Recognition tests and engine-only SR tests are defined in `smart-review-v1.test.mjs`.
- Browser-level acceptance tests are defined in `smart-review-browser.test.mjs` and run with Chromium in GitHub Actions.
- Current automated Chromium coverage: review persistence across reload; stale marking after content edits; predecessor review linking; attachment blob storage and review metadata; CSV and JSON backup downloads; print-mode hiding of the Smart Review panel and empty achievement cards.
- Latest successful run: [GitHub Actions](https://github.com/aplusachiever3/nusplanning/actions/runs/38329419615). The Node suite reports 55 tests, 43 passed, 0 failed, and 12 skipped; the browser suite reports 5 passed, 0 failed.
- The 12 skipped Node tests remain explicit blocked placeholders and are **not** counted as passing. Remaining gaps include attachment changes after a saved review, reset/history behavior, deeper repeated-interaction regression, actual printed/PDF layout inspection, and cross-browser/mobile manual acceptance.
- The current planner supports JSON export but has no JSON import UI; backup compatibility is therefore limited to preserving the existing export format and existing stored planner data.
- The rule engine remains a first implementation, not release-ready. Passing headless Chromium tests does not replace manual review in the target browsers and viewport sizes.
