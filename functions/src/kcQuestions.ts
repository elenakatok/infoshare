import {
  DEFAULT_ROUND_SETTINGS, LOTS, profileFor,
  type Lots, type RoundSettings,
} from './round/settings'
import { expectedProfit, payoffTable } from './round/resolver'

// ═══════════════════════════════════════════════════════════════════════════════
// THE QUESTION BANK — Information_Sharing_KC_Questions_v1, spec §8.
//
// Q1 role gate (ungraded) · Q2–Q8 seven graded MC · Q9 debrief free text.
//
// ⚠ NOT ROLE-SPLIT, AND ONE DENOMINATOR OF SEVEN. Roles are assigned late and revealed at
// game start, so no question may assume the reader's own role: every student sees the same
// seven, and each speaks about "the Retailer" and "the Supplier" in the third person.
//
// ── EVERY NUMBER HERE IS COMPUTED, NONE IS TYPED ─────────────────────────────
//
// `buildQuestions(settings)` derives every graded answer AND every distractor from the
// same functions the resolver uses — `payoffTable`, `expectedProfit`, and the demand
// triple itself. Q3's 0.65 is `high[3]`; its wrong options are the other two cells of the
// triple plus P(HIGH). Q4's −1 is the Supplier cell at demand 1, production 3; its wrong
// options are the neighbouring cells. Nothing is transcribed, so nothing can fall out of
// step with the market the students are actually playing.
//
// ⚠ AND IT IS CALLED PER REQUEST, NOT AT MODULE LOAD. `gameDefinition.ts` wires it through
// `prepDefaultsFor`, so all four question functions rebuild the bank from THE INSTANCE'S
// OWN config on every serve and every grade. This is the difference that matters: a bank
// built once at load would encode the DEFAULT table, and an instructor who edits the
// prices or the triple in Settings would get a knowledge check that marks a student wrong
// for reading the payoff table correctly. Nothing would throw. The only symptom would be
// one question the whole class fails.
//
// ── WHAT THIS MODULE MAY IMPORT ──────────────────────────────────────────────
//
// Two layers read this list and they cannot share a dependency:
//   • functions/  builds the GameDefinition from it and serves + grades it.
//   • frontend/   runs the TIER 2 COVERAGE GATE against it (see
//                 frontend/src/reports/tier2Gate.test.ts).
//
// The frontend has no `@mygames/game-server` and never will (it is server-only), so an
// import from there breaks the gate's compile — and the usual "fix" is a hand-copied
// mirror of the question list, which drifts within a week and leaves the gate asserting
// against the copy instead of the questions students see.
//
// `./round/settings` and `./round/resolver` are safe and are the point: both are pure,
// import nothing from `@mygames/*`, and are what the frontend's Information panel already
// imports for the very same table. Structural types, zero platform imports.
// `gameDefinition.ts` asserts the result satisfies `PrepTextQuestion[]`, which is where
// the real type check happens.
//
// ── THE FOUR TRAPS THIS FILE IS SHAPED TO AVOID ──────────────────────────────
//
// 1. THE MISSING PER-QUESTION GRADER. A knowledge check needs BOTH
//    `submitKnowledgeCheck` (the whole set) AND `submitStaticKnowledgeCheckQuestion`
//    (one question, graded on the spot). Wire only the first and the KC RENDERS
//    PERFECTLY and then throws "not a valid graded KC question" on submit — after the
//    student has answered. Both are wired in index.ts from the first commit.
//
// 2. THE WRONG FREE-TEXT FORMAT. `format: 'text'`. NOT 'open_response' — that value
//    renders fine and then reports NOTHING, because it is not what the render path
//    expects. A free-text question that produces no report is the exact failure the
//    Tier 2 gate exists to prevent, so getting it wrong here defeats the gate too.
//
// 3. GRADING BY LETTER. `correct_value` names an option's `value`, never 'B' and
//    never a position. Options are SHUFFLED per student, so a position-keyed answer
//    key grades a different question for every student. For the same reason no
//    explanation may say "option B" or "the second choice" — and for the same reason
//    every option `value` below is a STABLE SYMBOL, never a formatted number: two
//    config values that happen to be equal would otherwise collide into one option.
//
// 4. A KC QUESTION MISTAKEN FOR A TIER 2 REPORT. `category: 'knowledge_check'` is
//    excluded from Tier 2 by design — there is no free-text item analysis. Only
//    'preparation' and 'debrief' questions generate reports.
// ═══════════════════════════════════════════════════════════════════════════════

