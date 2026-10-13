# Smart Review V1.0 — Recognition Rules and Acceptance Plan

**Status:** Initial implementation on an isolated feature branch. Not an official NUS assessment rubric and not an admissions predictor.

## 1. Safety and scoring contract

- Pure JavaScript. No API, network request, or external AI service.
- Text patterns create auditable candidate signals; they do not prove that a claim is true.
- The engine must not infer admission probability or claim that NUS uses this scoring system.
- Five dimensions are assessed from 0–4: content completeness, personal contribution, outcomes and impact, reflection and growth, evidence and verifiability.
- A missing or ambiguous dimension uses status `needs-info` and a `null` score. Missing information is not zero.
- A score of zero is permitted only where the available context is sufficient to assess the dimension and the relevant content is absent.
- The overall score is shown only when all five dimensions have numeric scores. No partial rescaling.
- Attachments are never treated as authenticity-verified merely because metadata exists.
- Original achievement fields must never be rewritten by the review engine.
- Every review record should retain its rubric, rule-set and engine versions, an input snapshot, and its predecessor link.
- Changing scored content or linked attachment metadata should mark the old review stale; changing only the `ready` checkbox should not.

## 2. Recognition result contract

`recognizeText(field, value)` returns:
- `signals[]`: code, matched text, source field, and polarity (`positive`, `negative`, or `uncertain`)
- `warnings[]`: negation, ambiguous subject, generic claim, or unsupported verification warning
- `confidence`: surface-pattern confidence only, not truth confidence

The V1 detector is deliberately shallow. Complex negation, quotations, pronouns across sentences, sarcasm, and context-dependent meaning may require a user clarification.

## 3. Text-recognition rules

### TR-01 — Activity detail (D1)
**Positive examples**
- EN: “I designed a water-filter prototype for our school project.”
- EN: “I volunteered at the school open house and guided visitors to the science booths.”
- ZH: “我为学校科学项目设计了一个简易滤水装置。”
- ZH: “开放日时，我负责带领访客参观科学展区。”

**Negative examples**
- EN: “Science Project”; “I did many things.”
- ZH: “科学项目”；“我参加了很多活动。”

A title or generic participation phrase does not establish concrete activity detail.

### TR-02 — Role versus action (D2)
**Positive role-only examples**
- EN: “I was appointed treasurer of the club.”
- ZH: “我被任命为社团财务。”

These establish a possible role only, not what the student actually did.

**Action examples**
- EN: “As project leader, I coordinated the weekly meetings.”
- ZH: “作为项目组长，我协调每周会议。”

**Counterexamples**
- EN: “The treasurer prepared the budget.” (subject may be someone else)
- ZH: “财务负责准备预算。” (subject is unclear)

### TR-03 — Personal action (D2)
**Positive**
- EN: “I created a registration spreadsheet and checked each entry.”
- ZH: “我制作报名表，并逐项核对资料。”

**Negative or ambiguous**
- EN: “I did not lead the team.”; “The team leader assigned the tasks.”
- ZH: “我没有带领团队。”；“组长分配了任务。”

Negated actions and third-party actions must not be credited as the user's positive contribution.

### TR-04 — Outcome and impact (D3)
**Concrete outcome examples**
- EN: “We produced 12 prototype filters and tested them with three water samples.”
- EN: “Attendance rose from 20 to 28 after we changed the sign-up process.”
- ZH: “我们制作了12个滤水原型，并用三份水样进行测试。”
- ZH: “调整报名流程后，参加人数从20人增至28人。”

**Weak examples**
- EN: “The project was a great success.”; “Participation improved by 50%.” (no metric definition or baseline)
- ZH: “项目非常成功。”；“参与率提升了50%。” (no metric definition)

Numbers and outcome verbs are candidate signals only. They do not independently prove impact, causation, or accuracy.

### TR-05 — Reflection and growth (D4)
**Specific examples**
- EN: “I learned to test one variable at a time, so I changed our experiment plan before the next trial.”
- ZH: “我学会一次只改变一个变量，因此在下一次实验前调整了测试计划。”

**Generic counterexamples**
- EN: “I learned many things.”; “The experience was valuable.”
- ZH: “我学到了很多。”；“这次经历很有价值。”

