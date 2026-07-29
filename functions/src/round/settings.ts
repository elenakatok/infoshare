// ═══════════════════════════════════════════════════════════════════════════════
// INFORMATION SHARING — round settings (spec §2, §3, §4).
//
// Every number a payoff, a draw or a legality rule depends on lives HERE. Nothing is a
// literal in spec.ts or resolver.ts, and nothing is hand-entered twice: the knowledge
// check, the payoff table and the Information panel are all DERIVED from these values,
// so none of them can grade or teach against a stale constant.
//
// ── THE ONE EDITABLE TRIPLE (spec §2) ────────────────────────────────────────
// The instructor edits the HIGH profile only — P(1 lot), P(2 lots), P(3 lots). LOW is
// its exact reverse, derived here and never separately editable.
//
// That is not a convenience. Two independently editable profiles CAN be made
// asymmetric, and an asymmetric pair silently breaks the symmetry the teaching result
// rests on — the "value from collaboration" gap in §3.2 assumes the profiles mirror.
// Three fields, not six, makes the broken state unrepresentable. Same rule as PD's
// payoff matrix.
//
// ⚠ NAMING: P(1 lot) / P(2 lots) / P(3 lots), NEVER High/Medium/Low. "High" and "Low"
// are the DEMAND TYPE. A settings field called "High" sitting next to a demand type
// called HIGH is a collision waiting to be misread by whoever edits it next.
//
// ⚠ Anything added here must ALSO be declared in `configFields` in gameDefinition.ts,
// and adding a field means redeploying BOTH getGameConfig AND updateGameConfig — the
// recognised-field list is baked into the deployed bundle, and the symptom of
// forgetting is the misleading "No recognised fields to update" on correct code.
// ═══════════════════════════════════════════════════════════════════════════════

/** The demand type drawn each round. The Retailer sees it; the Supplier does not. */
export type DemandType = 'HIGH' | 'LOW'
export const DEMAND_TYPES: readonly DemandType[] = ['HIGH', 'LOW'] as const

/** Lots. Demand and production share this domain (spec §2, §3). */
export type Lots = 1 | 2 | 3
export const LOTS: readonly Lots[] = [1, 2, 3] as const

/** A distribution over {1,2,3} lots, indexed by lots. */
export interface LotDistribution { 1: number; 2: number; 3: number }

export interface RoundSettings {
  /** P(demand type = HIGH), drawn per group per round, independent (§2). */
  pHigh: number
  /** The HIGH profile. LOW is its reverse — see `lowProfile`. */
  high: LotDistribution
  /** Prices (§3). The Retailer's margin is retailPrice − wholesalePrice. */
  retailPrice: number
  wholesalePrice: number
  unitCost: number
  /** Rounds (§4): fixed, shown, drawn per group. */
  numRounds: number
  /**
   * §7.1 — the Supplier bot's punishment length, in rounds, after being lied to.
   *
   * ⚠ THE ONLY TUNING PARAMETER IN THE BOT PAIR, and deliberately SHORT (1).
   * The punishment is not there to deter a student; it is there to make the
   * consequence of lying VISIBLE inside a ten-round game. A long punishment flattens
   * the truthfulness chart for the rest of the run and teaches nothing round one did
   * not. It is also what makes the pair self-correcting: the Retailer bot resumes
   * telling the truth when it sees 3 after HIGH again, which can only happen because
   * the Supplier re-tests.
   */
  botPunishmentRounds: number
}

export const DEFAULT_ROUND_SETTINGS: RoundSettings = {
  pHigh: 0.5,
  // Spec §2.1: the SoPHIE original's cutoffs actually deliver 0.02 / 0.31 / 0.67, not
  // the advertised 0.02 / 0.33 / 0.65. Elena's decision is to use the ADVERTISED
  // numbers, which makes the classroom control-question answer of 0.65 exactly right
  // rather than approximately right.
  high: { 1: 0.02, 2: 0.33, 3: 0.65 },
  retailPrice: 3,
  wholesalePrice: 2,
  unitCost: 1,
  numRounds: 10,
  botPunishmentRounds: 1,   // k (Elena, 2026-07-28)
}

/**
 * LOW is the exact reverse of HIGH. Derived, never stored, never editable.
 *
 * P_LOW(k) = P_HIGH(4 − k): the mass on 3 lots under HIGH becomes the mass on 1 lot
 * under LOW. With the default triple that is 0.65 / 0.33 / 0.02.
 */
export function lowProfile(high: LotDistribution): LotDistribution {
  return { 1: high[3], 2: high[2], 3: high[1] }
}

/** The distribution for a demand type — the only way either profile is obtained. */
export function profileFor(type: DemandType, s: RoundSettings): LotDistribution {
  return type === 'HIGH' ? s.high : lowProfile(s.high)
}