/** Structural mirror of game-server's `PrepTextQuestion`. Kept platform-import-free. */
export interface Question {
  field: string
  type: 'text' | 'number' | 'mc' | 'likert'
  system: boolean
  prompt: string
  placeholder: string
  order: number
  hidden: boolean
  deletable: boolean
  options?: { value: string; label: string }[]
  category: 'knowledge_check' | 'preparation' | 'debrief'
  format: 'multiple_choice' | 'number' | 'text' | 'likert'
  grading?: 'static' | 'assigned_role'
  correct_value?: string
  role_target: string
  explanation?: string
}

// ── formatting the derived numbers ─────────────────────────────────────────────

/**
 * A probability, always two decimals — `0.50`, not `0.5`.
 *
 * The settings step is 0.01, so two decimals is exact rather than rounded, and a fixed
 * width is what makes four probability options read as one set of comparable numbers.
 */
const prob = (p: number): string => p.toFixed(2)

/**
 * A profit. Typographic minus (−), not the hyphen: these sit next to the payoff table on
 * the Information panel and a hyphen there reads as a dash.
 *
 * Rounded to two decimals to shed IEEE dust — 2 × 0.65 − 3 is not exactly −1.7 in binary —
 * then trimmed, so whole-number defaults print as `3` rather than `3.00`.
 */
const profit = (n: number): string => {
  const r = Math.round(n * 100) / 100
  return (Object.is(r, -0) ? 0 : r) < 0 ? `−${Math.abs(r)}` : String(r)
}

/** Lots, singular-aware: `1 lot`, `3 lots`. */
const lots = (n: number): string => `${n} lot${n === 1 ? '' : 's'}`

/** The largest production/demand level in the domain. Never the literal 3. */
const maxLots = (): Lots => LOTS[LOTS.length - 1]

/**
 * Distractors, de-duplicated BY LABEL against the correct answer and each other.
 *
 * ⚠ THIS IS NOT TIDINESS. Every option is derived, so a config where two derived values
 * coincide — P(3 lots) and P(HIGH) both 0.50, say — would put the same number on screen
 * twice with only one of them graded correct. A student picking the "wrong" identical
 * option would be marked wrong for choosing the right number. Dropping the duplicate
 * leaves a shorter question, which is honest; keeping it leaves an unanswerable one.
 */
const distinct = (
  correct: { value: string; label: string },
  distractors: { value: string; label: string }[],
): { value: string; label: string }[] => {
  const seen = new Set([correct.label])
  const out = [correct]
  for (const d of distractors) {
    if (seen.has(d.label)) continue
    seen.add(d.label)
    out.push(d)
  }
  return out
}

// ── question helpers ───────────────────────────────────────────────────────────

/**
 * Graded multiple-choice helper.
 *
 * Every graded question is built through this rather than hand-written inline: the
 * per-game defaults document has to stay small, and a helper is the only thing that
 * keeps seven questions from becoming seven slightly different literals.
 */
const gq = (
  field: string, order: number, correct_value: string,
  prompt: string, options: { value: string; label: string }[], explanation: string,
): Question => ({
  field, type: 'mc', system: false, category: 'knowledge_check', format: 'multiple_choice',
  grading: 'static', correct_value, role_target: 'all', prompt,
  placeholder: '', order, hidden: false, deletable: false, options, explanation,
})

/** Free-text helper. `format: 'text'` — see trap 2 above. */
const freeText = (
  field: string, order: number, category: 'preparation' | 'debrief',
  prompt: string, placeholder = '',
): Question => ({
  field, type: 'text', system: false, category, format: 'text',
  role_target: 'all', prompt, placeholder, order,
  hidden: false, deletable: false,
})

