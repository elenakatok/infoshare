import type { StudentRoundRow } from '../api'

// ═══════════════════════════════════════════════════════════════════════════════
// TRUST AND TRUSTWORTHINESS — the analysis the course is actually about.
//
// Not "average production by round". The question is whether the Retailer told the
// truth, whether the Supplier believed it, and whether those two things travelled
// together. Everything below serves that.
//
// ⚠ DEFAULTED ROUNDS ARE EXCLUDED FROM EVERY SERIES AND EVERY n= (spec §10.1).
// The Retailer's clock default is HIGH, which scores as "truthful" whenever the drawn
// type happens to be HIGH — roughly half the time, by accident. Left in, defaults would
// inflate the true-HIGH trustworthiness line, which is the line the 9/28 lecture opens
// on. A default is a record of absence, not behaviour.
//
// Exclusion is per-ROW here because both seats' actions live on the same row: a round
// where either seat defaulted tells us nothing reliable about either behaviour.
// ═══════════════════════════════════════════════════════════════════════════════

export type Series = { round: number; value: number; n: number }[]

const defaulted = (r: StudentRoundRow) => r.defaulted.retailer || r.defaulted.supplier

/** Every row that represents an actual decision by both seats. */
export const behavioural = (rows: StudentRoundRow[]) => rows.filter((r) => !defaulted(r))

function byRound(rows: StudentRoundRow[], pick: (r: StudentRoundRow) => number | null): Series {
  const acc = new Map<number, { sum: number; n: number }>()
  for (const r of rows) {
    const v = pick(r)
    if (v === null) continue
    const a = acc.get(r.round) ?? { sum: 0, n: 0 }
    a.sum += v; a.n += 1
    acc.set(r.round, a)
  }
  return [...acc.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([round, a]) => ({ round, value: a.sum / a.n, n: a.n }))
}

// ── A. TRUSTWORTHINESS — the Retailer's behaviour ──────────────────────────────

/**
 * Proportion of reports matching the TRUE type, split by what the truth WAS.
 *
 * ⚠ TWO SERIES, AND THE SPLIT IS THE WHOLE POINT — not a formatting choice. A Retailer
 * never has a reason to misreport when the truth is HIGH (they always prefer production
 * 3, so HIGH is both truthful and self-interested). That line therefore sits near 1.0
 * and is nearly meaningless on its own. ALL the behaviour is in the LOW line, where
 * telling the truth costs something.
 *
 * A single combined line averages the two together and hides exactly that asymmetry —
 * students would be told about it instead of seeing it.
 */
export function trustworthiness(rows: StudentRoundRow[]) {
  const b = behavioural(rows)
  return {
    trueHigh: byRound(b, (r) => (r.demandType === 'HIGH' ? (r.truthful ? 1 : 0) : null)),
    trueLow: byRound(b, (r) => (r.demandType === 'LOW' ? (r.truthful ? 1 : 0) : null)),
  }
}

// ── B. TRUST — the Supplier's behaviour ────────────────────────────────────────

/**
 * Average production after each kind of report. Two series.
 *
 * Keyed on the MESSAGE, not the truth: this is what the Supplier saw when they decided.
 * The gap between the two lines is belief — a Supplier who ignores messages produces the
 * same amount either way and the lines converge.
 */
export function trust(rows: StudentRoundRow[]) {
  const b = behavioural(rows)
  return {
    afterHigh: byRound(b, (r) => (r.message === 'HIGH' ? r.production : null)),
    afterLow: byRound(b, (r) => (r.message === 'LOW' ? r.production : null)),
  }
}

// ── C. RECIPROCITY — one dot per pair ──────────────────────────────────────────

export interface PairPoint {
  groupId: string
  groupNumber: number
  /** Share of TRUE-LOW rounds this Retailer reported honestly. null if none occurred. */
  truthAboutLow: number | null
  /** This Supplier's average production after a LOW report. null if none received. */
  productionAfterLow: number | null
  lowRounds: number
  lowReports: number
}

