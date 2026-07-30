// ═══════════════════════════════════════════════════════════════════════════════
// THE ROUND-LOOP CALLABLES — infoshare.
//
// A thin, SERVER-AUTHORITATIVE Firestore shell over the pure engine. Every action
// reads the state document, calls the engine, and writes the result in ONE
// transaction — so "the last seat's action closed the stage" and "the clock closed the
// stage" are the same race, resolved once, on the server.
//
// ⚠ NOTHING RESOLVES ON A CLIENT. Not the payoff, not the stage transition, not the
// legality of a value. A client sends an intent and renders what comes back. Any
// computation duplicated into the browser is a rule the student can see and change.
//
// State document: game_instances/{iid}/infoshare_round/{groupId}
//   { state: RoundState, group_id, pid_by_seat, seat_by_pid, stage_deadline_ms, … }
//
// ⚠ THAT COLLECTION IS SERVER-ONLY, AND firestore.rules DENIES IT BY NAME. It holds
// the round fields the reveal rule is hiding, so a client that could read the document
// would bypass the entire mechanism — the callable payload would be clean and the game
// still broken. The harness asserts the deny rule as well as the payload.
//
// ── THE CLOCK ─────────────────────────────────────────────────────────────────
// Each stage carries a server deadline. ONLY the clock closes a stage on timeout:
// `checkRoundClock` — and `getRoundView`, resolve-on-read — compares the SERVER clock
// to the deadline and, if passed, applies the injected defaults to the idle required
// seats and advances. One student can never stall a group.
//
// ── THREE BOT SEAMS, KEPT CLEAN ───────────────────────────────────────────────
// Do not build a bot here. What is needed is that a bot can act through exactly the
// same path a human does:
//   1. `applySeatAction` — the auth-free action core. A bot writes through THIS.
//   2. `buildSeatView`   — per-seat state, readable with no browser and no auth.
//   3. seats are INDICES (pid_by_seat / seat_by_pid) — no presence, no heartbeat.
// ═══════════════════════════════════════════════════════════════════════════════

import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https'
import * as admin from 'firebase-admin'
import { FieldValue } from 'firebase-admin/firestore'
import { extractStudentOnCallIds, extractInstructorGameId } from '@mygames/game-server'
import { infoshareGameDef } from './gameDefinition'
import { settingsFromConfig, DEFAULT_ROUND_SETTINGS } from './round/settings'
import {
  openRoundState, applyAction, expireStage, buildSeatView, reviveState,
  requiredSeats, stageIdOf, toHistoryRows, roleOfSeat,
  type RoundState,
} from './round/machine'
import { STAGE_MESSAGE, STAGE_PRODUCTION, type SeatAction } from './round/spec'

/**
 * THE THREE PLACES A BOT CAN COME TO OWE SOMETHING, and all three run the bots:
 *
 *   1. a round OPENS            → the Retailer seat owes a message
 *   2. a human SUBMITS          → their action closes a stage and opens the next
 *   3. a seat POLLS getRoundView → the backstop, for anything the first two missed
 *
 * ⚠ (3) IS NOT REDUNDANT. Without it, a bot that failed to act for any reason — a
 * transient Firestore error, a deploy mid-round — is never retried, and the group sits
 * until the clock defaults the bot. In ONLINE mode there is no clock at all, so it would
 * sit forever. The polling backstop is the only thing that makes a bot seat recoverable.
 *
 * ⚠ QUIETLY: a bot failure must never fail the human's request. The student pressed a
 * button and their action succeeded; turning that into a red error because the robot
 * opposite them had a bad moment is strictly worse than the group being a beat slow, and
 * the backstop will pick it up on the next poll anyway.
 */
async function runBotsQuietly(iid: string, groupId: string, clockNow: number): Promise<void> {
  try {
    const { runBotActions } = await import('./botRunner')
    await runBotActions(iid, groupId, clockNow)
  } catch (e) {
    console.error('[infoshare] bot pass failed', { iid, groupId, error: String(e) })
  }
}

const isEmu = () => process.env.FUNCTIONS_EMULATOR === 'true'
const authHeaderOf = (req: CallableRequest): string | undefined =>
  req.rawRequest.headers.authorization as string | undefined
const CORS = { cors: infoshareGameDef.corsOrigins }

