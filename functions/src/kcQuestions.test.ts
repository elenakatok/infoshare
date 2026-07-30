import { describe, it, expect } from 'vitest'
import { buildQuestions, ALL_QUESTIONS, GATE_QUESTION } from './kcQuestions'
import { DEFAULT_ROUND_SETTINGS, type RoundSettings } from './round/settings'
import { infoshareGameDef } from './gameDefinition'
import { CONFIG_KEYS } from './round/settings'

// ═══════════════════════════════════════════════════════════════════════════════
// THE KNOWLEDGE CHECK, AND WHETHER ITS DERIVATION IS REAL.
//
// ⚠ THE FAILURE THIS FILE EXISTS FOR CANNOT BE SEEN BY READING THE QUESTIONS. A bank
// whose numbers were typed by hand and a bank whose numbers are computed look IDENTICAL
// at the default market — same 0.65, same −1, same options in the same order. They differ
// only when the market moves, which in a classroom means: the instructor edited a price in
// Settings, and the check is now grading a student wrong for reading the payoff table
// correctly. Nothing throws.
//
// So the derivation is not asserted by checking the default values. It is asserted by
// MOVING THE MARKET and requiring every derived answer and distractor to move with it.
// Every "pins the default" test below is paired with one that changes the settings.
// ═══════════════════════════════════════════════════════════════════════════════

const q = (questions: ReturnType<typeof buildQuestions>, field: string) => {
  const found = questions.find((x) => x.field === field)
  if (!found) throw new Error(`no question '${field}'`)
  return found
}

/** The label of a question's correct option — what the student actually reads. */
const correctLabel = (questions: ReturnType<typeof buildQuestions>, field: string) => {
  const question = q(questions, field)
  return question.options?.find((o) => o.value === question.correct_value)?.label
}

const labels = (questions: ReturnType<typeof buildQuestions>, field: string) =>
  (q(questions, field).options ?? []).map((o) => o.label)

const DEFAULTS = buildQuestions(DEFAULT_ROUND_SETTINGS)

// ── the shape the spec locks ───────────────────────────────────────────────────

describe('the question set (Information_Sharing_KC_Questions_v1)', () => {
  it('is one gate, seven graded questions and one debrief paragraph', () => {
    const graded = DEFAULTS.filter((x) => x.grading === 'static')
    expect(graded).toHaveLength(7)
    expect(DEFAULTS.filter((x) => x.grading === 'assigned_role')).toHaveLength(1)
    expect(DEFAULTS.filter((x) => x.category === 'debrief')).toHaveLength(1)
  })

  it('is NOT role-split — every question targets everyone, one denominator of seven', () => {
    // Roles are assigned late, so no question may be addressed to a role the student does
    // not yet have. A single role_target is also what makes the denominator identical for
    // every student without anything hardcoding a 7.
    for (const x of DEFAULTS) expect(x.role_target).toBe('all')
  })

  it('the gate is ungraded and its honest answer is the MATCHING role key', () => {
    // 'assigned_role' grades the submission against participants/{id}.role, which is
    // `player` for everyone until the round loop hands out seats.
    expect(GATE_QUESTION.grading).toBe('assigned_role')
    expect(GATE_QUESTION.correct_value).toBeUndefined()
    expect(GATE_QUESTION.options?.map((o) => o.value)).toContain('player')
    expect(GATE_QUESTION.prompt).toBe('Which role will you play in this game?')
  })

  it('the debrief is format "text" — NOT "open_response"', () => {
    // 'open_response' is not a runtime value: it renders fine and reports NOTHING, which
    // is the worst failure shape there is — a Tier 2 report that is silently empty.
    const debrief = DEFAULTS.filter((x) => x.category === 'debrief')
    for (const x of debrief) expect(x.format).toBe('text')
    expect(debrief[0].field).toBe('debrief_reflection')
  })

  it('every graded question is answerable: the key names one of its own options', () => {
    for (const x of DEFAULTS.filter((g) => g.grading === 'static')) {
      const values = (x.options ?? []).map((o) => o.value)
      expect(values, `${x.field} options`).toContain(x.correct_value)
      // Two options carrying the same text would make one of them wrong for the right
      // reason. Derived options can collide; `distinct` is what prevents it.
      const texts = (x.options ?? []).map((o) => o.label)
      expect(new Set(texts).size, `${x.field} has a duplicate option label`).toBe(texts.length)
      expect(texts.length, `${x.field} needs at least two options`).toBeGreaterThan(1)
    }
  })

  it('no explanation refers to an answer by letter or position', () => {
    // Options are shuffled per student, so "option B" names a different answer for
    // everybody. Explanations must name the value or the concept.
    for (const x of DEFAULTS) {
      if (!x.explanation) continue
      expect(x.explanation, x.field).not.toMatch(/\boption [A-D]\b|\b(first|second|third|fourth) (choice|option|answer)\b/i)
    }
  })
})

