// ═══════════════════════════════════════════════════════════════════════════════
// MATCHING, THEN BOT-FILLING THE REMAINDER.
//
// ⚠ WITH TWO-SEAT GROUPS, THE REMAINDER IS EXACTLY ONE STUDENT WHENEVER THE CLASS IS
// ODD — which is half of all classes. The shared matcher forms only FULL groups, so
// without this that student is left in the No-Group pool with nothing to join and no game
// to play. Filling the remainder is therefore the NORM here, not a recovery path, and it
// is chained into matching rather than left as a button an instructor has to know about.
//
// This is the piece that makes the server bot runner reachable at all: the runner drives
// bot SEATS, and nothing else in the system ever creates one for a leftover student.
//
// ── DEPLOYED UNDER THE NAME `triggerMatching`, ON PURPOSE ────────────────────
// The instructor "Match Now" button is game-ui's shared InstructorDashboard, which calls
// httpsCallable('triggerMatching') BY NAME. So the chained behaviour has to live under
// exactly that name — an extra callable with a better name would simply never be pressed.
// ═══════════════════════════════════════════════════════════════════════════════

import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https'
import * as admin from 'firebase-admin'
import { FieldValue } from 'firebase-admin/firestore'
import { randomUUID } from 'node:crypto'
import { extractInstructorGameId, makeTriggerMatching } from '@mygames/game-server'
import { infoshareGameDef } from './gameDefinition'

const GROUP_SIZE = infoshareGameDef.composition['player']
const CORS = { cors: infoshareGameDef.corsOrigins }
const isEmu = () => process.env.FUNCTIONS_EMULATOR === 'true'
const authHeaderOf = (r: CallableRequest) => r.rawRequest.headers.authorization as string | undefined

/** The shared human matcher, invoked in-process so there is ONE matching rule set. */
const humanMatcher = makeTriggerMatching(infoshareGameDef)

/** A bot seat's participant document — the same shape online.ts mints. */
function makeBotSeat(gameInstanceId: string, groupId: string, index: number, now: unknown) {
  const participantId = `bot_${groupId}_${index}`
  return {
    participantId,
    doc: {
      participant_id: participantId,
      game_instance_id: gameInstanceId,
      display_name: `Robot ${index}`,
      role: 'player',
      group_id: groupId,
      // ⚠ `is_bot: true` is what keeps this seat OUT of the gradebook and off the
      // instructor's roster counts. Everything downstream keys on it.
      is_bot: true,
      attendance_confirmed_at: now,
      confirmed_ready_at: now,
    } as Record<string, unknown>,
  }
}

/**
 * Pad the ungrouped-human remainder to a full group with server bots. No auth — the
 * callers below do that.
 *
 * IDEMPOTENT: no ungrouped humans → a no-op that reports why. Pressing Match twice
 * therefore cannot mint a second bot group for a student who already has one.
 */
async function fillRemainderCore(gameInstanceId: string) {
  const db = admin.firestore()
  const instanceRef = db.collection('game_instances').doc(gameInstanceId)

  const [presenceSnap, participantsSnap] = await Promise.all([
    admin.database().ref(`presence/${gameInstanceId}`).once('value'),
    instanceRef.collection('participants').get(),
  ])
  const presentIds = new Set<string>(Object.keys((presenceSnap.val() ?? {}) as object))

  const ungroupedHumans = participantsSnap.docs
    .filter((doc) => {
      const d = doc.data()
      return d['is_bot'] !== true
        && d['attendance_confirmed_at'] != null
        && d['role'] === 'player'
        && presentIds.has(doc.id)
        && d['group_id'] == null
    })
    .map((doc) => doc.id)

  if (ungroupedHumans.length === 0) {
    return { ok: true as const, created: false, reason: 'No ungrouped eligible humans — nothing to fill.' }
  }
  if (ungroupedHumans.length >= GROUP_SIZE) {
    // Two or more ungrouped humans should have been matched with EACH OTHER. Pairing
    // them with bots instead would quietly deny them a human partner.
    throw new HttpsError('failed-precondition',
      `${ungroupedHumans.length} ungrouped players (≥ ${GROUP_SIZE}). Run matching first so the ` +
      'full human groups form, then fill the remainder.')
  }

  const humans = ungroupedHumans
  const botsNeeded = GROUP_SIZE - humans.length
  const groupId = randomUUID()
  const now = FieldValue.serverTimestamp()

  const batch = db.batch()
  const botPids: string[] = []
  for (let i = 0; i < botsNeeded; i++) {
    const { participantId, doc } = makeBotSeat(gameInstanceId, groupId, i + 1, now)
    botPids.push(participantId)
    batch.set(instanceRef.collection('participants').doc(participantId), doc)
  }

  // ⚠ HUMANS FIRST, so they take the low seat indices; openRound assigns the Retailer
  // and Supplier roles late across these seats. A HUMAN is always the lead — a bot must
  // never be the seat the instructor's outcome tooling talks to.
  batch.set(instanceRef.collection('groups').doc(groupId), {
    group_id: groupId,
    game_instance_id: gameInstanceId,
    player_participants: [...humans, ...botPids],
    bot_participants: botPids,
    bot_count: botsNeeded,
    lead_participant_id: humans[0],
    outcome: null,
    status: 'matched',
    matched_at: now,
  })
  for (const pid of humans) {
    batch.update(instanceRef.collection('participants').doc(pid), { group_id: groupId, is_lead: pid === humans[0] })
  }

  await batch.commit()
  return { ok: true as const, created: true, group_id: groupId, humans: humans.length, bots: botsNeeded }
}

/** Standalone, for an instructor who wants to fill the remainder without re-matching. */
export const fillRemainderWithBots = onCall(CORS, async (request) => {
  const data = request.data as Record<string, unknown>
  const gameInstanceId = await extractInstructorGameId(data, isEmu(), authHeaderOf(request))
  return fillRemainderCore(gameInstanceId)
})

/** "Match Now": form the full human groups, THEN bot-fill whoever is left over. */
export const triggerMatching = onCall(CORS, async (request: CallableRequest) => {
  const data = request.data as Record<string, unknown>
  const gameInstanceId = await extractInstructorGameId(data, isEmu(), authHeaderOf(request))

  let human: unknown
  try {
    human = await humanMatcher.run(request)
  } catch (err) {
    // Fewer than GROUP_SIZE present humans → the shared matcher cannot form a group and
    // throws. That is NOT an error here: every present human joins the bot-filled
    // remainder instead, which is exactly what a class of one student needs.
    if (err instanceof HttpsError && err.code === 'failed-precondition') {
      human = { ok: false as const, groups: [], note: 'no full human group; all humans join the bot-filled remainder' }
    } else {
      throw err
    }
  }

  const remainder = await fillRemainderCore(gameInstanceId)
  return { ok: true as const, human, remainder }
})