const GROUP_SIZE = infoshareGameDef.composition['player']
/*
  ⚠ DERIVED, NEVER RETYPED. This was a literal `3` — the PLACEHOLDER game's round count,
  left behind when slice 1 set the real default to 10. So every infoshare game opened
  WITHOUT an explicit `num_rounds` config played three rounds instead of ten, and the
  instructor dashboard read "Round 2 of 3" on a ten-round game.

  It survived because the harnesses all set num_rounds explicitly (the e2e asks for 10),
  so every test configured its way around the default and none of them ever exercised it.
  Same shape as the other false greens in this build: the assertion was true of the
  broken state because the broken path was never taken.

  Deriving it from DEFAULT_ROUND_SETTINGS means there is one number, and changing the
  game's length cannot leave a second copy behind.
*/
export const NUM_ROUNDS_DEFAULT = DEFAULT_ROUND_SETTINGS.numRounds
const STAGE_SECONDS_DEFAULT = 120

/** The collection name. Prefixed by game id so two games never collide. */
export const ROUND_COLLECTION = 'infoshare_round'

/**
 * The clock the SERVER reads. In the EMULATOR ONLY, a `_dev.now_ms` override lets a
 * harness advance virtual time deterministically; in production this is always
 * `Date.now()`. No client-supplied time is ever trusted in production — the guard is
 * the `isEmu()` test, and it must stay.
 */
function nowMs(data: Record<string, unknown>): number {
  if (isEmu()) {
    const dev = data['_dev'] as Record<string, unknown> | undefined
    if (dev && typeof dev['now_ms'] === 'number') return dev['now_ms'] as number
  }
  return Date.now()
}