// ── Q1: the gate ───────────────────────────────────────────────────────────────

/**
 * THE LATE-ASSIGNMENT GATE. Ungraded, and it exists to stop a student answering the
 * knowledge check for a role they do not have.
 *
 * `grading: 'assigned_role'` marks it correct iff the submitted value equals the
 * participant's role. This game assigns SEAT roles late — a group is N interchangeable
 * seats until play begins — so at knowledge-check time the honest answer is the single
 * MATCHING role key, `player`.
 *
 * ⚠ THE WORDING IS FIXED FOR THIS FAMILY: "It can be either — I will find out when the
 * game starts." A game whose roles are known up front uses the single-option gate instead;
 * do not mix the two. The distractors are honest but are NOT role keys, so a wrong pick
 * bounces back for a retry rather than silently passing.
 */
export const GATE_QUESTION: Question = {
  field: 'kc_gate_role', type: 'mc', system: true,
  category: 'knowledge_check', format: 'multiple_choice',
  grading: 'assigned_role', role_target: 'all',
  prompt: 'Which role will you play in this game?',
  placeholder: '', order: 0, hidden: false, deletable: false,
  options: [
    { value: 'retailer_only', label: 'Retailer' },
    { value: 'supplier_only', label: 'Supplier' },
    { value: 'player', label: 'It can be either — I will find out when the game starts' },
  ],
  explanation:
    'Roles are assigned when the game begins, so you cannot know yours yet. The rules are ' +
    'the same either way, and everything in this check applies to both roles. You will be ' +
    'told which one you are on the first screen of the game.',
}

// ── Q2–Q8: the graded seven ────────────────────────────────────────────────────

/**
 * The seven graded questions, derived from `s`.
 *
 * Q2, Q7 and Q8 are STRUCTURAL — they ask about the rules of the stage (is the message
 * binding, what is visible when, what is revealed afterwards) and have no config
 * dependence at all. Q3, Q4, Q5 and Q6 are numerical and every option in them is computed.
 * The split is stated per question so a later editor can see which is which.
 */
