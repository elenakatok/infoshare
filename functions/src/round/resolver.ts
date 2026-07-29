// ═══════════════════════════════════════════════════════════════════════════════
// INFORMATION SHARING — the payoff function and everything derived from it (spec §3).
//
// ⚠ PURE, AND DETERMINISTIC. No firebase, no Date, no Math.random, no reads of anything
// outside the arguments. The engine's `ResolveInput` carries no rng and never will
// (extraction spec §3.5.1): every draw happens at ROUND OPEN, so resolution is a
// function of state alone and a replay of a class reproduces it exactly.
//
// ── NOTHING BELOW IS TYPED AS A LITERAL ──────────────────────────────────────
// The payoff table, the expected profits and the babbling-versus-credible comparison are
// all COMPUTED from settings. That is what lets the knowledge check and the Information
// panel be generated rather than transcribed — spec §8 requires the KC to be derivable
// so it can never grade against a stale config, and §1.4 requires the panel to be inline
// SVG computed from config because a PNG becomes a lie the moment the triple is edited.
//
// If you find yourself about to write `0.65` or `1.96` in this file, that is the bug.
// ═══════════════════════════════════════════════════════════════════════════════

import {
  LOTS, DEMAND_TYPES, profileFor,
  type DemandType, type Lots, type RoundSettings,
} from './settings'

export interface RoundInput {
  /** The Retailer's message. FREE — it need not match `demandType` (spec §1.2). */
  message: DemandType
  /** The Supplier's committed production, in lots. */
  production: Lots
  /** The truth the Retailer saw and the Supplier did not. */
  demandType: DemandType
  /** Actual demand in lots, drawn from `demandType`'s profile at round open. */
  actualDemand: Lots
}

export interface RoundOutcome {
  message: DemandType
  production: Lots
  demandType: DemandType
  actualDemand: Lots
  /** min(actual demand, production) — what actually changes hands. */
  sales: number
  profits: { retailer: number; supplier: number }
  /** Did the message match the truth? Drives the Tier-3 signature chart (§10). */
  truthful: boolean
}

// ── the payoff, in one place ───────────────────────────────────────────────────

/** Sales = min(actual demand, production). The whole coupling between the two sides. */
export const salesOf = (actualDemand: number, production: number): number =>
  Math.min(actualDemand, production)

/**
 * Retailer = (retailPrice − wholesalePrice) × Sales.
 *
 * ⚠ NOTE WHAT IS ABSENT: demand TYPE. The Retailer's profit does not depend on it at
 * all, only on min(D, q) — so the Retailer always prefers a larger production and always
 * has a reason to report HIGH (spec §3.1). The Supplier knows this. Whether the message
 * means anything is the entire game, and it starts here.
 */
export const retailerProfit = (sales: number, s: RoundSettings): number =>
  (s.retailPrice - s.wholesalePrice) * sales

/** Supplier = wholesalePrice × Sales − unitCost × production. Unsold lots are sunk. */
export const supplierProfit = (sales: number, production: number, s: RoundSettings): number =>
  s.wholesalePrice * sales - s.unitCost * production

export function resolveRound(input: RoundInput, s: RoundSettings): RoundOutcome {
  const sales = salesOf(input.actualDemand, input.production)
  return {
    message: input.message,
    production: input.production,
    demandType: input.demandType,
    actualDemand: input.actualDemand,
    sales,
    profits: {
      retailer: retailerProfit(sales, s),
      supplier: supplierProfit(sales, input.production, s),
    },
    truthful: input.message === input.demandType,
  }
}

/** Legality of a production choice (spec §3, §13: three segmented buttons, not a field). */
export function validateProduction(
  production: unknown, s: RoundSettings,
): { ok: true } | { ok: false; reason: string } {
  void s
  if (!Number.isInteger(production) || !LOTS.includes(production as Lots)) {
    return { ok: false, reason: `Choose a production of ${LOTS.join(', ')} lots.` }
  }
  return { ok: true }
}

export function validateMessage(
  message: unknown,
): { ok: true } | { ok: false; reason: string } {
  if (typeof message !== 'string' || !DEMAND_TYPES.includes(message as DemandType)) {
    return { ok: false, reason: `Your message must be ${DEMAND_TYPES.join(' or ')}.` }
  }
  return { ok: true }
}

// ═══════════════════════════════════════════════════════════════════════════════
// DERIVED TEACHING VALUES — computed for the KC (§8) and the Information panel (§1.4).
// ═══════════════════════════════════════════════════════════════════════════════