// ── validation ─────────────────────────────────────────────────────────────────

/**
 * Tolerance on the triple's sum.
 *
 * 1e-9 rather than exact equality: the values arrive as IEEE doubles through a text
 * input, Firestore and JSON, and 0.02 + 0.33 + 0.65 is not exactly 1 in binary floating
 * point. Wide enough for float dust; far too narrow to admit a real typo — 0.02/0.33/0.66
 * is off by 0.01, seven orders of magnitude outside it.
 */
export const SUM_TOLERANCE = 1e-9

export type Validation = { ok: true } | { ok: false; reason: string }

const label = (k: Lots) => `P(${k} lot${k === 1 ? '' : 's'})`

/**
 * The triple must be a probability distribution: each entry in [0,1], summing to 1.
 *
 * ⚠ CHECKED SERVER-SIDE, not only in Settings. `updateGameConfig` is a public callable.
 * A triple that does not sum to 1 throws nowhere — it quietly biases every draw for the
 * rest of the game, and the knowledge check goes on grading against it.
 */
export function validateHighProfile(high: LotDistribution): Validation {
  for (const k of LOTS) {
    const v = high[k]
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      return { ok: false, reason: `${label(k)} must be a number.` }
    }
    if (v < 0 || v > 1) {
      return { ok: false, reason: `${label(k)} must be between 0 and 1 (got ${v}).` }
    }
  }
  const sum = high[1] + high[2] + high[3]
  if (Math.abs(sum - 1) > SUM_TOLERANCE) {
    return {
      ok: false,
      reason: `The three probabilities must add up to 1 — they add up to ${sum.toFixed(4)}. ` +
              'Adjust P(1 lot), P(2 lots) or P(3 lots) so the total is exactly 1.',
    }
  }
  return { ok: true }
}

export function validateSettings(s: RoundSettings): Validation {
  if (!(s.pHigh >= 0 && s.pHigh <= 1)) {
    return { ok: false, reason: `P(HIGH) must be between 0 and 1 (got ${s.pHigh}).` }
  }
  if (s.retailPrice < s.wholesalePrice) {
    // The Retailer's margin would be negative and the game inverts. Better refused than
    // discovered from the payoff table mid-class.
    return { ok: false, reason: 'Retail price must be at least the wholesale price.' }
  }
  if (s.numRounds < 1) return { ok: false, reason: 'There must be at least one round.' }
  // k = 0 would mean "punish for no rounds", i.e. no punishment at all — a silently
  // disabled strategy that still looks configured. Refuse it rather than accept it.
  if (!Number.isInteger(s.botPunishmentRounds) || s.botPunishmentRounds < 1) {
    return { ok: false, reason: 'The bot punishment length must be a whole number of at least 1 round.' }
  }
  return validateHighProfile(s.high)
}

// ── reading instance config ────────────────────────────────────────────────────

/** Config keys, in one place so settings.ts and gameDefinition.ts cannot drift. */
export const CONFIG_KEYS = {
  pHigh: 'p_high',
  p1: 'p_lots_1',
  p2: 'p_lots_2',
  p3: 'p_lots_3',
  retailPrice: 'retail_price',
  wholesalePrice: 'wholesale_price',
  unitCost: 'unit_cost',
  numRounds: 'num_rounds',
  botPunishmentRounds: 'bot_punishment_rounds',
} as const

/**
 * Build settings from the instance's stored config, per field, defaults as the floor.
 * Per-field rather than all-or-nothing: an instance configured before a setting existed
 * keeps working by picking up the new default rather than refusing to load.
 *
 * An INVALID stored triple falls back to the default triple WHOLESALE — a half-edited
 * distribution must never reach a draw. The write validator already rejects one, so this
 * is the belt to that braces.
 */
export function settingsFromConfig(config: Record<string, unknown> | undefined): RoundSettings {
  const num = (key: string, fallback: number): number => {
    const v = config?.[key]
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback
  }
  const d = DEFAULT_ROUND_SETTINGS
  const high: LotDistribution = {
    1: num(CONFIG_KEYS.p1, d.high[1]),
    2: num(CONFIG_KEYS.p2, d.high[2]),
    3: num(CONFIG_KEYS.p3, d.high[3]),
  }
  return {
    pHigh: num(CONFIG_KEYS.pHigh, d.pHigh),
    high: validateHighProfile(high).ok ? high : d.high,
    retailPrice: num(CONFIG_KEYS.retailPrice, d.retailPrice),
    wholesalePrice: num(CONFIG_KEYS.wholesalePrice, d.wholesalePrice),
    unitCost: num(CONFIG_KEYS.unitCost, d.unitCost),
    numRounds: num(CONFIG_KEYS.numRounds, d.numRounds),
    botPunishmentRounds: num(CONFIG_KEYS.botPunishmentRounds, d.botPunishmentRounds),
  }
}