// ── the derivation, proved by moving the market ────────────────────────────────

describe('Q3 — the demand triple, correct answer AND distractors', () => {
  it('at the default triple the answer is 0.65 and the wrong options are the other cells', () => {
    expect(correctLabel(DEFAULTS, 'kc_demand_odds')).toBe('0.65')
    expect(labels(DEFAULTS, 'kc_demand_odds').sort()).toEqual(['0.02', '0.33', '0.50', '0.65'])
  })

  it('EVERY option follows the triple when the triple is edited', () => {
    const edited: RoundSettings = {
      ...DEFAULT_ROUND_SETTINGS,
      high: { 1: 0.05, 2: 0.25, 3: 0.70 },
      pHigh: 0.4,
    }
    const questions = buildQuestions(edited)
    expect(correctLabel(questions, 'kc_demand_odds')).toBe('0.70')
    // The distractors are the other two cells of the triple plus P(HIGH) — all moved.
    expect(labels(questions, 'kc_demand_odds').sort()).toEqual(['0.05', '0.25', '0.40', '0.70'])
    expect(labels(questions, 'kc_demand_odds')).not.toContain('0.65')
  })

  it('drops a distractor that collides with the correct answer rather than showing it twice', () => {
    // P(3 lots) = P(HIGH) = 0.50. Two identical options with one graded correct would mark
    // a student wrong for picking the right number.
    const collide: RoundSettings = {
      ...DEFAULT_ROUND_SETTINGS,
      high: { 1: 0.20, 2: 0.30, 3: 0.50 },
      pHigh: 0.5,
    }
    const opts = labels(buildQuestions(collide), 'kc_demand_odds')
    expect(opts).toEqual(['0.50', '0.30', '0.20'])
    expect(new Set(opts).size).toBe(opts.length)
  })

  it('the explanation quotes the derived probability, not a remembered one', () => {
    const edited = { ...DEFAULT_ROUND_SETTINGS, high: { 1: 0.05, 2: 0.25, 3: 0.70 } }
    const ex = q(buildQuestions(edited), 'kc_demand_odds').explanation ?? ''
    expect(ex).toContain('0.70')
    expect(ex).not.toContain('0.65')
  })
})

describe('Q4 — the payoff table cell', () => {
  it('at the default prices the answer is −1 and the options are the neighbouring cells', () => {
    expect(correctLabel(DEFAULTS, 'kc_payoff_cell')).toBe('−1')
    expect(labels(DEFAULTS, 'kc_payoff_cell').sort()).toEqual(['0', '1', '3', '−1'])
  })

  it('the answer follows a price change in Settings', () => {
    // Wholesale 2 → 4: the Supplier now earns 4 on the one lot sold and still pays 3 for
    // three lots, so the loss becomes a profit of 1. A hand-typed −1 would grade this wrong.
    const questions = buildQuestions({ ...DEFAULT_ROUND_SETTINGS, wholesalePrice: 4 })
    expect(correctLabel(questions, 'kc_payoff_cell')).toBe('1')
    expect(q(questions, 'kc_payoff_cell').explanation).toContain('1')
  })

  it('the answer follows a unit-cost change too', () => {
    // Cost 1 → 2: 2 earned on one lot, 6 paid for three.
    const questions = buildQuestions({ ...DEFAULT_ROUND_SETTINGS, unitCost: 2 })
    expect(correctLabel(questions, 'kc_payoff_cell')).toBe('−4')
  })
})

