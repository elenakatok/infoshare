// ═══════════════════════════════════════════════════════════════════════════════
// THE SERVER BOT RUNNER — one of TWO runners sharing ONE decide().
//
//   • THIS runner fills the odd seat in a real class.
//   • The BROWSER runner (bot/robot-driver.mjs) drives real screens for demos and
//     unattended testing.
//
// Both call the SAME `decide()` in round/decide.ts. There is no mirror and there must
// never be one: a drift test between two copies is a confession that two copies exist.
//
// ⚠ AN ODD SEAT IS THE NORM HERE, NOT AN EMERGENCY. Groups are two, so an odd class
// produces exactly one leftover student EVERY time it is odd. This runner is what makes
// that student's game playable at all, so it has to be as reliable as the human path —
// not a best-effort convenience.
//
// ── WHY IT WRITES THROUGH applySeatActionBuilt, NOT ITS OWN WRITE ────────────
// A bot goes through the SAME transaction core a human hits. Not an HTTP call to our own
// callable (which would need auth we deliberately do not give bots), and not a direct
// document write (which would bypass the engine, the clock resolution and the validate
// hook — three rule sets a bot could then violate in ways no human could).
//
// ── IDEMPOTENT BY CONSTRUCTION ───────────────────────────────────────────────
// The action is built INSIDE the transaction from the transactional read, and the engine
// rejects a seat that has already acted this stage. So a second pass — a retry, a
// duplicate delivery, two callers racing — re-reads, finds `owes === null`, and writes
// nothing. There is no "have I run already?" flag to get wrong.
// ═══════════════════════════════════════════════════════════════════════════════

import * as admin from 'firebase-admin'
import { applySeatActionBuilt, stateDoc, readStored, settingsFor } from './infoshareRound'
import { buildSeatView, type RoundState } from './round/machine'
import { decide } from './round/decide'
import type { SeatAction } from './round/spec'

export interface BotPassResult {
  /** Actions actually written. */
  acted: number
  /** Bot seats that owed nothing — already acted, or not their stage. */
  skipped: number
  status: 'in_progress' | 'finished' | 'not_found' | 'no_bots'
}

/**
 * One bot-action pass for a group: every bot seat that owes something acts.
 *
 * ⚠ IT LOOPS. Both stages can fall to bots in the same call — in a two-bot group the
 * Retailer's message closes stage 1 and immediately opens stage 2 for the Supplier. A
 * single pass would act once and leave the group waiting on a bot that is sitting right
 * there, and the round would only advance when the clock defaulted it.
 *
 * The loop is bounded by `maxSteps` rather than "until nothing owes": a bug that made a
 * seat perpetually owe something would otherwise spin inside a Cloud Function until the
 * timeout, with no clue why. It stops and reports instead.
 */
export async function runBotActions(
  iid: string, groupId: string, clockNow = Date.now(), maxSteps = 64,
): Promise<BotPassResult> {
  const snap = await stateDoc(iid, groupId).get()
  if (!snap.exists) return { acted: 0, skipped: 0, status: 'not_found' }

  const stored = readStored(snap.data())
  const botSeats = stored.bot_seats ?? []
  if (botSeats.length === 0) return { acted: 0, skipped: 0, status: 'no_bots' }
  if (stored.state.status !== 'in_progress') return { acted: 0, skipped: 0, status: 'finished' }

  const settings = await settingsFor(iid)
  let acted = 0, skipped = 0

  for (let step = 0; step < maxSteps; step++) {
    let actedThisStep = false

    for (const seat of botSeats) {
      /*
        The action is BUILT INSIDE THE TRANSACTION, from the state the transaction read.
        Building it outside would mean deciding against a state that may have moved on
        between the read and the write — and the action for stage 1 could then arrive at
        stage 2. The engine would reject it, but "the engine rejects our bug" is not a
        design; deciding from the transactional read means the bug cannot occur.
      */
      const r = await applySeatActionBuilt(iid, groupId, seat, (state: RoundState) => {
        const view = buildSeatView(state, seat)
        if (view.owes === null) return null          // nothing owed → no write at all
        return decide(view, settings) as SeatAction
      }, clockNow)

      if (r.ok && !r.skipped) { acted++; actedThisStep = true } else { skipped++ }
      if (r.finished) return { acted, skipped, status: 'in_progress' }
    }

    if (!actedThisStep) break                        // nothing left for a bot to do
  }

  return { acted, skipped, status: 'in_progress' }
}

/** Does this group have any bot seats at all? Cheap guard for the call sites. */
export async function groupHasBots(iid: string, groupId: string): Promise<boolean> {
  const snap = await admin.firestore()
    .collection('game_instances').doc(iid)
    .collection('groups').doc(groupId).get()
  if (!snap.exists) return false
  const bots = (snap.data()?.['bot_participants'] as string[] | undefined) ?? []
  return bots.length > 0
}