/**
 * Honesty against belief, one point per pair.
 *
 * In a two-person repeated game this single picture answers the question the whole
 * session is about: did trustworthiness and trust travel together? A cloud with no
 * relationship says the message never mattered; an upward drift says it did.
 *
 * Both axes are LOW-conditioned, because that is where the game happens (see the note on
 * `trustworthiness`). A pair with no true-LOW rounds has nothing to say and is carried as
 * null rather than plotted at zero — zero would read as "never honest".
 */
export function reciprocity(rows: StudentRoundRow[]): PairPoint[] {
  const b = behavioural(rows)
  const byGroup = new Map<string, StudentRoundRow[]>()
  for (const r of b) {
    const list = byGroup.get(r.group_id) ?? []
    list.push(r)
    byGroup.set(r.group_id, list)
  }
  return [...byGroup.entries()].map(([groupId, rs]) => {
    const lows = rs.filter((r) => r.demandType === 'LOW')
    const lowReports = rs.filter((r) => r.message === 'LOW')
    return {
      groupId,
      groupNumber: rs[0].groupNumber,
      truthAboutLow: lows.length ? lows.filter((r) => r.truthful).length / lows.length : null,
      productionAfterLow: lowReports.length
        ? lowReports.reduce((s, r) => s + r.production, 0) / lowReports.length
        : null,
      lowRounds: lows.length,
      lowReports: lowReports.length,
    }
  }).sort((a, b2) => a.groupNumber - b2.groupNumber)
}

// ── D. SUMMARY ─────────────────────────────────────────────────────────────────

export interface Summary {
  retailerProfit: number | null
  supplierProfit: number | null
  truthfulAboutLow: number | null
  truthfulAboutHigh: number | null
  orderAfterHigh: number | null
  orderAfterLow: number | null
  rounds: number
  excludedDefaults: number
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

export function summary(rows: StudentRoundRow[]): Summary {
  const b = behavioural(rows)
  const lows = b.filter((r) => r.demandType === 'LOW')
  const highs = b.filter((r) => r.demandType === 'HIGH')
  const afterHigh = b.filter((r) => r.message === 'HIGH')
  const afterLow = b.filter((r) => r.message === 'LOW')
  return {
    // Per-round averages, so the figure does not scale with how many rounds were played.
    retailerProfit: mean(b.map((r) => r.profits.retailer)),
    supplierProfit: mean(b.map((r) => r.profits.supplier)),
    truthfulAboutLow: lows.length ? lows.filter((r) => r.truthful).length / lows.length : null,
    truthfulAboutHigh: highs.length ? highs.filter((r) => r.truthful).length / highs.length : null,
    orderAfterHigh: mean(afterHigh.map((r) => r.production)),
    orderAfterLow: mean(afterLow.map((r) => r.production)),
    rounds: b.length,
    excludedDefaults: rows.length - b.length,
  }
}

// ── E. DISTANCE FROM THE BENCHMARKS ────────────────────────────────────────────

export interface Benchmarks {
  babbling: { retailer: number; supplier: number }
  credible: { retailer: number; supplier: number }
  /** Where the class sits between them, 0 = babbling, 1 = credible. null if no data. */
  share: { retailer: number | null; supplier: number | null }
}

/**
 * How much of the available gain the class actually captured.
 *
 * ⚠ THE TWO BENCHMARKS ARE DERIVED FROM CONFIG, never typed. They are 1.665/1.33 and
 * 1.815/1.63 for the default triple — and the spec quotes those — but flattening the
 * distribution moves both, which is precisely the study's Value treatment. Literals here
 * would keep showing the old targets after a settings edit and quietly mis-teach.
 *
 * The share can fall outside [0,1]: a class below babbling is worse than ignoring the
 * message, which is a real and interesting result. It is not clamped.
 */
export function benchmarkDistance(
  s: Summary,
  bvc: { babbling: { retailer: number; supplier: number }; credible: { retailer: number; supplier: number } },
): Benchmarks {
  const shareOf = (actual: number | null, lo: number, hi: number) =>
    actual === null || hi === lo ? null : (actual - lo) / (hi - lo)
  return {
    babbling: bvc.babbling,
    credible: bvc.credible,
    share: {
      retailer: shareOf(s.retailerProfit, bvc.babbling.retailer, bvc.credible.retailer),
      supplier: shareOf(s.supplierProfit, bvc.babbling.supplier, bvc.credible.supplier),
    },
  }
}