/** Stable per-group seed, so draws and role assignment replay identically. */
function hashString(str: string): number {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export const stateDoc = (iid: string, groupId: string) =>
  admin.firestore().collection('game_instances').doc(iid).collection(ROUND_COLLECTION).doc(groupId)

interface StoredDoc {
  state: RoundState
  group_id: string
  pid_by_seat: Record<string, string>
  seat_by_pid: Record<string, number>
  stage_seconds: number
  /** Clock ON (classroom) vs OFF (online). OFF → no deadline; stages never time out. */
  clock_enabled: boolean
  /** null when the clock is off — the UI then renders no clock at all. */
  stage_deadline_ms: number | null
  /** Seats filled by server bots. [] for an all-human group. */
  bot_seats?: number[]
}

/**
 * Read a stored round document.
 *
 * `reviveState` is not optional politeness — it restores the numeric map keys Firestore
 * flattens to strings. Skip it and `roleBySeat[0]` is undefined after a round trip, a
 * seat silently has no role, and nothing type-errors. Every read goes through here.
 */
export function readStored(data: unknown): StoredDoc {
  const stored = data as StoredDoc
  if (!stored) throw new HttpsError('not-found', 'This group has not started yet.')
  return { ...stored, state: reviveState(stored.state) }
}

const nextDeadline = (stored: StoredDoc, clockNow: number): number | null =>
  stored.clock_enabled ? clockNow + stored.stage_seconds * 1000 : null

function storedPayload(stored: StoredDoc, state: RoundState, deadlineMs: number | null) {
  return {
    state,
    group_id: stored.group_id,
    pid_by_seat: stored.pid_by_seat,
    seat_by_pid: stored.seat_by_pid,
    stage_seconds: stored.stage_seconds,
    clock_enabled: stored.clock_enabled,
    stage_deadline_ms: deadlineMs,
    bot_seats: stored.bot_seats ?? [],
    updated_at: FieldValue.serverTimestamp(),
  }
}

export async function settingsFor(iid: string) {
  const snap = await admin.firestore()
    .collection('game_instances').doc(iid).collection('config').doc('main').get()
  return settingsFromConfig(snap.data() as Record<string, unknown> | undefined)
}

// ── opening ────────────────────────────────────────────────────────────────────

export async function openRoundCore(
  iid: string, groupId: string, opts: { nowMs: number; seed?: number; idempotent?: boolean },
) {
  const instanceRef = admin.firestore().collection('game_instances').doc(iid)
  const [groupSnap, configSnap] = await Promise.all([
    instanceRef.collection('groups').doc(groupId).get(),
    instanceRef.collection('config').doc('main').get(),
  ])
  if (!groupSnap.exists) throw new HttpsError('not-found', 'Group not found.')

  const playerPids = (groupSnap.data()?.['player_participants'] as string[] | undefined) ?? []
  if (playerPids.length !== GROUP_SIZE) {
    throw new HttpsError('failed-precondition', `Groups are exactly ${GROUP_SIZE} players.`)
  }

  const cfg = (configSnap.data() ?? {}) as Record<string, unknown>
  const numRounds = Number(cfg['num_rounds'] ?? NUM_ROUNDS_DEFAULT) || NUM_ROUNDS_DEFAULT
  const stageSeconds = Number(cfg['round_seconds'] ?? STAGE_SECONDS_DEFAULT) || STAGE_SECONDS_DEFAULT
  const clockEnabled = (cfg['clock_mode'] ?? 'on') !== 'off'

  // Seat = array position. Seat ROLES are assigned late, inside openRoundState.
  const pidBySeat: Record<string, string> = {}
  const seatByPid: Record<string, number> = {}
  playerPids.forEach((pid, i) => { pidBySeat[String(i)] = pid; seatByPid[pid] = i })

  const botPids = new Set((groupSnap.data()?.['bot_participants'] as string[] | undefined) ?? [])
  const botSeats = playerPids.map((pid, i) => (botPids.has(pid) ? i : -1)).filter((i) => i >= 0)

  const seed = typeof opts.seed === 'number' ? opts.seed : hashString(groupId)
  const seats = playerPids.map((_, i) => i)
  const state = openRoundState(seats, seed, numRounds, settingsFromConfig(cfg))

  const payload = {
    state,
    group_id: groupId,
    pid_by_seat: pidBySeat,
    seat_by_pid: seatByPid,
    stage_seconds: stageSeconds,
    clock_enabled: clockEnabled,
    stage_deadline_ms: clockEnabled ? opts.nowMs + stageSeconds * 1000 : null,
    bot_seats: botSeats,
    updated_at: FieldValue.serverTimestamp(),
  }

  const ref = stateDoc(iid, groupId)
  if (opts.idempotent) {
    // A late arrival must never RESET a group that has already opened and progressed.
    await admin.firestore().runTransaction(async (tx) => {
      if ((await tx.get(ref)).exists) return
      tx.set(ref, payload)
    })
  } else {
    await ref.set(payload)
  }
  // (1) A ROUND HAS OPENED — the Retailer seat now owes a message, and it may be a bot.
  // Running here is what lets a bot-Retailer act before any human has done anything;
  // without it the very first stage of every round waits on the clock.
  await runBotsQuietly(iid, groupId, opts.nowMs)
  return { ok: true as const, round: state.round, stage: stageIdOf(state), clockEnabled }
}

export const openRound = onCall(CORS, async (request) => {
  const data = request.data as Record<string, unknown>
  const iid = await extractInstructorGameId(data, isEmu(), authHeaderOf(request))
  const groupId = String(data['group_id'] ?? '')
  if (!groupId) throw new HttpsError('invalid-argument', 'group_id required')
  const devSeed = isEmu() ? (data['_dev'] as Record<string, unknown> | undefined)?.['seed'] : undefined
  return openRoundCore(iid, groupId, {
    nowMs: nowMs(data),
    seed: typeof devSeed === 'number' ? devSeed : undefined,
  })
})

/**
 * ⚠ THERE IS NO `startAllGroups` HERE. It is the SHARED factory, wired in online.ts —
 * the same control serves classroom and online, and duplicating it per game is how the
 * two modes drift apart. `openRoundCore` above is what that factory injects.
 */


// ── ONLINE AUTO-OPEN ───────────────────────────────────────────────────────────

/**
 * Record a seat's ARRIVAL and, once every human seat has arrived, open round 1.
 *
 * ⚠ WITHOUT THIS, ONLINE MODE CANNOT START AT ALL. There is no instructor watching an
 * online section, so there is no button: a group begins when its people turn up. The
 * classroom "Start class" control does not help — pressing it is exactly what nobody is
 * there to do.
 *
 * The template shipped without it and the gap was invisible, because the classroom path
 * has a button and the emulator harness seeded past both. An end-to-end online run is
 * the only thing that shows it.
 *
 * Called from `getRoundView` — the moment a student's game screen first polls, which IS
 * "the student has arrived". A no-op in classroom mode (the clock is on) and a no-op for
 * a group that has already opened, so it is safe to call on every poll.
 *
 * `arrived[]` also feeds the assignment-status report: it is written with `arrayUnion`,
 * and group creation initialises it to `[]` (game-server ≥ 0.22.0) so a group nobody has
 * reached yet reports "0 arrived" rather than "not recorded".
 */
async function maybeAutoOpen(iid: string, groupId: string, participantId: string, clockNow: number): Promise<void> {
  const instanceRef = admin.firestore().collection('game_instances').doc(iid)
  const [groupSnap, configSnap] = await Promise.all([
    instanceRef.collection('groups').doc(groupId).get(),
    instanceRef.collection('config').doc('main').get(),
  ])
  if (!groupSnap.exists) return
  // Clock ON means classroom, which starts by button. Nothing to do.
  if (((configSnap.data() ?? {})['clock_mode'] ?? 'on') !== 'off') return

  const g = groupSnap.data() as Record<string, unknown>
  const players = (g['player_participants'] as string[] | undefined) ?? []
  const botPids = new Set((g['bot_participants'] as string[] | undefined) ?? [])
  if (players.length !== GROUP_SIZE) return   // a short group waits for a seat, not a poll

  await instanceRef.collection('groups').doc(groupId)
    .set({ arrived: FieldValue.arrayUnion(participantId) }, { merge: true })

  const fresh = (await instanceRef.collection('groups').doc(groupId).get()).data() as Record<string, unknown>
  const arrived = new Set((fresh['arrived'] as string[] | undefined) ?? [])
  // Bots are always "present" — they are filled at formation and never log in.
  const everyHumanHere = players.filter((p) => !botPids.has(p)).every((h) => arrived.has(h))
  if (!everyHumanHere) return

  // Idempotent: a delayed arrival must never reset a group that already progressed.
  await openRoundCore(iid, groupId, { nowMs: clockNow, idempotent: true })
}

// ── the action core (bot seam #1) ──────────────────────────────────────────────

/**
 * Apply one seat's action. NO AUTH — the callables above authenticate and then call
 * this, and a bot runner calls it directly. One code path, so a bot can never diverge
 * from what a human's action does.
 */
/**
 * Apply an action whose VALUE IS DECIDED INSIDE THE TRANSACTION, from the state the
 * transaction read.
 *
 * ⚠ THIS IS THE FORM THE BOT RUNNER NEEDS, and the reason is not style. A bot that
 * decided its action from a read taken BEFORE the transaction could have the state move
 * underneath it — the stage closes, and an action chosen for stage 1 arrives at stage 2.
 * The engine would reject it, but relying on "our own bug gets rejected downstream" is
 * not a design. Deciding from the transactional read means the situation cannot arise.
 *
 * `build` returns null when the seat owes nothing right now. That is a NO-OP, not a
 * failure: it is exactly what a second bot pass sees, and it is what makes the runner
 * idempotent without a "have I run already?" flag to get out of step.
 */
export async function applySeatActionBuilt(
  iid: string, groupId: string, seat: number,
  build: (state: RoundState) => SeatAction | null,
  clockNow: number,
): Promise<{ ok: boolean; reason?: string; skipped?: boolean; stageClosed: boolean; finished: boolean }> {
  const settings = await settingsFor(iid)
  const ref = stateDoc(iid, groupId)

  return admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists) throw new HttpsError('not-found', 'This group has not started yet.')
    const stored = readStored(snap.data())

    // Resolve the clock FIRST. A submission that arrives after the deadline must not
    // beat the default that should already have been applied — otherwise the student
    // who was slowest sets the stage's outcome.
    let state = stored.state
    if (stored.clock_enabled && stored.stage_deadline_ms !== null && clockNow >= stored.stage_deadline_ms) {
      state = expireStage(state, settings).state
    }

    const action = build(state)
    if (action === null) {
      return { ok: true, skipped: true, stageClosed: false, finished: state.status !== 'in_progress' }
    }

    const r = applyAction(state, seat, action, settings)
    if (!r.ok) return { ok: false, reason: r.reason, stageClosed: false, finished: false }

    const deadline = r.stageClosed ? nextDeadline(stored, clockNow) : stored.stage_deadline_ms
    tx.set(ref, storedPayload(stored, r.state, r.finished ? null : deadline))
    return { ok: true, stageClosed: r.stageClosed, finished: r.finished }
  })
}

