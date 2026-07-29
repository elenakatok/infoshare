import { describe, it, expect } from 'vitest'
import {
  DEFAULT_ROUND_SETTINGS as D, lowProfile, profileFor,
  validateHighProfile, validateSettings, settingsFromConfig, LOTS,
  type RoundSettings, type Lots,
} from './settings'
import {
  payoffTable, expectedProfits, babblingVsCredible, resolveRound,
  validateMessage, validateProduction, salesOf,
} from './resolver'
import { makeGameSpec, drawLots, FIELD_DEMAND_TYPE, FIELD_ACTUAL_DEMAND, STAGE_MESSAGE, STAGE_PRODUCTION } from './spec'
import { decide } from './decide'
import { DEFAULT_ROUND_SETTINGS, type DemandType, type Lots } from './settings'
import { openGame, submit, buildSeatView, assertValidStageGameSpec, makeRng } from '@mygames/stage-engine'

// ═══════════════════════════════════════════════════════════════════════════════
// Every number below is CHECKED AGAINST THE SPEC and COMPUTED BY THE CODE. Where the
// two disagree the disagreement is reported, not adjusted — see the §3.2 block.
// ═══════════════════════════════════════════════════════════════════════════════

const spec = () => makeGameSpec({ settings: D })
const open = () => openGame(spec(), { seats: [0, 1], roleBySeat: { 0: 'retailer', 1: 'supplier' }, seed: 42 })

describe('the payoff table — spec §3, derived not typed', () => {
  const t = payoffTable(D)

  it('matches the spec table cell for cell', () => {
    // demand ↓ / production → , as [retailer, supplier]
    const want: Record<Lots, Record<Lots, [number, number]>> = {
      1: { 1: [1, 1], 2: [1, 0], 3: [1, -1] },
      2: { 1: [1, 1], 2: [2, 2], 3: [2, 1] },
      3: { 1: [1, 1], 2: [2, 2], 3: [3, 3] },
    }
    for (const d of LOTS) for (const q of LOTS) {
      expect([t[d][q].retailer, t[d][q].supplier], `demand ${d}, production ${q}`)
        .toEqual(want[d][q])
    }
  })

  it('THE ROW THAT MATTERS: demand 1, produce 3 → supplier −1', () => {
    // Three lots made, one sold, two sunk. This is the KC question in spec §8.
    expect(t[1][3].supplier).toBe(-1)
  })

  it("the Retailer's profit does not depend on demand TYPE at all (§3.1)", () => {
    // Only on min(D, q) — which is why the Retailer always prefers production 3 and
    // always has a reason to report HIGH. The whole tension starts here.
    for (const q of LOTS) {
      const viaHigh = expectedProfits(D).byType.HIGH[q].retailer
      const viaLow = expectedProfits(D).byType.LOW[q].retailer
      // They differ only because the DEMAND distribution differs, never because the
      // retailer formula reads the type — proven by the table being type-free.
      expect(t[1][q].retailer).toBe(salesOf(1, q) * (D.retailPrice - D.wholesalePrice))
      expect(Number.isFinite(viaHigh) && Number.isFinite(viaLow)).toBe(true)
    }
  })

  it('is derived from the price settings, not hard-coded', () => {
    const dearer: RoundSettings = { ...D, retailPrice: 5 }   // margin 3 instead of 1
    expect(payoffTable(dearer)[3][3].retailer).toBe(9)
    expect(payoffTable(dearer)[3][3].supplier).toBe(t[3][3].supplier)  // supplier unaffected
  })
})