describe('Q5 — which production the Retailer wants', () => {
  it('solves for the answer rather than asserting "3 lots"', () => {
    expect(correctLabel(DEFAULTS, 'kc_retailer_prefers')).toBe('3 lots, always')
  })

  it('still resolves to the largest production when the margin narrows', () => {
    const questions = buildQuestions({ ...DEFAULT_ROUND_SETTINGS, retailPrice: 2.5 })
    expect(correctLabel(questions, 'kc_retailer_prefers')).toBe('3 lots, always')
  })

  it('falls back to "it depends" when a zero margin makes the Retailer indifferent', () => {
    // retailPrice === wholesalePrice is permitted by validateSettings, and then no
    // production level gives a higher profit than any other. Better to say so than to
    // keep insisting on a number.
    const questions = buildQuestions({ ...DEFAULT_ROUND_SETTINGS, retailPrice: 2 })
    expect(q(questions, 'kc_retailer_prefers').correct_value).toBe('depends_on_type')
  })
})

describe('Q6 — where the Supplier\'s risk lives', () => {
  it('at the default market, producing the maximum loses money under LOW only', () => {
    expect(q(DEFAULTS, 'kc_supplier_risk').correct_value).toBe('low_only')
    // Both figures in the explanation are expected profits, computed.
    expect(q(DEFAULTS, 'kc_supplier_risk').explanation).toContain('−0.26')
    expect(q(DEFAULTS, 'kc_supplier_risk').explanation).toContain('2.26')
  })

  it('re-signs when the cost makes maximum production a loss under BOTH types', () => {
    const questions = buildQuestions({ ...DEFAULT_ROUND_SETTINGS, unitCost: 2 })
    expect(q(questions, 'kc_supplier_risk').correct_value).toBe('both')
  })

  it('re-signs the other way when production is cheap enough to be safe under both', () => {
    const questions = buildQuestions({ ...DEFAULT_ROUND_SETTINGS, unitCost: 0.1 })
    expect(q(questions, 'kc_supplier_risk').correct_value).toBe('neither')
  })
})

describe('Q2, Q7, Q8 — the structural three', () => {
  it('do not move when the market moves, because they are about the rules', () => {
    const moved = buildQuestions({
      ...DEFAULT_ROUND_SETTINGS,
      high: { 1: 0.05, 2: 0.25, 3: 0.70 }, wholesalePrice: 4, unitCost: 2,
    })
    for (const field of ['kc_message_binding', 'kc_supplier_info', 'kc_after_round']) {
      expect(q(moved, field)).toEqual(q(DEFAULTS, field))
    }
  })

  it('Q8 keeps the true demand type in its correct answer — the one that teaches the game', () => {
    // A student who thinks lies go undetected is playing a different game. The reveal is
    // the whole reason a reputation forms across ten rounds.
    expect(correctLabel(DEFAULTS, 'kc_after_round')).toContain('true demand type')
  })
})

// ── the wiring, which is the other half of "never grades stale" ────────────────

describe('the game definition serves the DERIVED bank', () => {
  it('declares prepDefaultsFor, so all four question functions rebuild per instance', () => {
    // Without this the four shared factories read the static prepDefaults — built at
    // module load, from the DEFAULT market — and every test above becomes decorative.
    expect(typeof infoshareGameDef.prepDefaultsFor).toBe('function')
  })

  it('a stored config edit reaches the answer key through prepDefaultsFor', () => {
    // The end-to-end property, at the seam the platform actually calls: instance config in,
    // moved answer key out.
    const served = infoshareGameDef.prepDefaultsFor!({ [CONFIG_KEYS.p3]: 0.70, [CONFIG_KEYS.p2]: 0.25, [CONFIG_KEYS.p1]: 0.05 })
    const question = served.find((x) => x.field === 'kc_demand_odds')!
    expect(question.options?.find((o) => o.value === question.correct_value)?.label).toBe('0.70')
  })

  it('an INVALID stored triple falls back whole, and the KC grades the fallback', () => {
    // settingsFromConfig rejects a half-edited distribution wholesale rather than drawing
    // from it. The KC must agree with whatever the round loop will actually use.
    const served = infoshareGameDef.prepDefaultsFor!({ [CONFIG_KEYS.p3]: 0.9, [CONFIG_KEYS.p2]: 0.9, [CONFIG_KEYS.p1]: 0.9 })
    const question = served.find((x) => x.field === 'kc_demand_odds')!
    expect(question.options?.find((o) => o.value === question.correct_value)?.label).toBe('0.65')
  })

  it('prepDefaults (the no-config fallback) is the bank at the default market', () => {
    expect(infoshareGameDef.prepDefaults).toEqual(ALL_QUESTIONS)
  })
})