export function buildGradedQuestions(s: RoundSettings): Question[] {
  const q3 = maxLots()
  const table = payoffTable(s)
  const high = profileFor('HIGH', s)

  // Q6's two figures, and the sign test that picks its answer.
  const eHigh = expectedProfit('HIGH', q3, s).supplier
  const eLow  = expectedProfit('LOW',  q3, s).supplier
  const riskAnswer =
    eHigh < 0 && eLow < 0 ? 'both'
    : eLow  < 0           ? 'low_only'
    : eHigh < 0           ? 'high_only'
    :                       'neither'

  /*
    Q5's answer, SOLVED rather than assumed. `Retailer = margin × min(D, q)` is weakly
    increasing in q for every D, so with a positive margin the largest production wins
    under BOTH demand types — but that is a consequence of the prices, not a rule, and a
    zero margin makes the Retailer indifferent. So the argmax is computed per type and the
    answer is the level both types agree on, uniquely, or "it depends" when there is none.
  */
  const argmax = (type: 'HIGH' | 'LOW'): Set<number> => {
    const scored = LOTS.map((q) => expectedProfit(type, q, s).retailer)
    const best = Math.max(...scored)
    return new Set(LOTS.filter((_, i) => scored[i] === best))
  }
  const agreed = [...argmax('HIGH')].filter((q) => argmax('LOW').has(q))
  const prefersAnswer = agreed.length === 1 ? `always_${agreed[0]}` : 'depends_on_type'

  return [
    // ── Q2 (structural) ──────────────────────────────────────────────────────
    gq('kc_message_binding', 1, 'not_binding',
      'Each round, the Retailer sends the Supplier a message about the demand type. ' +
      'Must that message be truthful?',
      [
        { value: 'not_binding', label: 'No — the Retailer may report either demand type, whatever the truth is' },
        { value: 'must_match', label: 'Yes — the game only allows the Retailer to report the true demand type' },
        { value: 'first_round_only', label: 'Yes, but only in the first round' },
        { value: 'high_only', label: 'The Retailer may only send a message when the demand type is HIGH' },
      ],
      'The message is not binding and is not checked. The Retailer may report either type ' +
      'in any round, regardless of what the actual type is. What the message is worth is ' +
      'the question the game is really asking.'),

    // ── Q3 (derived: the demand triple, all four cells) ──────────────────────
    gq('kc_demand_odds', 2, 'p_lots_max',
      `If the demand type in a round is HIGH, what is the probability that actual ` +
      `customer demand is ${lots(q3)}?`,
      distinct(
        { value: 'p_lots_max', label: prob(high[q3]) },
        [
          { value: 'p_lots_mid', label: prob(high[2]) },
          { value: 'p_lots_min', label: prob(high[1]) },
          { value: 'p_high',     label: prob(s.pHigh) },
        ],
      ),
      `Under the HIGH demand type the chance of ${lots(q3)} is ${prob(high[q3])} — that is ` +
      `what makes the type "high." Under the LOW type the same ${prob(high[q3])} sits on ` +
      `${lots(1)} instead. The demand type does not fix the demand; it tips the odds.`),

    // ── Q4 (derived: four cells of the payoff table) ─────────────────────────
    gq('kc_payoff_cell', 3, 'cell_d1_qmax',
      `The Supplier produces ${lots(q3)} and actual customer demand turns out to be ` +
      `${lots(1)}. What is the Supplier's profit for that round?`,
      distinct(
        { value: 'cell_d1_qmax', label: profit(table[1][q3].supplier) },
        [
          { value: 'cell_d1_q2',   label: profit(table[1][2].supplier) },
          { value: 'cell_d1_q1',   label: profit(table[1][1].supplier) },
          { value: 'cell_dmax_qmax', label: profit(table[q3][q3].supplier) },
        ],
      ),
      `The Supplier sells only what customers buy — ${lots(1)} — and earns ` +
      `${profit(s.wholesalePrice)} on it, but pays ${profit(s.unitCost)} for each of the ` +
      `${lots(q3)} produced. That is ${profit(s.wholesalePrice)} − ${profit(s.unitCost * q3)}, ` +
      `leaving ${profit(table[1][q3].supplier)}. Unsold production is the Supplier's ` +
      `problem alone; it costs the Retailer nothing.`),

    // ── Q5 (derived: the Retailer's argmax under both types) ─────────────────
    gq('kc_retailer_prefers', 4, prefersAnswer,
      'Ignoring the demand type entirely, which production level gives the Retailer the ' +
      'highest profit?',
      [
        ...LOTS.map((q) => ({ value: `always_${q}`, label: `${lots(q)}, always` })),
        { value: 'depends_on_type', label: 'It depends on the demand type' },
      ],
      'The Retailer earns a fixed margin on every lot sold and pays none of the production ' +
      'cost. Sales can never exceed production, so more production is never worse for the ' +
      'Retailer and is sometimes better — under either demand type. This is the pressure at ' +
      'the heart of the game: the Retailer always has a reason to want the Supplier to ' +
      'produce more.'),

    // ── Q6 (derived: expected Supplier profit at max production, per type) ───
    gq('kc_supplier_risk', 5, riskAnswer,
      // No markdown emphasis on "negative" — the prompt renders as plain text, so the
      // asterisks the source document uses would appear on screen.
      `Under which demand type does producing ${lots(q3)} give the Supplier a NEGATIVE ` +
      `expected profit?`,
      [
        { value: 'low_only',  label: 'LOW only' },
        { value: 'high_only', label: 'HIGH only' },
        { value: 'both',      label: 'Both types' },
        { value: 'neither',   label: 'Neither type' },
      ],
      `Under LOW, ${lots(q3)} earns an expected ${profit(eLow)} — demand is usually ` +
      `${lots(1)}, so the rest is usually wasted. Under HIGH the same choice earns an ` +
      `expected ${profit(eHigh)}. Producing ${q3} is the best thing the Supplier can do ` +
      `under one type and the worst under the other, which is exactly why the Supplier ` +
      `cares what the Retailer's message means.`),

    // ── Q7 (structural: the stage visibility rules) ──────────────────────────
    gq('kc_supplier_info', 6, 'report_only',
      'At the moment the Supplier chooses production, what does the Supplier know about ' +
      'the demand type for that round?',
      [
        { value: 'report_only', label: 'Only what the Retailer reported' },
        { value: 'true_type',   label: 'The true demand type' },
        { value: 'both',        label: 'Both the true demand type and the Retailer\'s report' },
        { value: 'nothing',     label: 'Nothing at all, not even a report' },
      ],
      'The Supplier sees the Retailer\'s message and nothing else. The true demand type ' +
      'for the round is not shown to the Supplier before the production decision — if it ' +
      'were, the message would be worthless and there would be no game.'),

    /*
      ── Q8 (structural: the reveal rules and the shared history table) ────────

      ⚠ THE MOST IMPORTANT QUESTION IN THE CHECK. A student who thinks lies go undetected
      is playing a different game from the one in front of them.
    */
    gq('kc_after_round', 7, 'everything',
      'After a round has finished, what does the Supplier learn?',
      [
        { value: 'everything', label: 'The true demand type, the actual demand, the message, the production, and both profits' },
        { value: 'no_type',    label: 'Only the actual demand and both profits — the true demand type is never revealed' },
        { value: 'own_profit', label: 'Only the Supplier\'s own profit' },
        { value: 'nothing',    label: 'Nothing until the very end of the game' },
      ],
      'Everything about a finished round is shown to both players, including the true ' +
      'demand type. So the Supplier can always compare what was reported with what was ' +
      'true — a message that was not honest is visible one round later, and it stays ' +
      'visible in the history table for the rest of the game.'),
  ]
}

