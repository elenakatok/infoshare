// ═══════════════════════════════════════════════════════════════════════════════
// THE BOT BRAIN — ONE `decide()`, CANONICALLY HERE, INSIDE functions/.
//
// ⚠ THE TEMPLATE'S SLOT, NOW FILLED. `isStrategyImplemented()` is DELETED, not left
// returning true — a permanent capability check invites a silent "bots are off today"
// path, and a bot seat that quietly does nothing is indistinguishable from a student who
// never turned up. Callers that used it now simply call decide().
//
// ── WHY THIS FILE LIVES IN functions/src/round/ ───────────────────────────────
// Because TWO RUNNERS SHARE ONE BRAIN:
//
//   • the SERVER runner — fills a bot seat in a real class (functions/src/botRunner.ts)
//   • the BROWSER runner — robot mode, headed Playwright (bot/robot-driver.mjs)
//
// The server runner is deployed code, so the brain must be inside functions/ to be
// packaged at all. The browser runner then imports the COMPILED output
// (functions/lib/round/decide.js) rather than keeping its own copy.
//
// An earlier game in this fleet ended up with a mirrored strategy file and a drift
// test holding the two copies together. That was an accident of file placement, not a
// real constraint, and it must not be reproduced: a drift test is a confession that
// two copies exist. There is ONE copy, here.
//
// ── WHAT decide() MAY AND MAY NOT SEE ────────────────────────────────────────
// It is handed a SEAT VIEW — exactly what a human in that seat can see, and nothing
// more. Never the full round state, never another seat's pending submission, never a
// round field the reveal rule is withholding. A bot that peeks is not a bot, it is a
// bug that wins, and the leak assertions in the harness will not catch it because the
// bot runs server-side where nothing is on the wire.
// ═══════════════════════════════════════════════════════════════════════════════

import type { RoundSettings } from './settings'
import type { SeatView, SeatAction, StoredRoundRecord } from './spec'
import type { DemandType, Lots } from './settings'

// ═══════════════════════════════════════════════════════════════════════════════
// THE STRATEGIES (spec §7.1) — AND THE ONE FACT THEY BOTH FOLLOW FROM.
//
// ⚠ THE INCENTIVE IS ONE-SIDED. The Retailer always prefers more production, so
// reporting LOW can only REDUCE what the Supplier makes. A LOW report is therefore
// CREDIBLE BY CONSTRUCTION — there is never a reason to send one falsely. The only
// possible lie in this game is reporting HIGH when the truth is LOW.
//
// Two consequences, and every line below is one of them:
//
//   • "Truthful" means reporting LOW when the type is LOW. That is the ONLY place
//     honesty costs the Retailer anything. On HIGH, truthful and self-interested
//     coincide, so a truth-teller and a liar are indistinguishable — there is no
//     strategy to write.
//   • "Trusting" means producing 3 after a HIGH report. After LOW the Supplier can
//     always safely produce 1; there is nothing to trust. ALL of the Supplier's
//     inference problem sits on HIGH.
//
// ⚠ SO BOTH TRIGGERS WATCH HIGH ONLY. The Retailer bot watches what the Supplier did
// after a HIGH REPORT, not after a LOW one. The Supplier bot's production after LOW
// never changes. A trigger that also watched LOW would be reacting to a signal that
// carries no information, and would fire on noise.
//
// ── WHY NEITHER BOT NEEDS A FORGIVENESS TIMER ────────────────────────────────
// THE PAIR IS SELF-CORRECTING. Retailer lies → Supplier punishes → the punishment
// ends at the Supplier's re-test → the Retailer sees 3 after HIGH again → the
// Retailer resumes telling the truth. `k` is the only tuning parameter in the whole
// system. Adding a second timer to either side would give the pair two clocks that
// can disagree, and a pair that can deadlock in mutual punishment.
// ═══════════════════════════════════════════════════════════════════════════════

/** Rounds where the Retailer reported HIGH, oldest first. Nothing else is evidence. */
const highReportRounds = (history: StoredRoundRecord[]) =>
  history.filter((h) => h.message === 'HIGH')

/**
 * RETAILER BOT — RECIPROCATOR (§7.1).
 *
 * Reports the truth, INCLUDING LOW when the type is LOW, for as long as the Supplier
 * is rewarding HIGH reports by producing 3. If the Supplier has stopped, the
 * credibility of HIGH is worth nothing, so the bot reports HIGH every round.
 *
 * ⚠ THE TEST IS THE MOST RECENT HIGH REPORT, not an average or a count. The Supplier
 * bot punishes for exactly k rounds and then re-tests; a rate-based test would still
 * read as "punished" for many rounds after the re-test and the pair would never
 * recover — which is the entire behaviour this strategy exists to produce.
 *
 * With no HIGH report yet there is nothing to reciprocate to, so it starts truthful.
 * Optimism is the right prior: a bot that starts by lying never gives the Supplier
 * the honest history that makes trust possible.
 */
