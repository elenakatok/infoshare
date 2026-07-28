import { onRequest } from 'firebase-functions/v2/https'
import * as admin from 'firebase-admin'
import {
  makeGetInstructorSession,
  makeAssignRole,
  makeCompletePrep,
  makeConfirmReady,
  makeGenerateAttendanceCode,
  makeVerifyAttendanceCode,
  makeGetRoster,
  makeStartNegotiation,
  makeSubmitLeadOutcome,
  makeSubmitConfirmation,
  makeSubmitInstructorOutcome,
  makeFinalizeInstance,
  makePushResultsToClassroom,
  makeGetGameConfig,
  makeUpdateGameConfig,
  makeGetStudentPrepQuestions,
  makeGetDebriefQuestions,
  makeSubmitKnowledgeCheck,
  makeSubmitStaticKnowledgeCheckQuestion,
  makeGetInfoUrls,
} from '@mygames/game-server'
import { infoshareGameDef } from './gameDefinition'

admin.initializeApp()

// ═══════════════════════════════════════════════════════════════════════════════
// EVERY DEPLOYED FUNCTION, IN ONE PLACE — the deploy list for infoshare.
//
// ⚠ THIS LIST IS ALSO THE DEPLOY LIST. Deploy BY NAME, never blanket
// `--only functions`: a blanket deploy redeploys everything, mints a Cloud Run
// revision per function, and eventually trips "Quota exceeded for total allowable
// CPU", which blocks every deploy in the project until old revisions are swept.
//
// ⚠ EVERY NEW CALLABLE NEEDS AN IAM `roles/run.invoker` BINDING FOR allUsers, added
// immediately after its first deploy. Gen-2 service names are LOWERCASE — the binding
// for `getRoundView` is on `getroundview`. IAM persists across redeploys, so this is
// once per function, but a missing binding presents as a generic auth failure in the
// browser and costs an hour to find.
// ═══════════════════════════════════════════════════════════════════════════════

// ── session, roster, matching, config ──────────────────────────────────────────
export const getInstructorSession   = makeGetInstructorSession(infoshareGameDef)
export const assignRole             = makeAssignRole(infoshareGameDef)
export const completePrep           = makeCompletePrep(infoshareGameDef)
export const confirmReady           = makeConfirmReady(infoshareGameDef)
export const generateAttendanceCode = makeGenerateAttendanceCode(infoshareGameDef)
export const verifyAttendanceCode   = makeVerifyAttendanceCode(infoshareGameDef)
export const getRoster              = makeGetRoster(infoshareGameDef)
export const getGameConfig          = makeGetGameConfig(infoshareGameDef)
export const updateGameConfig       = makeUpdateGameConfig(infoshareGameDef)
export const getInfoUrls            = makeGetInfoUrls(infoshareGameDef)

/** A WRAPPER, not the shared factory directly — see ./syncRoster for why. */
export { syncRoster } from './syncRoster'

// ── outcome + finalize + gradebook ─────────────────────────────────────────────
export const startNegotiation        = makeStartNegotiation(infoshareGameDef)
export const submitLeadOutcome       = makeSubmitLeadOutcome(infoshareGameDef)
export const submitConfirmation      = makeSubmitConfirmation(infoshareGameDef)
export const submitInstructorOutcome = makeSubmitInstructorOutcome(infoshareGameDef)
export const finalizeInstance        = makeFinalizeInstance(infoshareGameDef)
export const pushResultsToClassroom  = makePushResultsToClassroom(infoshareGameDef)
export { scoreAndRecord } from './scoreAndRecord'

// ═══════════════════════════════════════════════════════════════════════════════
// ⚠ THE KNOWLEDGE CHECK NEEDS ALL FOUR OF THESE. WIRE THEM TOGETHER OR NOT AT ALL.
//
//   getStudentPrepQuestions            serves the questions
//   getDebriefQuestions                serves the debrief questions
//   submitKnowledgeCheck               grades and records the whole set
//   submitStaticKnowledgeCheckQuestion grades ONE question, on the spot
//
// The trap, which this platform has hit before: wire the first three and skip the
// fourth, and the knowledge check RENDERS PERFECTLY. Every question appears, options
// shuffle, the student answers — and the per-question submit throws "not a valid
// graded KC question", after they have already done the work. It looks like a content
// bug and it is a missing function.
//
// The same class of failure appears at deploy time: a content change often spans more
// functions than the obvious one, and "renders fine but submit fails" almost always
// means a STALE BUNDLE on the grader or the token function rather than wrong content.
// ═══════════════════════════════════════════════════════════════════════════════
export const getStudentPrepQuestions            = makeGetStudentPrepQuestions(infoshareGameDef)
export const getDebriefQuestions                = makeGetDebriefQuestions(infoshareGameDef)
export const submitKnowledgeCheck               = makeSubmitKnowledgeCheck(infoshareGameDef)
export const submitStaticKnowledgeCheckQuestion = makeSubmitStaticKnowledgeCheckQuestion(infoshareGameDef)

// ── reports ────────────────────────────────────────────────────────────────────
export { getReportData } from './getReportData'
export { getRoundReport } from './getRoundReport'

// ── the round loop ─────────────────────────────────────────────────────────────
export {
  openRound,
  submitSignal,
  submitRespond,
  checkRoundClock,
  getRoundView,
  getInstructorRoundView,
  getGameDashboard,
} from './infoshareRound'

/**
 * ── ONLINE MODE, ENTIRELY FROM SHARED FACTORIES ───────────────────────────────
 * Seat move, ungroup, the No-Group pool, bot fill, the flag, the one Start-class
 * button and the assignment-status report. `startAllGroups` lives HERE, not in the
 * round-loop module: it is the same control in both modes, and one control cannot be
 * allowed to become two. See ./online.ts for the three things the game injects.
 */
export {
  groupParticipantsOnline,
  recordLogin,
  getOnlineGroups,
  moveSeat,
  topUpGroupWithBots,
  flagGroup,
  startAllGroups,
  getOnlineReport,
} from './online'

// ── health ─────────────────────────────────────────────────────────────────────

const CORS_ORIGINS = new Set(infoshareGameDef.corsOrigins)

export const health = onRequest((req, res) => {
  const origin = req.headers.origin ?? ''
  if (CORS_ORIGINS.has(origin)) {
    res.set('Access-Control-Allow-Origin', origin)
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.set('Vary', 'Origin')
  }
  if (req.method === 'OPTIONS') { res.status(204).send(''); return }
  res.json({ ok: true, game: infoshareGameDef.game_id })
})

/**
 * Emulator-only dev seeds. LOCKED — 404 unless FUNCTIONS_EMULATOR==='true', and
 * deliberately given NO run.invoker binding in production. Do not bind them "just to
 * test something quickly": a reachable seed endpoint can fabricate groups in a live
 * class, and nothing in the UI would show that it happened.
 */
export { seedGroupForTest, seedRosterForTest } from './seedFunctions'