export interface PayoffCell { retailer: number; supplier: number }
/** demand (rows) × production (columns). */
export type PayoffTable = Record<Lots, Record<Lots, PayoffCell>>

/**
 * The full 3×3 table (spec §3). Derived from the price settings, never transcribed.
 *
 * With the defaults (3 / 2 / 1) the cell every student is asked about is
 * demand 1, production 3 → Supplier −1: three lots made, one sold, two sunk.
 */
export function payoffTable(s: RoundSettings): PayoffTable {
  const t = {} as PayoffTable
  for (const d of LOTS) {
    t[d] = {} as Record<Lots, PayoffCell>
    for (const q of LOTS) {
      const sales = salesOf(d, q)
      t[d][q] = { retailer: retailerProfit(sales, s), supplier: supplierProfit(sales, q, s) }
    }
  }
  return t
}

/** Expected profit for one production choice under one demand type. */
export function expectedProfit(
  type: DemandType, production: Lots, s: RoundSettings,
): PayoffCell {
  const dist = profileFor(type, s)
  let retailer = 0, supplier = 0
  for (const d of LOTS) {
    const sales = salesOf(d, production)
    retailer += dist[d] * retailerProfit(sales, s)
    supplier += dist[d] * supplierProfit(sales, production, s)
  }
  return { retailer, supplier }
}

export interface ExpectedProfits {
  /** [type][production] → expected profits. */
  byType: Record<DemandType, Record<Lots, PayoffCell>>
  /** Under the pHigh prior — what a Supplier who ignores the message faces. */
  underPrior: Record<Lots, PayoffCell>
}

export function expectedProfits(s: RoundSettings): ExpectedProfits {
  const byType = {} as Record<DemandType, Record<Lots, PayoffCell>>
  for (const type of DEMAND_TYPES) {
    byType[type] = {} as Record<Lots, PayoffCell>
    for (const q of LOTS) byType[type][q] = expectedProfit(type, q, s)
  }
  const underPrior = {} as Record<Lots, PayoffCell>
  for (const q of LOTS) {
    underPrior[q] = {
      retailer: s.pHigh * byType.HIGH[q].retailer + (1 - s.pHigh) * byType.LOW[q].retailer,
      supplier: s.pHigh * byType.HIGH[q].supplier + (1 - s.pHigh) * byType.LOW[q].supplier,
    }
  }
  return { byType, underPrior }
}

export interface Comparison {
  /** The message is ignored; the Supplier plays the prior and produces one quantity. */
  babbling: { production: Lots; retailer: number; supplier: number }
  /** The message is believed: produce 3 on HIGH, 1 on LOW. */
  credible: { retailer: number; supplier: number }
  /** credible − babbling. THE value from collaboration (spec §3.2). */
  gain: { retailer: number; supplier: number }
}

/**
 * Babbling versus credible communication (spec §3.2) — the teaching result, derived.
 *
 * ⚠ THE BABBLING PRODUCTION IS SOLVED FOR, NOT ASSUMED. With the default triple it is 2,
 * and the spec says so — but "produce 2" is a consequence of that triple, not a rule. Flatten
 * the distribution (the study's Value treatment, §3.2) and the best response can move; if
 * it were hard-coded, the panel and the KC would quietly teach the wrong number.
 *
 * `credible` uses the strategy the spec names — 3 on HIGH, 1 on LOW — rather than a
 * per-type argmax. That is deliberate: it is the strategy the debrief discusses, and the
 * gap it produces is the one the lecture opens on.
 */
export function babblingVsCredible(s: RoundSettings): Comparison {
  const e = expectedProfits(s)

  let best: Lots = LOTS[0]
  for (const q of LOTS) if (e.underPrior[q].supplier > e.underPrior[best].supplier) best = q

  const babbling = {
    production: best,
    retailer: e.underPrior[best].retailer,
    supplier: e.underPrior[best].supplier,
  }
  const credible = {
    retailer: s.pHigh * e.byType.HIGH[3].retailer + (1 - s.pHigh) * e.byType.LOW[1].retailer,
    supplier: s.pHigh * e.byType.HIGH[3].supplier + (1 - s.pHigh) * e.byType.LOW[1].supplier,
  }
  return {
    babbling,
    credible,
    gain: {
      retailer: credible.retailer - babbling.retailer,
      supplier: credible.supplier - babbling.supplier,
    },
  }
}