The engine does not judge sincerity. Generic reflection cannot independently support a high score.

### TR-06 — Evidence type and route (D5)
**Examples**
- EN: “The prototype photos and test log are saved in our project folder.”
- EN: “The club secretary can confirm my role.”
- ZH: “原型照片和测试记录保存在项目文件夹中。”
- ZH: “社团秘书可以确认我的职责。”

**Counterexamples**
- EN: “I have proof.”; “Verified by ChatGPT.”
- ZH: “我有证据。”；“AI已经证明是真的。”

Evidence notes may describe a reasonable checking route. The application does not authenticate files or claims. Uploading a file is not mandatory.

### TR-07 — Time information (D1)
**Examples**
- EN: “From January to March 2026, I attended weekly sessions.”
- ZH: “2026年1月至3月，我每周参加训练。”

**Weak examples**
- EN: “I did this for some time.”
- ZH: “我参加了一段时间。”

Unparseable dates should be flagged rather than guessed. Missing dates are a gap, not a reason to treat the whole achievement as empty.

### TR-08 — Negation and subject ownership
Negation patterns include “did not”, “never”, “not responsible”, “没有”, “并非”, and “未参与”. Subject ambiguity includes “my teammate”, “the team leader”, “队友”, and “组长”. These checks are safeguards, not a full natural-language parser. Ambiguous cases should trigger clarification.

### TR-09 — Contradictions and overclaiming
An end date earlier than a valid start date is a structural contradiction. Conflicting statements about leading or not leading a project require clarification. The engine must not infer fraud, select one statement arbitrarily, or assume that team and individual work are necessarily contradictory.

## 4. Clarification question catalogue

| Reason code | Question | Expected useful response |
|---|---|---|
| `ACTIVITY_CONTEXT_MISSING` | What did the activity involve? | One concrete task or activity |
| `BACKGROUND_MISSING` | What was the context or audience? | Setting, organisation or audience |
| `TIME_RANGE_UNCLEAR` | When did it start and end? | Time period, or why dates do not apply |
| `ROLE_ONLY` | What were you personally responsible for? | Personal responsibility |
| `PERSONAL_ACTION_MISSING` | What specific action did you take? | Action and task/object |
| `SUBJECT_UNCLEAR` | Was this action yours or someone else's? | Clear actor |
| `RESPONSIBILITY_SCOPE_UNCLEAR` | Which parts did you own versus the team? | Individual/team boundary |
| `OUTCOME_CONTEXT_MISSING` | What result or output followed? | Result if known; do not invent one |
| `OUTCOME_SCOPE_UNCLEAR` | Who or what was affected, and to what extent? | Audience or scope, if known |
| `METRIC_CONTEXT_MAY_BE_NEEDED` | What are the baseline, measure and scope for this number? | Metric definition or an explicit unknown |
| `REFLECTION_GENERIC` | What specifically did you learn? | Specific lesson or challenge |
| `GROWTH_CHANGE_MISSING` | What changed in your approach or judgement? | Specific change, or that no change is identified |
| `APPLICATION_MISSING` | How did you apply this learning afterwards? | Later application, or not yet applied |
| `EVIDENCE_ROUTE_MISSING` | What record or source could support this experience? | Evidence type/check route, if available |
| `EVIDENCE_LINK_UNCLEAR` | Which claim does this material support? | Link between evidence and claim |
| `CONTRADICTION_NEEDS_CLARIFICATION` | What do these two statements refer to, and how do they fit together? | Clarification of scope/context |
| `TEXT_NOT_PARSEABLE` | Could you describe your action, result or learning in one or two direct sentences? | Plain-language clarification |

Answers must be stored separately from the original description, with source `user-confirmed` and a timestamp. “I don't know” or “I have no evidence” is recorded as such; it must not be converted into a fabricated fact or automatically treated as a bad achievement.

## 5. Acceptance test status

- TR recognition tests and engine-only SR tests are defined in `smart-review-v1.test.mjs`.
- SR-016, SR-024, SR-026–SR-034, and SR-035 require persistence, attachment, backup, print or UI integration and remain blocked until those components and a browser-level harness exist.
- A skipped test is **BLOCKED**, not PASS.
- The rule engine is a first implementation, not yet release-ready. Browser integration and real Node test execution remain required.