function retailerReport(truth: DemandType, history: StoredRoundRecord[]): DemandType {
  // Truthful and self-interested coincide on HIGH — no decision to make.
  if (truth === 'HIGH') return 'HIGH'

  const highs = highReportRounds(history)
  if (highs.length === 0) return 'LOW'          // nothing to go on → tell the truth

  const rewarded = highs[highs.length - 1].production === 3
  return rewarded ? 'LOW' : 'HIGH'
}

/**
 * SUPPLIER BOT — TRUSTING (§7.1).
 *
 * Produces 3 after HIGH and 1 after LOW while HIGH reports have been honest. After
 * being lied to — HIGH reported, LOW turned out true — it stops trusting HIGH and
 * produces 2 after a HIGH report for the next k rounds, then RE-TESTS with 3.
 *
 * ⚠ PRODUCTION AFTER LOW NEVER CHANGES, in any state. LOW was never in doubt, so
 * there is nothing for a punishment to express there — and punishing after LOW would
 * punish the Retailer for the one honest act the game asks of them.
 *
 * ⚠ THE RE-TEST IS NOT OPTIONAL. Without it the punishment is permanent, the Retailer
 * bot never sees 3 after HIGH again, and the pair locks into mutual defection for the
 * rest of the run. The re-test is what closes the self-correcting loop.
 */
function supplierProduction(report: DemandType, history: StoredRoundRecord[], k: number): Lots {
  if (report === 'LOW') return 1                // never in doubt, never changes

  // The most recent lie: HIGH was reported and the truth turned out to be LOW.
  let lastLie = -1
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].message === 'HIGH' && history[i].demandType === 'LOW') { lastLie = history[i].round; break }
  }
  if (lastLie < 0) return 3                     // never lied to → trusting

  /*
    Rounds ALREADY PLAYED since the lie. Deciding the first post-lie round sees 0, the
    second sees 1, and so on — so the punishment covers `roundsSince < k`, and the round
    where it reaches k IS the re-test.

    ⚠ `<= k` HERE PUNISHES FOR k+1 ROUNDS. Written that way first, and the k-window test
    caught it: with k=1 the supplier produced 2 twice and never re-tested on schedule.
    Off by one in a punishment length is not cosmetic — k is the ONLY tuning parameter in
    the pair, and doubling it doubles how long the truthfulness chart stays flat.
  */
  const roundsSince = history.length - lastLie
  return roundsSince < k ? 2 : 3
}

/**
 * Choose this seat's action for the stage it currently owes.
 *
 * PURE, AND A FUNCTION OF STORED HISTORY ONLY. Same view ⇒ same action, always. No
 * Math.random and no clock: a replay of a class must reproduce it exactly, or no
 * harness assertion about a bot can be pinned to anything.
 *
 * ⚠ THE RETAILER BRANCH READS ITS OWN `demandType`, WHICH IT IS ALLOWED TO SEE. The
 * Supplier branch reads `currentMessage` and history AND NOTHING ELSE, and must never
 * reach for demandType as a fallback. The server runner executes where nothing is
 * ever on the wire, so the harness leak assertions CANNOT catch a peeking bot —
 * review of this function, and the peek test in spec.test.ts, are the only defences.
 */
export function decide(view: SeatView, settings: RoundSettings): SeatAction {
  if (view.owes === 'message') {
    // Presence, not nullishness — if the reveal rule ever changed, fail loudly rather
    // than reporting a confident HIGH derived from a missing field.
    if (!('demandType' in view) || view.demandType === undefined) {
      throw new Error('[infoshare] decide(): the retailer seat cannot see demandType — ' +
        'the reveal rule or the seat view changed. Refusing to guess a report.')
    }
    return { kind: 'message', message: retailerReport(view.demandType, view.history) }
  }

  if (view.owes === 'production') {
    if (view.currentMessage !== 'HIGH' && view.currentMessage !== 'LOW') {
      throw new Error('[infoshare] decide(): the supplier seat owes a production but has ' +
        'no report to respond to. The stage order or the seat view changed.')
    }
    return {
      kind: 'production',
      production: supplierProduction(view.currentMessage, view.history, settings.botPunishmentRounds),
    }
  }

  throw new Error(`[infoshare] decide(): nothing is owed (owes=${String(view.owes)})`)
}

// ── seeded randomness, for a strategy that needs it ───────────────────────────

/**
 * Mulberry32. Deterministic, dependency-free, and identical to the stream the engine
 * uses — so a bot's draws are reproducible in a replay.
 */
export function makeRng(seed: number): () => number {
  let a = seed | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