describe('expected profits — spec §3.2', () => {
  const e = expectedProfits(D)
  const r2 = (n: number) => Math.round(n * 100) / 100

  it('SUPPLIER matches the spec table', () => {
    expect(r2(e.byType.HIGH[1].supplier)).toBe(1.00)
    expect(r2(e.byType.HIGH[2].supplier)).toBe(1.96)
    expect(r2(e.byType.HIGH[3].supplier)).toBe(2.26)
    expect(r2(e.byType.LOW[1].supplier)).toBe(1.00)
    // ⚠ Spec §2.1 records that deck slide 15 shows 0.07 here — a digit transposition of
    // 0.70. The computed value is authoritative, and it computes to 0.70, so the SPEC is
    // right and the deck is wrong. Nothing to report beyond confirming it.
    expect(r2(e.byType.LOW[2].supplier)).toBe(0.70)
    expect(r2(e.byType.LOW[3].supplier)).toBe(-0.26)
  })

  it('SUPPLIER under the 50/50 prior matches the spec', () => {
    expect(r2(e.underPrior[1].supplier)).toBe(1.00)
    expect(r2(e.underPrior[2].supplier)).toBe(1.33)
    expect(r2(e.underPrior[3].supplier)).toBe(1.00)
  })

  it('RETAILER matches the spec table', () => {
    expect(r2(e.byType.HIGH[1].retailer)).toBe(1.00)
    expect(r2(e.byType.HIGH[2].retailer)).toBe(1.98)
    expect(r2(e.byType.HIGH[3].retailer)).toBe(2.63)
    expect(r2(e.byType.LOW[1].retailer)).toBe(1.00)
    expect(r2(e.byType.LOW[2].retailer)).toBe(1.35)
    expect(r2(e.byType.LOW[3].retailer)).toBe(1.37)
  })

  it('babbling vs credible matches spec §3.2, with the production SOLVED not assumed', () => {
    const c = babblingVsCredible(D)
    expect(c.babbling.production).toBe(2)          // solved for, and the spec agrees
    expect(r2(c.babbling.supplier)).toBe(1.33)
    expect(c.babbling.retailer).toBeCloseTo(1.665, 3)   // spec quotes 3 dp here
    expect(r2(c.credible.supplier)).toBe(1.63)
    expect(c.credible.retailer).toBeCloseTo(1.815, 3)
    expect(c.gain.supplier).toBeGreaterThan(0)
    expect(c.gain.retailer).toBeGreaterThan(0)     // BOTH sides gain — the teaching result
  })

  it('flattening the triple SHRINKS the gain (the study\'s Value treatment, §3.2)', () => {
    const flat: RoundSettings = { ...D, high: { 1: 0.16, 2: 0.33, 3: 0.51 } }
    expect(babblingVsCredible(flat).gain.supplier)
      .toBeLessThan(babblingVsCredible(D).gain.supplier)
  })
})

describe('the one editable triple — LOW is the exact reverse (spec §2)', () => {
  it('reverses the default triple', () => {
    expect(lowProfile(D.high)).toEqual({ 1: 0.65, 2: 0.33, 3: 0.02 })
  })

  it('reverses ANY edited triple, and reversing twice is the identity', () => {
    for (const high of [
      { 1: 0.16, 2: 0.33, 3: 0.51 },
      { 1: 0, 2: 0, 3: 1 },
      { 1: 0.1, 2: 0.2, 3: 0.7 },
    ]) {
      expect(lowProfile(high)).toEqual({ 1: high[3], 2: high[2], 3: high[1] })
      expect(lowProfile(lowProfile(high))).toEqual(high)
    }
  })

  it('LOW is never stored or read separately — profileFor is the only route', () => {
    expect(profileFor('LOW', D)).toEqual(lowProfile(D.high))
    expect(profileFor('HIGH', D)).toEqual(D.high)
    // There is no `low` key to set, so the two profiles cannot be made asymmetric.
    expect('low' in D).toBe(false)
  })
})

describe('a triple that does not sum to 1 is rejected', () => {
  it('rejects a typo one hundredth off', () => {
    const r = validateHighProfile({ 1: 0.02, 2: 0.33, 3: 0.66 })
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toMatch(/add up to 1/)
  })

  it('accepts a sum within tolerance but NOT exactly 1 — why === would be wrong', () => {
    // Asserted directly rather than by naming a triple I believe has float dust. Two
    // guesses at such a triple (0.02/0.33/0.65 and 0.1/0.2/0.7) both turned out to sum
    // to exactly 1, so the honest test is the tolerance itself.
    const dusty = { 1: 0.02, 2: 0.33, 3: 0.65 + 1e-12 }
    expect(dusty[1] + dusty[2] + dusty[3]).not.toBe(1)
    expect(validateHighProfile(dusty).ok).toBe(true)
    expect(validateHighProfile(D.high).ok).toBe(true)
  })

  it('but a sum outside tolerance is still rejected — the window is narrow', () => {
    const off = { 1: 0.02, 2: 0.33, 3: 0.65 + 1e-6 }
    expect(validateHighProfile(off).ok).toBe(false)
  })

  it('rejects an entry outside [0,1] even when the sum is right', () => {
    expect(validateHighProfile({ 1: -0.1, 2: 0.5, 3: 0.6 }).ok).toBe(false)
  })

  it('rejects a non-number', () => {
    expect(validateHighProfile({ 1: NaN, 2: 0.33, 3: 0.65 }).ok).toBe(false)
  })

  it('validateSettings refuses a retail price below wholesale', () => {
    expect(validateSettings({ ...D, retailPrice: 1 }).ok).toBe(false)
  })

  it('an invalid stored triple falls back to the default WHOLESALE, never half-applied', () => {
    const s = settingsFromConfig({ p_lots_1: 0.5, p_lots_2: 0.5, p_lots_3: 0.5 })
    expect(s.high).toEqual(D.high)
  })
})