/** The human path: a concrete action, chosen by a person who already saw the screen. */
export async function applySeatAction(
  iid: string, groupId: string, seat: number, action: SeatAction, clockNow: number,
): Promise<{ ok: boolean; reason?: string; stageClosed: boolean; finished: boolean }> {
  const r = await applySeatActionBuilt(iid, groupId, seat, () => action, clockNow)
  return { ok: r.ok, reason: r.reason, stageClosed: r.stageClosed, finished: r.finished }
}

/** Resolve a student's identity to a seat in their own group. */
async function seatOfCaller(data: Record<string, unknown>, request: CallableRequest) {
  const { participantId, gameInstanceId } = await extractStudentOnCallIds(data, isEmu(), authHeaderOf(request))
  const groupId = String(data['group_id'] ?? '')
  if (!groupId) throw new HttpsError('invalid-argument', 'group_id required')
  const snap = await stateDoc(gameInstanceId, groupId).get()
  if (!snap.exists) throw new HttpsError('not-found', 'This group has not started yet.')
  const stored = readStored(snap.data())
  const seat = stored.seat_by_pid[participantId]
  // A participant asking about a group they are not in is not a 404 — it is a refusal.
  if (seat === undefined) throw new HttpsError('permission-denied', 'You are not in this group.')
  return { iid: gameInstanceId, groupId, seat, stored }
}

