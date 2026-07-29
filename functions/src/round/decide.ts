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
import type { SeatView, SeatAction } from './spec'

/**
 * Choose this seat's action for the stage it currently owes.
 *
 * PURE. Same view + same settings ⇒ same action, always. Randomness is drawn from a
 * seeded stream derived from the view (round, seat), never from Math.random — otherwise
 * a replay of a class diverges and no harness assertion about a bot can be pinned.
 *
 * ── THE STRATEGY, AND WHY IT IS THIS ONE ─────────────────────────────────────
 * A bot exists so a half-full class can still play, and so robot mode can drive the real
 * screens unattended. It is NOT a model of optimal play and must not be quoted as the
 * game's prediction — so it is deliberately simple, and deliberately not a saint.
 *
 *   RETAILER   tells the truth about HIGH always (there is never a reason not to), and
 *              tells the truth about LOW most of the time, misreporting sometimes.
 *              A bot that NEVER misreports would give every human Supplier a game against
 *              a provably honest partner — the one condition the experiment is not about,
 *              and the human would learn to believe everything within three rounds.
 *   SUPPLIER   believes the report: 3 lots on HIGH, 1 on LOW.
 *
 * ⚠ THE RETAILER BRANCH READS ITS OWN `demandType`, WHICH IT IS ALLOWED TO SEE. The
 * Supplier branch reads `currentMessage` AND NOTHING ELSE, and must never reach for
 * demandType as a fallback. The server bot runs where nothing is ever on the wire, so
 * the harness leak assertions CANNOT catch a peeking bot — review of this function is
 * the only defence that exists.
 */
export function decide(view: SeatView, _settings: RoundSettings): SeatAction {
  const rng = makeRng(view.round * 1000 + view.seat)

  if (view.owes === 'message') {
    // Presence, not nullishness — if the reveal rule ever changed, fail loudly rather
    // than reporting a confident HIGH derived from a missing field.
    if (!('demandType' in view) || view.demandType === undefined) {
      throw new Error('[infoshare] decide(): the retailer seat cannot see demandType — ' +
        'the reveal rule or the seat view changed. Refusing to guess a report.')
    }
    const truth = view.demandType
    const misreport = truth === 'LOW' && rng() < 0.25
    return { kind: 'message', message: misreport ? 'HIGH' : truth }
  }

  if (view.owes === 'production') {
    // Believe the report. Nothing else is read here — see the warning above.
    return { kind: 'production', production: view.currentMessage === 'HIGH' ? 3 : 1 }
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