describe('the reveal — asserted by ABSENCE, on the seat view', () => {
  it('the RETAILER sees the demand type at stage 1', () => {
    const v = buildSeatView(spec(), open(), 0)
    expect(FIELD_DEMAND_TYPE in v.fields).toBe(true)
    expect(['HIGH', 'LOW']).toContain(v.fields[FIELD_DEMAND_TYPE])
  })

  it('the RETAILER does NOT see actual demand — the type, never the realisation', () => {
    const v = buildSeatView(spec(), open(), 0)
    expect(FIELD_ACTUAL_DEMAND in v.fields).toBe(false)
  })

  it('⚠ the SUPPLIER sees NEITHER field at stage 2 — key absent, not null', () => {
    const sp = spec()
    let st = open()
    // Retailer sends a message; the production stage opens.
    st = submit(sp, st, 0, { kind: 'message', message: 'HIGH' }).state
    const v = buildSeatView(sp, st, 1)
    expect(v.stageId).toBe(STAGE_PRODUCTION)

    expect(FIELD_DEMAND_TYPE in v.fields).toBe(false)
    expect(FIELD_ACTUAL_DEMAND in v.fields).toBe(false)
    // Absence, not emptiness: a present-but-null key still says a hidden value exists
    // and survives a careless `?? 'unknown'` downstream.
    expect(Object.keys(v.fields)).toEqual([])
    expect(JSON.stringify(v)).not.toContain(FIELD_DEMAND_TYPE)
    expect(JSON.stringify(v)).not.toContain(FIELD_ACTUAL_DEMAND)
  })

  it('the Supplier DOES see the message — that is the observed stage', () => {
    const sp = spec()
    let st = open()
    st = submit(sp, st, 0, { kind: 'message', message: 'LOW' }).state
    const v = buildSeatView(sp, st, 1)
    expect(v.observed[STAGE_MESSAGE][0]).toEqual({ kind: 'message', message: 'LOW' })
  })

  it('both fields are public once the round resolves — a lie is found out one round later', () => {
    const sp = spec()
    let st = open()
    st = submit(sp, st, 0, { kind: 'message', message: 'HIGH' }).state
    st = submit(sp, st, 1, { kind: 'production', production: 2 }).state
    expect(st.history).toHaveLength(1)
    const rec = st.history[0]
    expect(['HIGH', 'LOW']).toContain(rec.result.demandType)
    expect(LOTS).toContain(rec.result.actualDemand)
    expect(typeof rec.result.truthful).toBe('boolean')
  })
})

describe('determinism', () => {
  it('the same seed draws the same demand type and demand, every time', () => {
    const runs = [0, 1, 2].map(() => {
      const st = openGame(spec(), { seats: [0, 1], roleBySeat: { 0: 'retailer', 1: 'supplier' }, seed: 7 })
      return [st.roundFields[FIELD_DEMAND_TYPE], st.roundFields[FIELD_ACTUAL_DEMAND]]
    })
    expect(runs[1]).toEqual(runs[0])
    expect(runs[2]).toEqual(runs[0])
  })

  it('different seeds do not all draw the same thing', () => {
    const draws = new Set<string>()
    for (let seed = 1; seed <= 40; seed++) {
      const st = openGame(spec(), { seats: [0, 1], roleBySeat: { 0: 'retailer', 1: 'supplier' }, seed })
      draws.add(`${st.roundFields[FIELD_DEMAND_TYPE]}:${st.roundFields[FIELD_ACTUAL_DEMAND]}`)
    }
    expect(draws.size).toBeGreaterThan(1)
  })

  it('the RESOLVER is a pure function of its input — no rng anywhere in it', () => {
    const input = { message: 'HIGH' as const, production: 2 as Lots, demandType: 'LOW' as const, actualDemand: 1 as Lots }
    const a = resolveRound(input, D)
    const b = resolveRound(input, D)
    expect(a).toEqual(b)
  })

  it('drawLots respects the distribution over many draws', () => {
    const rng = makeRng(12345)
    const counts = { 1: 0, 2: 0, 3: 0 }
    const N = 20000
    for (let i = 0; i < N; i++) counts[drawLots(rng, D.high)]++
    expect(counts[3] / N).toBeCloseTo(0.65, 1)
    expect(counts[1] / N).toBeCloseTo(0.02, 1)
  })
})