// ── student submissions ────────────────────────────────────────────────────────

/**
 * ⚠ THE VALUE IS NOT VALIDATED HERE. Legality lives in the spec's injected `validate`
 * hook and is reached through the engine, so there is exactly one rule set and the
 * message the student sees is the one the engine enforced. A "friendlier" second check
 * in this file is two rule sets that drift.
 */
const submitStage = (stage: typeof STAGE_MESSAGE | typeof STAGE_PRODUCTION) =>
  onCall(CORS, async (request) => {
    const data = request.data as Record<string, unknown>
    const { iid, groupId, seat } = await seatOfCaller(data, request)
    // The value is passed through UNVALIDATED on purpose — the engine's injected
    // `validate` is the single rule set (spec §3.10). A second check here would be a
    // second rule set, and the one a student is judged by is the one they cannot see.
    const action: SeatAction = stage === STAGE_MESSAGE
      ? { kind: 'message', message: data['message'] as never }
      : { kind: 'production', production: Number(data['production']) as never }
    const r = await applySeatAction(iid, groupId, seat, action, nowMs(data))
    if (!r.ok) throw new HttpsError('failed-precondition', r.reason ?? 'Rejected.')
    // A human's action can hand the next stage straight to a bot. Run bots here so the
    // group moves on immediately instead of waiting out the clock on a seat that is
    // sitting right there — see the three call sites note above runBotActions.
    await runBotsQuietly(iid, groupId, nowMs(data))
    return r
  })

export const submitMessage = submitStage(STAGE_MESSAGE)
export const submitProduction = submitStage(STAGE_PRODUCTION)

// ── the clock ──────────────────────────────────────────────────────────────────

/**
 * Close an expired stage by applying the injected defaults. Safe to call at any time
 * and from anyone in the group — it is a no-op before the deadline, and the whole
 * point is that it does not depend on the absent student doing anything.
 */
export const checkRoundClock = onCall(CORS, async (request) => {
  const data = request.data as Record<string, unknown>
  const { iid, groupId } = await seatOfCaller(data, request)
  return runClock(iid, groupId, nowMs(data))
})

async function runClock(iid: string, groupId: string, clockNow: number) {
  const settings = await settingsFor(iid)
  const ref = stateDoc(iid, groupId)
  return admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists) return { ok: true, expired: false }
    const stored = readStored(snap.data())
    if (!stored.clock_enabled || stored.stage_deadline_ms === null) return { ok: true, expired: false }
    if (clockNow < stored.stage_deadline_ms) return { ok: true, expired: false }
    if (stored.state.status !== 'in_progress') return { ok: true, expired: false }

    const r = expireStage(stored.state, settings)
    tx.set(ref, storedPayload(stored, r.state, r.finished ? null : nextDeadline(stored, clockNow)))
    return { ok: true, expired: true, finished: r.finished, round: r.state.round }
  })
}

// ── reads ──────────────────────────────────────────────────────────────────────

/**
 * THE STUDENT PAYLOAD — and the ONLY thing a student's browser ever receives about the
 * round. It is `buildSeatView` and nothing else, so there is one surface to audit.
 *
 * ⚠ DO NOT ADD A FIELD HERE "FOR CONVENIENCE". Every addition is a potential leak that
 * the engine's reveal rule cannot see, because it never passed through it. If a screen
 * needs something, add it to `buildSeatView`, where the reveal rule applies.
 *
 * Resolve-on-read: an expired clock is closed before the view is built, so a student
 * who reloads after the deadline sees the round that should already have advanced
 * rather than a frozen one.
 */