// ── Q9: the debrief (Tier 2 reports are derived from these) ────────────────────

/**
 * ⚠ EVERY QUESTION IN THIS LIST MUST HAVE A TIER 2 REPORT, and the test suite refuses
 * to pass otherwise. Adding one here without adding its id to `TIER2_REPORT_IDS`
 * (frontend/src/reports/reportIds.ts) fails the gate by name. That is the point: the
 * gate is a red test in this repo, not a line in a checklist somebody skips.
 */
export const FREE_TEXT_QUESTIONS: Question[] = [
  // ⚠ VERBATIM from Information_Sharing_KC_Questions_v1.md Q9. Not a paraphrase — this
  // is the prompt Elena reads answers to when building the 9/28 lecture, and the Tier 2
  // report is grouped by role because Retailer and Supplier answers read very
  // differently.
  freeText('debrief_reflection', 20, 'debrief',
    'As the Retailer, when did you report the demand type honestly and when didn\'t you — ' +
    'and why? As the Supplier, when did you believe the message and when did you stop? ' +
    'Describe one specific round where something that happened earlier in the game ' +
    'changed what you did.',
    'There are no wrong answers here. A short paragraph is enough. Write about what you ' +
    'actually did rather than what you think you should have done.'),
]

// ── the whole bank ─────────────────────────────────────────────────────────────

/**
 * The bank for one instance, in the order the platform serves it.
 *
 * The KC score denominator is COUNTED, not hardcoded: the shared grader counts
 * `grading: 'static'` questions at run time. Adding or removing one changes the
 * denominator automatically, and no "/7" anywhere needs updating. Do not reintroduce
 * a literal denominator — every game that had one eventually shipped a wrong score.
 */
export function buildQuestions(s: RoundSettings): Question[] {
  return [GATE_QUESTION, ...buildGradedQuestions(s), ...FREE_TEXT_QUESTIONS]
}

/**
 * The bank at the DEFAULT market — for the Tier 2 coverage gate and anything else that
 * needs the shape rather than an instance's numbers.
 *
 * ⚠ NOT WHAT THE PLATFORM SERVES. `gameDefinition.ts` wires `prepDefaultsFor` so the live
 * paths rebuild from the instance's own config; this constant exists so a caller with no
 * config in hand still gets a valid bank, and it is also what `prepDefaults` falls back to.
 */
export const ALL_QUESTIONS: Question[] = buildQuestions(DEFAULT_ROUND_SETTINGS)