describe('legality is injected, and the spec validates', () => {
  it('the declared spec passes engine validation', () => {
    expect(() => assertValidStageGameSpec(spec())).not.toThrow()
  })

  it('rejects a message that is not a demand type', () => {
    expect(validateMessage('MAYBE').ok).toBe(false)
    expect(validateMessage('HIGH').ok).toBe(true)
  })

  it('rejects production outside 1..3, including 7 and a non-integer', () => {
    expect(validateProduction(7, D).ok).toBe(false)
    expect(validateProduction(2.5, D).ok).toBe(false)
    expect(validateProduction(0, D).ok).toBe(false)
    expect(validateProduction(2, D).ok).toBe(true)
  })

  it('the ENGINE enforces it — the callable never needs its own copy (§3.10)', () => {
    const sp = spec()
    const st = open()
    const bad = submit(sp, st, 0, { kind: 'message', message: 'MAYBE' as never })
    expect(bad.ok).toBe(false)
    expect(bad.reason).toMatch(/HIGH or LOW/)
  })

  it('the Supplier cannot act before the message stage closes', () => {
    const sp = spec()
    const r = submit(sp, open(), 1, { kind: 'production', production: 2 })
    expect(r.ok).toBe(false)
  })
})

describe('timeout defaults — spec §6.1, invoked by the engine', () => {
  it('a silent Retailer sends HIGH; a silent Supplier produces 2', () => {
    const sp = spec()
    const msg = sp.stages[0].defaultFor!(0, {} as never)
    const prod = sp.stages[1].defaultFor!(1, {} as never)
    expect(msg).toEqual({ kind: 'message', message: 'HIGH' })
    expect(prod).toEqual({ kind: 'production', production: 2 })
  })

  it('every stage of a clocked game declares a default — the engine has no fallback', () => {
    expect(spec().hasClock).toBe(true)
    for (const stage of spec().stages) expect(typeof stage.defaultFor).toBe('function')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// THE BOT STRATEGIES (spec §7.1).
//
// ⚠ THESE TEST WHAT THE BOTS DO, NOT THAT THEY RETURN A LEGAL VALUE. The strategies
// ARE the deliverable of this slice; a suite that only checked the action type-checks
// would pass against a bot that reported at random, which is precisely the placeholder
// this replaced.
// ═══════════════════════════════════════════════════════════════════════════════

const K = DEFAULT_ROUND_SETTINGS.botPunishmentRounds

/** One completed round, as the seat view carries it. */
const rec = (round: number, message: DemandType, demandType: DemandType, production: Lots) => ({
  round, retailerSeat: 0, supplierSeat: 1,
  message, production, demandType,
  actualDemand: 2 as Lots, sales: 2,
  profits: { retailer: 2, supplier: 2 },
  truthful: message === demandType,
  defaulted: { retailer: false, supplier: false },
})

const retailerView = (demandType: DemandType, history: ReturnType<typeof rec>[]) => ({
  seat: 0, role: 'retailer', status: 'in_progress', round: history.length + 1,
  numRounds: 10, stage: 'message', owes: 'message', currentMessage: null,
  demandType, history, pendingCount: 1,
}) as never

const supplierView = (currentMessage: DemandType, history: ReturnType<typeof rec>[]) => ({
  seat: 1, role: 'supplier', status: 'in_progress', round: history.length + 1,
  numRounds: 10, stage: 'production', owes: 'production', currentMessage,
  history, pendingCount: 1,
}) as never

const report = (v: never) => (decide(v, DEFAULT_ROUND_SETTINGS) as { message: DemandType }).message
const produce = (v: never) => (decide(v, DEFAULT_ROUND_SETTINGS) as { production: Lots }).production

describe('retailer bot — reciprocator (§7.1)', () => {
  it('reports HIGH when the type is HIGH, always — whatever the supplier has done', () => {
    // Truthful and self-interested coincide here, so this must hold even in the state
    // where the bot has given up on LOW entirely.
    expect(report(retailerView('HIGH', []))).toBe('HIGH')
    expect(report(retailerView('HIGH', [rec(1, 'HIGH', 'HIGH', 1)]))).toBe('HIGH')
    expect(report(retailerView('HIGH', [rec(1, 'HIGH', 'LOW', 2), rec(2, 'HIGH', 'HIGH', 2)]))).toBe('HIGH')
  })

  it('tells the truth about LOW while the supplier rewards HIGH with 3', () => {
    expect(report(retailerView('LOW', [rec(1, 'HIGH', 'HIGH', 3)]))).toBe('LOW')
    expect(report(retailerView('LOW', [
      rec(1, 'HIGH', 'HIGH', 3), rec(2, 'LOW', 'LOW', 1), rec(3, 'HIGH', 'HIGH', 3),
    ]))).toBe('LOW')
  })

  it('starts truthful — with no HIGH report yet there is nothing to reciprocate to', () => {
    expect(report(retailerView('LOW', []))).toBe('LOW')
    // A history of LOW-only rounds still carries no evidence about HIGH.
    expect(report(retailerView('LOW', [rec(1, 'LOW', 'LOW', 1), rec(2, 'LOW', 'LOW', 1)]))).toBe('LOW')
  })

  it('switches to always-HIGH once the supplier stops producing 3 after HIGH', () => {
    expect(report(retailerView('LOW', [rec(1, 'HIGH', 'HIGH', 2)]))).toBe('HIGH')
    expect(report(retailerView('LOW', [rec(1, 'HIGH', 'HIGH', 3), rec(2, 'HIGH', 'HIGH', 2)]))).toBe('HIGH')
  })

  /**
   * ⚠ THE TRIGGER WATCHES HIGH ONLY. Production after a LOW report carries no
   * information — 1 after LOW is the Supplier's permanent, correct behaviour, not a
   * punishment. A bot that read it as one would defect against a partner who had done
   * nothing wrong, in the exact rounds where honesty was being rewarded.
   */
  it('ignores production after a LOW report — 1 after LOW is not a punishment', () => {
    expect(report(retailerView('LOW', [rec(1, 'HIGH', 'HIGH', 3), rec(2, 'LOW', 'LOW', 1)]))).toBe('LOW')
  })
})

describe('supplier bot — trusting (§7.1)', () => {
  it('produces 3 after HIGH and 1 after LOW while HIGH reports have been honest', () => {
    expect(produce(supplierView('HIGH', []))).toBe(3)
    expect(produce(supplierView('LOW', []))).toBe(1)
    expect(produce(supplierView('HIGH', [rec(1, 'HIGH', 'HIGH', 3)]))).toBe(3)
  })

  it(`produces 2 after HIGH for exactly k=${K} round(s) after being lied to, then re-tests with 3`, () => {
    const lie = [rec(1, 'HIGH', 'LOW', 3)]          // reported HIGH, truth was LOW
    // The k punished rounds.
    let h = [...lie]
    for (let i = 0; i < K; i++) {
      expect(produce(supplierView('HIGH', h))).toBe(2)
      h = [...h, rec(h.length + 1, 'HIGH', 'HIGH', 2)]
    }
    // …and then the RE-TEST. Without this the punishment is permanent and the pair
    // locks into mutual defection for the rest of the run.
    expect(produce(supplierView('HIGH', h))).toBe(3)
  })

  it('never changes production after LOW — not even mid-punishment', () => {
    expect(produce(supplierView('LOW', [rec(1, 'HIGH', 'LOW', 3)]))).toBe(1)
  })

  it('does not treat an honest HIGH as a lie', () => {
    expect(produce(supplierView('HIGH', [rec(1, 'HIGH', 'HIGH', 3), rec(2, 'LOW', 'LOW', 1)]))).toBe(3)
  })
})

/**
 * THE SELF-CORRECTING LOOP (§7.1) — the reason neither bot needs a forgiveness timer.
 *
 * Retailer lies → Supplier punishes → punishment ends at the re-test → Retailer sees 3
 * after HIGH again → Retailer resumes telling the truth. This is the property that makes
 * `k` the only tuning parameter in the system, and no single-bot test can show it: it is
 * a claim about the PAIR.
 */
describe('the pair is self-correcting', () => {
  /**
   * lie → punish → re-test → recover, driven ONLY by the two decide() branches.
   *
   * ⚠ THE TRUTHS MUST INCLUDE HIGH ROUNDS, and the first version of this test did not.
   * The Supplier's punishment is only ever EXPRESSED on a HIGH report. With an all-LOW
   * run the Retailer lies once, immediately reverts to the truth, and no HIGH report
   * ever arrives — so the punishment never becomes visible and the loop never turns.
   * The test failed, the code was right, and the scenario was the bug.
   *
   * Seeded with one round where a HIGH report earned only 2, which is what puts the
   * Retailer in the "HIGH is worth nothing" state and makes it lie in round 2.
   */
  it('lie → punish → re-test → recover', () => {
    const history = [rec(1, 'HIGH', 'HIGH', 2)]
    const truths: DemandType[] = ['LOW', 'HIGH', 'HIGH', 'LOW']
    const log: { round: number; truth: DemandType; said: DemandType; made: Lots }[] = []

    truths.forEach((truth, i) => {
      const round = i + 2
      const said = report(retailerView(truth, history))
      const made = produce(supplierView(said, history))
      log.push({ round, truth, said, made })
      history.push(rec(round, said, truth, made))
    })

    // r2 — THE LIE. The supplier has not been lied to yet, so it still trusts.
    expect(log[0]).toEqual({ round: 2, truth: 'LOW', said: 'HIGH', made: 3 })
    // r3 — THE PUNISHMENT. The lie is now in history; HIGH earns 2 instead of 3.
    expect(log[1]).toEqual({ round: 3, truth: 'HIGH', said: 'HIGH', made: 2 })
    // r4 — THE RE-TEST, after exactly k=1 punished round. Trust offered again.
    expect(log[2]).toEqual({ round: 4, truth: 'HIGH', said: 'HIGH', made: 3 })
    // r5 — RECOVERY. The retailer sees 3 after HIGH and tells the truth about LOW again,
    // at a cost to itself. This is the round the whole design exists to produce.
    expect(log[3]).toEqual({ round: 5, truth: 'LOW', said: 'LOW', made: 1 })
  })

  /**
   * ⚠ NEGATIVE CONTROL — the loop assertion must be capable of FAILING.
   *
   * Three self-caught false greens in this build shared one property: the assertion was
   * equally true of the broken state. So break the strategy deliberately — a Supplier
   * that never re-tests, the single most plausible way to get §7.1 wrong — and require
   * the recovery round to disappear. If this ever passes, the loop test above is
   * decoration.
   */
  it('NEGATIVE CONTROL: a supplier that never re-tests breaks recovery', () => {
    const neverRetests = (report_: DemandType, history: ReturnType<typeof rec>[]): Lots => {
      if (report_ === 'LOW') return 1
      const liedTo = history.some((h) => h.message === 'HIGH' && h.demandType === 'LOW')
      return liedTo ? 2 : 3          // punishes forever — no re-test
    }

    const history = [rec(1, 'HIGH', 'HIGH', 2)]
    const truths: DemandType[] = ['LOW', 'HIGH', 'HIGH', 'LOW']
    const log: { said: DemandType; made: Lots }[] = []

    truths.forEach((truth, i) => {
      const said = report(retailerView(truth, history))
      const made = neverRetests(said, history)
      log.push({ said, made })
      history.push(rec(i + 2, said, truth, made))
    })

    // The re-test never comes, so the retailer never sees 3 after HIGH again…
    expect(log.slice(1).every((l) => l.made !== 3)).toBe(true)
    // …and the final LOW round is a LIE, not the recovery the real pair produces.
    expect(log[3].said).toBe('HIGH')
    // Which is exactly the assertion the real loop test makes, now failing:
    expect(log[3]).not.toEqual({ said: 'LOW', made: 1 })
  })
})