export const getRoundView = onCall(CORS, async (request) => {
  const data = request.data as Record<string, unknown>
  const { participantId, gameInstanceId } = await extractStudentOnCallIds(data, isEmu(), authHeaderOf(request))
  const groupIdArg = String(data['group_id'] ?? '')
  const clockNow = nowMs(data)

  // ONLINE: reaching the game screen IS arriving. Record it and open round 1 once every
  // human seat is here. No-op in classroom mode. Must run BEFORE seatOfCaller, which
  // throws "this group has not started yet" on a group that has not opened — which is
  // precisely the state auto-open exists to leave.
  if (groupIdArg) await maybeAutoOpen(gameInstanceId, groupIdArg, participantId, clockNow)

  const { iid, groupId, seat } = await seatOfCaller(data, request)
  await runClock(iid, groupId, clockNow)
  // (3) THE BACKSTOP. The only thing that makes a bot seat recoverable — and the ONLY
  // bot trigger at all in online mode, where there is no clock to default anyone.
  await runBotsQuietly(iid, groupId, clockNow)

  const settings = await settingsFor(iid)
  const stored = readStored((await stateDoc(iid, groupId).get()).data())
  return {
    ok: true,
    view: buildSeatView(stored.state, seat, settings),
    clock_enabled: stored.clock_enabled,
    stage_deadline_ms: stored.stage_deadline_ms,
    server_now_ms: clockNow,
  }
})

/** The instructor's view of ONE group. Full state — the instructor is not a player. */
export const getInstructorRoundView = onCall(CORS, async (request) => {
  const data = request.data as Record<string, unknown>
  const iid = await extractInstructorGameId(data, isEmu(), authHeaderOf(request))
  const groupId = String(data['group_id'] ?? '')
  const stored = readStored((await stateDoc(iid, groupId).get()).data())
  return { ok: true, state: stored.state, history: toHistoryRows(stored.state) }
})

/**
 * The live dashboard: one row per group.
 *
 * ⚠ THE INSTRUCTOR SCREEN IS A LEAK SURFACE TOO. It is projected, and students look at
 * it. Anything the reveal rule is withholding from students must be withheld here as
 * well while the round is live — the reference game shipped a version that showed a
 * hidden draw on the dashboard while students were still deciding on it.
 */
export const getGameDashboard = onCall(CORS, async (request) => {
  const data = request.data as Record<string, unknown>
  const iid = await extractInstructorGameId(data, isEmu(), authHeaderOf(request))
  const instanceRef = admin.firestore().collection('game_instances').doc(iid)
  const [groupsSnap, roundsSnap] = await Promise.all([
    instanceRef.collection('groups').get(),
    instanceRef.collection(ROUND_COLLECTION).get(),
  ])
  const settings = await settingsFor(iid)
  const byId = new Map(roundsSnap.docs.map((d) => [d.id, readStored(d.data())]))

  const groups = groupsSnap.docs.map((g, i) => {
    const stored = byId.get(g.id)
    if (!stored) return { group_id: g.id, groupNumber: i + 1, started: false }
    const st = stored.state
    const pending = requiredSeats(st, settings)
    return {
      group_id: g.id,
      groupNumber: i + 1,
      started: true,
      status: st.status,
      round: st.round,
      numRounds: st.horizonBySeat[st.seats[0]] ?? null,
      stage: stageIdOf(st),
      pending: pending.length,
      /*
        ⚠ WHICH SEAT, NOT HOW MANY. "waiting on 1 seat" tells an instructor a group is
        stuck; "waiting on Supplier" tells them whom to go and talk to, which is the
        entire reason the line exists. Crisis has carried the roles from the start and
        this is the field that was missing here.

        ⚠ THE ROLE IS SAFE TO PUBLISH; THE DRAW IS NOT. Roles are fixed for the whole
        game and both students know both of them, so naming the seat that owes an action
        reveals nothing the reveal rule is withholding. Do NOT extend this to the round
        field — see the warning above the callable. Names are deliberately absent: the
        dashboard is projected, and a name on a screen in front of the class is a
        different thing from a role.
      */
      waitingOnRoles: pending.flatMap((seat) => { const r = roleOfSeat(st, seat); return r ? [r] : [] }),
      stage_deadline_ms: stored.stage_deadline_ms,
      // Deliberately NOT the hidden round field. See the warning above.
    }
  })
  return { ok: true, groups }
})
