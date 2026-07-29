// ═══════════════════════════════════════════════════════════════════════════════
// THE END-TO-END HARNESS — empty instance to a landed gradebook push.
//
// ⚠ WHY THIS EXISTS, AND WHY IT IS SEPARATE FROM THE ROUND-LOOP HARNESS.
//
// The round-loop harness starts every section from `seedGroupForTest`, which writes an
// already-MATCHED group. That is right for testing the engine and wrong for testing the
// game: it skips the entire pre-game flow, so the harness was 28/28 green while
// production shipped twice broken —
//
//   1. `triggerMatching` was never exported. Match Now failed with a bare "internal".
//   2. Nothing invoked `startAllGroups`. Groups matched and then dead-ended, with no
//      start control on any screen.
//
// Both were reachability failures, not logic failures. The functions were correct; one
// did not exist and one could not be reached. A harness that seeds past the flow cannot
// see either.
//
// ── THE RULE THIS FILE ENFORCES ──────────────────────────────────────────────
// NO SEED SHORTCUTS. Every step below calls the SAME callable the shared UI invokes, in
// the SAME order a human causes it. `seedGroupForTest` and `seedRosterForTest` are not
// imported here, on purpose. The only concession to the emulator is participant
// bootstrap via `_test`, which is how the real client authenticates there too.
//
// A harness that calls the function UNDER the button can pass while the button is dead.
// This one walks the buttons.
//
//   node infoshare-e2e.mjs        (env KEEP=1 leaves the stack up)
// ═══════════════════════════════════════════════════════════════════════════════

import { openSync } from 'node:fs'
import { spawn, execSync } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT   = 'infoshare-mygames-live'
const ROOT      = path.dirname(fileURLToPath(import.meta.url))
const FUNCTIONS = `http://localhost:5005/${PROJECT}/us-central1`
const PORTS     = [9101, 5005, 8082, 9002]
const CB_PORT   = 5599
const RTDB_NS   = `${PROJECT}-default-rtdb`

let PASS = 0, FAIL = 0
const banner = (m) => console.log('\n' + '─'.repeat(72) + '\n' + m + '\n' + '─'.repeat(72))
const check = (c, n) => { if (c) { PASS++; console.log(`  ✓ ${n}`) } else { FAIL++; console.log(`  ✗ FAIL: ${n}`) } }

async function callFn(name, data) {
  const res = await fetch(`${FUNCTIONS}/${name}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data }),
  })
  let body = null
  try { body = await res.json() } catch { /* */ }
  if (res.ok && body && 'result' in body) return { ok: true, result: body.result }
  return { ok: false, error: body?.error?.message ?? `http ${res.status}` }
}

const asStudent = (gid, pid, extra = {}) => ({ _test: { participant_id: pid, game_instance_id: gid }, ...extra })
const asDev     = (gid, extra = {}) => ({ _dev: { game_instance_id: gid }, ...extra })

// ── the mock classroom (roster source + gradebook sink) ────────────────────────
let cbServer = null
let pushed = []
let rosterRequests = 0
// The shape makeSyncRoster destructures. Getting this wrong is not a harness detail:
// it is exactly what the real classroom returns, and the first run failed on it.
const ROSTER = [
  { participant_id: 'stu1', name: 'Ada Lovelace',    email: 'ada@example.edu',   external_id: 'stu1' },
  { participant_id: 'stu2', name: 'Alan Turing',     email: 'alan@example.edu',  external_id: 'stu2' },
  { participant_id: 'stu3', name: 'Grace Hopper',    email: 'grace@example.edu', external_id: 'stu3' },
  { participant_id: 'stu4', name: 'Edsger Dijkstra', email: 'ed@example.edu',    external_id: 'stu4' },
]
function startClassroom() {
  return new Promise((res) => {
    cbServer = http.createServer((req, r) => {
      let b = ''
      req.on('data', (c) => (b += c))
      req.on('end', () => {
        // One endpoint serves both roles; the game calls different URLs but the mock
        // answers by shape, which keeps this file short without faking anything real.
        let parsed = null
        try { parsed = JSON.parse(b) } catch { /* */ }
        r.writeHead(200, { 'Content-Type': 'application/json' })
        if (parsed && parsed.participant_id !== undefined) { pushed.push(parsed); r.end('{"ok":true}'); return }
        rosterRequests++
        r.end(JSON.stringify({ participants: ROSTER, instructor_email: 'prof@example.edu' }))
      })
    })
    cbServer.listen(CB_PORT, '127.0.0.1', res)
  })
}
const CB = `http://localhost:${CB_PORT}`

// ── stack ──────────────────────────────────────────────────────────────────────
const children = []
const freePorts = () => { for (const p of PORTS) { try { execSync(`lsof -ti tcp:${p} -sTCP:LISTEN | xargs kill -9`, { stdio: 'ignore' }) } catch { /* */ } } }
async function bringUp() {
  banner('BOOT — build functions, boot emulators, start the mock classroom')
  freePorts(); await sleep(1000)
  execSync('npm run build', { cwd: path.join(ROOT, 'functions'), stdio: 'inherit' })
  const log = openSync(path.join(ROOT, 'e2e-emu.log'), 'a')
  children.push(spawn('firebase',
    ['emulators:start', '--only', 'auth,functions,firestore,database', '--project', PROJECT],
    { cwd: ROOT, detached: true, stdio: ['ignore', log, log] }))
  const start = Date.now()
  for (;;) {
    try { const r = await fetch(`${FUNCTIONS}/health`); if (r.ok) break } catch { /* */ }
    if (Date.now() - start > 150_000) throw new Error('functions never came up')
    await sleep(800)
  }
  await startClassroom()
  await sleep(800)
  console.log('  Stack ready ✅')
}
const tearDown = () => {
  if (cbServer) { try { cbServer.close() } catch { /* */ } }
  if (process.env.KEEP === '1') return
  for (const c of children) { try { process.kill(-c.pid, 'SIGKILL') } catch { /* */ } }
  freePorts()
}

// ═══════════════════════════════════════════════════════════════════════════════
// The steps, each named for the BUTTON a human presses.
// ═══════════════════════════════════════════════════════════════════════════════

/** Instructor: "Sync roster". */
const syncRoster = (gid) => callFn('syncRoster',
  { _dev: { game_instance_id: gid, roster_url: CB, callback_secret: 'test' } })

/** Instructor: "Generate attendance code". */
const genCode = (gid) => callFn('generateAttendanceCode', asDev(gid, {}))

/** Student: opening the launch link. */
const assignRole = (gid, pid) => callFn('assignRole', asStudent(gid, pid, {}))

/** Student: the knowledge check, prep, ready, attendance code. */
async function studentPreGame(gid, pid, code) {
  const out = {}
  out.kcQuestions = await callFn('getStudentPrepQuestions', asStudent(gid, pid, {}))
  // The late-assignment gate: the correct answer IS the single matching role key.
  // `answers: {}` is rejected — the first run failed on it, which is the point of
  // driving the real callable rather than a convenient stand-in.
  out.kc = await callFn('submitKnowledgeCheck', asStudent(gid, pid, { answer: 'player' }))
  out.prep = await callFn('completePrep', asStudent(gid, pid, {}))
  out.ready = await callFn('confirmReady', asStudent(gid, pid, {}))
  out.attend = await callFn('verifyAttendanceCode', asStudent(gid, pid, { code }))
  return out
}

/**
 * Student presence, written straight to RTDB.
 *
 * ⚠ NOT A SEED SHORTCUT — this is what the STUDENT'S BROWSER does. `useStudentSession`
 * writes `presence/{instance}/{participant}` directly; there is no callable for it,
 * because presence has to disappear when the tab closes. The matcher's eligibility gate
 * is `attended AND valid role AND PRESENT`, so a harness that skips this is testing a
 * matcher that can never match, which is how the first run of this file "failed".
 */
async function beOnThePage(gid, pid) {
  // Two things that both fail SILENTLY-ish if you get them wrong, and both did here:
  //
  //   ns=   the emulator namespace is the RTDB INSTANCE id, `<project>-default-rtdb`
  //         (see VITE_FIREBASE_DATABASE_URL). The bare project id writes to a different
  //         namespace that nothing reads — and returns 200.
  //   auth  database.rules.json requires `auth.token.game_instance_id == $instanceId`
  //         (the FERPA instance-claim pattern), so an unauthenticated REST write is
  //         DENIED — correctly. The emulator's admin override is the
  //         `Authorization: Bearer owner` HEADER; the `?auth=owner` QUERY PARAM does NOT
  //         work and is also denied, which is a confusing hour if you assume otherwise.
  //         This stands in for the signed-in browser session the harness has no way to
  //         hold. The rule itself is not relaxed — the round-loop harness asserts it.
  // ⚠ WRITE TO BOTH NAMESPACES. The RTDB emulator namespace the ADMIN SDK uses is not
  // reliably `<project>-default-rtdb`: it depends on whether a databaseURL is configured,
  // and it differs between a spawned game and the template (whose .firebaserc still
  // carries its identity marker). Writing to one and having the server read the other
  // fails with a 200 and an empty presence set — which surfaces as "not enough
  // participants to form a group", pointing at matching rather than at the harness.
  // Writing both is harmless and removes the guesswork.
  const results = await Promise.all([`${PROJECT}-default-rtdb`, PROJECT].map((ns) =>
    fetch(`http://localhost:9002/presence/${gid}/${pid}.json?ns=${ns}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
      body: 'true',
    }).then((r) => r.ok).catch(() => false),
  ))
  return results.some(Boolean)
}

const matchNow      = (gid) => callFn('triggerMatching', asDev(gid, {}))
const startClass    = (gid) => callFn('startAllGroups', asDev(gid, {}))
const dashboard     = (gid) => callFn('getGameDashboard', asDev(gid, {}))
const roundView     = (gid, pid, g) => callFn('getRoundView', asStudent(gid, pid, { group_id: g }))
const submitMessage    = (gid, pid, g, m) => callFn('submitMessage', asStudent(gid, pid, { group_id: g, message: m }))
const submitProduction = (gid, pid, g, q) => callFn('submitProduction', asStudent(gid, pid, { group_id: g, production: q }))

/** Instructor: "Score & Record" — the button that pushes to the gradebook. */
const scoreAndRecord = (gid) => callFn('scoreAndRecord',
  { _dev: { game_instance_id: gid, callback_url: CB, callback_secret: 'test' } })

/**
 * THE WIRE ASSERTION — run against the REAL seat view, every round, for every seat.
 *
 * ⚠ ABSENCE, NOT EMPTINESS. A hidden field's KEY must not be on the wire at all. The
 * test is `'demand_type' in view === false`, never `view.demand_type == null` — null is
 * a VALUE, it says "there is a field here and it is empty", and a Supplier reading the
 * network tab learns the field exists and can start guessing when it will be populated.
 * `Object.keys` is asserted alongside `in` because the two fail differently: `in` walks
 * the prototype chain, so a key materialised by a getter passes `in` and fails keys, and
 * a key set to undefined fails `in` and passes keys. Both, or neither is worth having.
 *
 * Returns the number of assertions made so a caller can prove it actually ran — an
 * assertion helper that silently checks nothing is the classic false green.
 */
function assertNoLeak(view, role, where) {
  /*
    ⚠ ONLY WHILE THE ROUND IS STILL OPEN — and this is a rule, not an exemption.

    The reveal is `revealAt: 'resolution'`, which is INCLUSIVE and PERMANENT: the instant
    a round resolves, the true type becomes visible to BOTH seats and stays visible. That
    is not a leak, it is the mechanism — a report that did not match is discoverable one
    round later, and without that there is no reputation and no game.

    So the window in which hiding means anything is exactly: this round has not resolved
    yet, i.e. `history.length < round`. After the FINAL round nothing new opens, so the
    view sits permanently on a resolved round and the true type is legitimately there.

    An earlier version of this helper asserted absence unconditionally and failed on round
    3 of 3 — the assertion was wrong, not the server. Narrowing it is only safe because
    the caller counts the assertions and requires a floor; a predicate that quietly
    excluded every round would otherwise turn this whole block green by checking nothing.
  */
  const roundIsOpen = view.history.length < view.round
  if (!roundIsOpen) return 0

  const keys = Object.keys(view)
  let n = 0

  // `actual_demand` is hidden from BOTH seats until the round resolves — nobody may see
  // the realised draw while a decision is still open.
  check(!('actual_demand' in view), `${where}: actual_demand absent from the ${role} view (in)`)
  check(!keys.includes('actual_demand'), `${where}: actual_demand absent from the ${role} view (keys)`)
  n += 2

  if (role === 'supplier') {
    // The whole game. The Supplier must not be able to see what the Retailer was shown.
    check(!('demand_type' in view), `${where}: demand_type absent from the supplier view (in)`)
    check(!keys.includes('demand_type'), `${where}: demand_type absent from the supplier view (keys)`)
    // Nor under the camelCase name the screen reads — the reveal happens server-side, but
    // a hand-written view mapper is exactly where a second, unfiltered copy appears.
    check(!('demandType' in view), `${where}: demandType absent from the supplier view (in)`)
    check(!keys.includes('demandType'), `${where}: demandType absent from the supplier view (keys)`)
    n += 4
  }
  return n
}

let leakChecks = 0
let strategyChecksRun = 0
let revealsAfter = 0
let historyRowsChecked = 0
const historyRowFaults = []
const seatRows = {}

/**
 * A completed history row must carry every field the table renders — not just the ones
 * whose names happen to be stable across a rewrite.
 *
 * ⚠ PRESENCE **AND** TYPE. `message: undefined` and `message: null` both render as a
 * blank cell, and so does a row that never had the key. All three are the failure Elena
 * saw, so `in` alone is not enough here — the value has to be usable.
 */
function assertHistoryRowComplete(row, role, where) {
  /*
    ⚠ NEGATIVE CONTROL — `BLANK_HISTORY=1` reproduces Elena's bug exactly: strip the four
    renamed fields and leave `profits` (the only names that survived the slice-1 rewrite),
    which is precisely the row a placeholder-era payload produces. The assertion MUST then
    fail. If a run with BLANK_HISTORY=1 is green, this whole block is decoration and every
    absence check above is passing on nothing.

    Four false greens in this build shared one property: the assertion was equally true of
    the broken state. This is the cheapest way to prove that this one is not.
  */
  if (process.env.BLANK_HISTORY === '1') {
    row = { round: row.round, sales: row.sales, profits: row.profits,
            truthful: row.truthful, defaulted: row.defaulted }
  }
  const want = {
    demandType: (v) => v === 'HIGH' || v === 'LOW',
    message: (v) => v === 'HIGH' || v === 'LOW',
    production: (v) => [1, 2, 3].includes(v),
    actualDemand: (v) => [1, 2, 3].includes(v),
    sales: (v) => typeof v === 'number' && Number.isFinite(v),
    round: (v) => typeof v === 'number' && v > 0,
  }
  for (const [k, ok] of Object.entries(want)) {
    if (!(k in row)) { historyRowFaults.push(`${where} ${role} r${row.round}: ${k} ABSENT`); continue }
    if (!ok(row[k])) historyRowFaults.push(`${where} ${role} r${row.round}: ${k}=${JSON.stringify(row[k])}`)
  }
  if (!row.profits || typeof row.profits.retailer !== 'number' || typeof row.profits.supplier !== 'number') {
    historyRowFaults.push(`${where} ${role} r${row.round}: profits malformed`)
  }
  historyRowsChecked++
}

/**
 * Play one round for a group, whoever holds which seat.
 *
 * ⚠ TWO PASSES, BECAUSE THE STAGES ARE SEQUENTIAL. The Supplier owes nothing until the
 * Retailer's message closes stage 1 — a single pass would find `owes: null` for the
 * Supplier and silently play half a round, and the round counter would never advance.
 *
 * The Retailer MISREPORTS in even rounds. A harness where every report is truthful never
 * exercises the case the game is about, and every leak assertion below would still pass
 * on a build that simply echoed the true type as the message.
 */
async function playRound(gid, groupId, pids, round) {
  for (const pass of [1, 2]) {
    for (const pid of pids) {
      const v = await roundView(gid, pid, groupId)
      if (!v.ok) continue
      const { owes, role, demandType } = v.result.view

      leakChecks += assertNoLeak(v.result.view, role, `round ${round} pass ${pass}`)
      if (role === 'supplier') {
        revealsAfter += v.result.view.history.filter(
          (h) => h.demandType === 'HIGH' || h.demandType === 'LOW').length
      }
      // ⚠ BOTH ROLES. History has no secrets once a round is over, so a row that is
      // complete for the retailer and gutted for the supplier is itself the bug.
      for (const h of v.result.view.history) {
        assertHistoryRowComplete(h, role, `round ${round} pass ${pass}`)
        // ⚠ KEYED BY GROUP, NOT JUST ROUND. Every group draws its own demand type, so a
        // round-only key compares group A's round 3 with group B's and reports a
        // disagreement that is simply two different games. Caught on the first run.
        const key = `${groupId}:${h.round}`
        const other = seatRows[key]
        if (other && other.role !== role) {
          // The two fields both seats must be able to reconcile after the fact.
          if (other.demandType !== h.demandType || other.message !== h.message) {
            historyRowFaults.push(
              `r${h.round}: seats disagree — ${other.role} saw ${other.message}/${other.demandType}, ` +
              `${role} saw ${h.message}/${h.demandType}`)
          }
        } else {
          seatRows[key] = { role, message: h.message, demandType: h.demandType }
        }
      }

      if (owes === 'message') {
        // The Retailer can see the true type — that is the one field they are allowed.
        check(demandType === 'HIGH' || demandType === 'LOW',
          `round ${round}: the retailer CAN see the true type (${demandType})`)
        leakChecks += 1
        const lie = round % 2 === 0
        const msg = lie ? (demandType === 'HIGH' ? 'LOW' : 'HIGH') : demandType
        await submitMessage(gid, pid, groupId, msg)
      } else if (owes === 'production') {
        // Believe the report: 3 lots on HIGH, 1 on LOW. Enough for a truthful and a
        // misleading round to produce visibly different profits.
        await submitProduction(gid, pid, groupId, v.result.view.currentMessage === 'HIGH' ? 3 : 1)
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
  await bringUp()

  // ── CLASSROOM: the attendance-code path, empty instance to gradebook ─────────
  banner('CLASSROOM — empty instance → roster → KC → attendance → match → START → play → push')
  {
    const gid = 'e2e-classroom'
    const PIDS = ['stu1', 'stu2', 'stu3', 'stu4']

    // 1. Sync roster (instructor). Proves the callback secret + roster URL wiring.
    const sr = await syncRoster(gid)
    check(sr.ok, `1. syncRoster — ${sr.ok ? `synced ${sr.result.synced}` : sr.error}`)
    check(rosterRequests > 0, '1. the game actually called the classroom roster endpoint')

    // 2. Attendance code (instructor).
    const gc = await genCode(gid)
    const code = gc.ok ? gc.result.code : null
    check(!!code, `2. generateAttendanceCode — ${code ?? gc.error}`)

    // 3. Each student: launch → KC → prep → ready → attendance code.
    let preGameOk = true
    for (const pid of PIDS) {
      const ar = await assignRole(gid, pid)
      if (!ar.ok) { preGameOk = false; console.log(`     assignRole(${pid}): ${ar.error}`) }
      const r = await studentPreGame(gid, pid, code)
      for (const [step, res] of Object.entries(r)) {
        if (!res.ok) { preGameOk = false; console.log(`     ${pid}/${step}: ${res.error}`) }
      }
      if (!(await beOnThePage(gid, pid))) { preGameOk = false; console.log(`     ${pid}/presence: failed`) }
    }
    check(preGameOk, '3. all four students completed launch → KC → prep → ready → attendance, and are ON THE PAGE')

    // 4. Match Now (instructor).
    const m = await matchNow(gid)
    check(m.ok, `4. triggerMatching — ${m.ok ? 'ok' : m.error}`)
    const d0 = await dashboard(gid)
    check(d0.ok && d0.result.groups.length === 2, `4. two groups formed (${d0.ok ? d0.result.groups.length : '?'})`)
    const g0 = d0.ok ? d0.result.groups : []
    check(g0.length === 2 && g0.every((g) => !g.started),
      '4. and NOTHING has started yet — matching does not start a game')

    // 5. ⚠ START CLASS — the step that was missing entirely in production.
    const st = await startClass(gid)
    check(st.ok, `5. startAllGroups — ${st.ok ? `started ${st.result.started}` : st.error}`)

    /*
      ⚠ RE-PRESSABLE, AND THIS IS THE ONLY CONTROL THAT STARTS A GROUP.
      There is deliberately NO per-group Start button: "Start class" is the escape hatch
      for the group that was not ready when the class began. That claim is only worth
      making if a second press is proved harmless, so press it again and require that
      every already-running group is REPORTED as already_running, that nothing is started
      a second time, and — the part that actually matters — that no group's round or
      history is rolled back. An idempotent call that silently reopened round 1 would
      still return a tidy summary.
    */
    const before = (await dashboard(gid)).result.groups.map((g) => [g.group_id, g.round, g.started])
    const st2 = await startClass(gid)
    check(st2.ok, `5. "Start class" is RE-PRESSABLE — ${st2.ok ? 'ok' : st2.error}`)
    check(st2.ok && st2.result.started === 0,
      `5. a second press starts nothing new (started=${st2.ok ? st2.result.started : '?'})`)
    check(st2.ok && st2.result.already_running === before.length,
      `5. and reports all ${before.length} running groups as already_running ` +
      `(got ${st2.ok ? st2.result.already_running : '?'})`)
    const after = (await dashboard(gid)).result.groups.map((g) => [g.group_id, g.round, g.started])
    check(JSON.stringify(before) === JSON.stringify(after),
      '5. and NO running group was reset — same round and started flag before and after')
    const d1 = await dashboard(gid)
    // ⚠ LENGTH FIRST, ALWAYS. `[].every(...)` is true, so an assertion written only as
    // `every(...)` reports success against zero groups. The first run of this harness did
    // exactly that — it announced "every group is now STARTED" while nothing existed.
    const g1 = d1.ok ? d1.result.groups : []
    check(g1.length === 2 && g1.every((g) => g.started),
      `5. every group is now STARTED — the control an instructor presses opens round 1 (${g1.length} groups)`)
    check(g1.length === 2 && g1.every((g) => g.round === 1), '5. and all are on round 1')

    // 5b. Re-pressable, and it does not reset a running group.
    const again = await startClass(gid)
    check(again.ok && again.result.started === 0, '5b. pressing Start class again starts nothing and breaks nothing')
    const g1b = (await dashboard(gid)).result?.groups ?? []
    check(g1b.length === 2 && g1b.every((g) => g.round === 1), '5b. running groups were not reset')

    // 6. Play all three rounds, as students.
    const groups = d1.result.groups
    const rosterSnap = await callFn('getRoster', asDev(gid, {}))
    const byGroup = {}
    for (const g of rosterSnap.result.groups) {
      byGroup[g.group_id] = Object.values(g.participants_by_role ?? {}).flat()
    }
    for (let r = 1; r <= 3; r++) {
      for (const g of groups) await playRound(gid, g.group_id, byGroup[g.group_id] ?? [], r)
    }
    const gEnd = (await dashboard(gid)).result?.groups ?? []
    check(gEnd.length === 2 && gEnd.every((g) => g.status === 'finished'),
      `6. all groups finished all 3 rounds through the student callables (${gEnd.length} groups)`)

    // 7. History reached the student payload.
    check(groups.length === 2 && (byGroup[groups[0].group_id] ?? []).length === 2,
      '6. the roster reports 2 seats per group')
    const anyPid = (byGroup[groups[0]?.group_id] ?? [])[0]
    const v = await roundView(gid, anyPid, groups[0].group_id)
    check(v.ok && v.result.view.history.length === 3, '7. the student sees 3 completed rounds in history')

    // 8. Reports (instructor).
    const rep = await callFn('getRoundReport', asDev(gid, {}))
    check(rep.ok && rep.result.rows.length === 6, `8. per-round report has 6 rows (2 groups × 3 rounds) — got ${rep.ok ? rep.result.rows.length : '?'}`)

    // 9. ⚠ SCORE & RECORD — the gradebook push must LAND classroom-side.
    pushed = []
    const sc = await scoreAndRecord(gid)
    await sleep(800)
    check(sc.ok, `9. scoreAndRecord — ${sc.ok ? `scored ${sc.result.scored}` : sc.error}`)
    check(pushed.length === 4, `9. FOUR gradebook records LANDED at the classroom (got ${pushed.length})`)
    check(pushed.every((p) => p.game_instance_id === gid && p.participant_id),
      '9. every pushed record carries the instance and a participant')
    check(pushed.every((p) => typeof p.normalized_score === 'number'),
      '9. every pushed record carries a normalized score')

    // 10. The roster report AFTER scoring. It filters on `finalized_at`, which
    // scoreAndRecord sets — so checking it before the push reports zero students and
    // looks like a broken report. Order matters, and this is the order an instructor uses.
    const base = await callFn('getReportData', asDev(gid, {}))
    check(base.ok && base.result.rows.length === 4,
      `10. the roster report lists all 4 students once scored (got ${base.ok ? base.result.rows.length : '?'})`)
  }

  // ── ONLINE: pre-grouped, no clock, groups auto-open on arrival ───────────────
  banner('ONLINE — pre-group → students arrive → auto-open (NO Start button) → play')
  {
    const gid = 'e2e-online'
    const PIDS = ['stu1', 'stu2']

    await syncRoster(gid)
    // Online is selected by the instructor turning the clock off.
    const cfg = await callFn('updateGameConfig', asDev(gid, { clock_mode: 'off' }))
    check(cfg.ok, `1. updateGameConfig clock_mode=off — ${cfg.ok ? 'ok' : cfg.error}`)

    for (const pid of PIDS) {
      await assignRole(gid, pid)
      await callFn('submitKnowledgeCheck', asStudent(gid, pid, { answer: 'player' }))
      await callFn('completePrep', asStudent(gid, pid, {}))
      await beOnThePage(gid, pid)
    }

    // 2. Instructor pre-groups the roster — the online equivalent of Match Now.
    const gp = await callFn('groupParticipantsOnline', asDev(gid, {}))
    check(gp.ok, `2. groupParticipantsOnline — ${gp.ok ? `${gp.result.groups} group(s)` : gp.error}`)
    const og = await callFn('getOnlineGroups', asDev(gid, {}))
    check(og.ok && og.result.groups.length >= 1, '2. the grouping panel can read the groups back')

    // 3. Students arrive. THE POINT: no Start button is pressed anywhere.
    for (const pid of PIDS) {
      const rl = await callFn('recordLogin', asStudent(gid, pid, {}))
      check(rl.ok, `3. recordLogin(${pid}) — ${rl.ok ? `mode ${rl.result.clock_mode ?? 'off'}` : rl.error}`)
    }
    // Reaching the game screen IS arriving: the student's GameScreen polls getRoundView.
    const og2 = await callFn('getOnlineGroups', asDev(gid, {}))
    const firstGroup = og2.result.groups[0]
    for (const pid of firstGroup.occupants.map((o) => o.participant_id)) {
      await roundView(gid, pid, firstGroup.group_id)
    }
    await sleep(600)
    const d = await dashboard(gid)
    const started = d.ok ? d.result.groups.filter((g) => g.started).length : 0
    check(started >= 1, `3. a group AUTO-OPENED on arrival with NO Start press (${started} started)`)

    // 4. The assignment-status report — the instructor's online surface.
    const orep = await callFn('getOnlineReport', asDev(gid, {}))
    check(orep.ok, `4. getOnlineReport — ${orep.ok ? 'ok' : orep.error}`)
    check(orep.ok && orep.result.students.length >= 2, '4. and it lists the students')
    // The arrived[] fix (game-server 0.22.0) — presence, not absence.
    check(orep.ok && orep.result.students.some((s) => s.arrived === true),
      '4. arrivals are RECORDED, not reported as "not recorded"')

    // 5. PLAY IT OUT — the online path must reach the gradebook too, not just the game
    // screen. Stopping at "a group opened" would leave the entire online scoring path
    // unexercised, and online is the mode nobody is watching when it breaks.
    const pids = firstGroup.occupants.map((o) => o.participant_id)
    for (let r = 1; r <= 3; r++) await playRound(gid, firstGroup.group_id, pids, r)
    const dEnd = await dashboard(gid)
    const fin = dEnd.ok ? dEnd.result.groups.filter((g) => g.status === 'finished').length : 0
    check(fin >= 1, `5. the online group played all 3 rounds to completion (${fin} finished)`)

    // 6. ⚠ AND THE PUSH LANDS. Same assertion as the classroom path — read at the
    // classroom, not from the tick in our own UI.
    pushed = []
    const sc = await scoreAndRecord(gid)
    await sleep(800)
    check(sc.ok, `6. scoreAndRecord (online) — ${sc.ok ? `scored ${sc.result.scored}` : sc.error}`)
    check(pushed.length >= 2, `6. gradebook records LANDED at the classroom from the ONLINE path (got ${pushed.length})`)
    check(pushed.every((p) => typeof p.normalized_score === 'number'),
      '6. every online pushed record carries a normalized score')
  }


  // ═══════════════════════════════════════════════════════════════════════════════
  // BOTS — a COMPLETE UNATTENDED GAME, driven by the SERVER runner.
  //
  // ⚠ TEN ROUNDS, NOT THREE. The strategies only become visible over a run: the lie, the
  // punishment, the re-test and the recovery need rounds to happen IN. A three-round
  // smoke would pass against a bot that reported at random — exactly the placeholder
  // this slice replaced.
  //
  // ⚠ AND NOBODY DECIDES ANYTHING. No submitMessage or submitProduction is called here
  // at all. getRoundView is polled, which is what a student's screen does while they sit
  // and watch. If the group finishes, it is because the server runner drove the seats
  // through the same transaction core a human hits.
  //
  // ⚠ THREE STUDENTS, BECAUSE THE ODD SEAT IS THE POINT. Groups are two, so an odd class
  // leaves exactly one leftover — every time it is odd. That leftover's group is SHORT,
  // and topUpGroupWithBots fills it. One student alone never forms a group at all, so
  // there would be nothing to top up.
  // ═══════════════════════════════════════════════════════════════════════════════
  banner('BOTS (CLASSROOM) — odd seat filled by a bot → ten rounds unattended → gradebook')
  {
    const gid = 'e2e-bots'
    await syncRoster(gid)
    await callFn('updateGameConfig', asDev(gid, { num_rounds: 10 }))

    // ⚠ THE FULL LAUNCH PATH, INCLUDING THE ATTENDANCE CODE. Classroom matching only
    // considers students who are PRESENT. Skipping the code leaves three students who
    // have done everything except arrive, and matching correctly forms nothing — which
    // reads as "matching is broken" and is not.
    const code = (await genCode(gid)).result?.code
    const PIDS3 = ['stu1', 'stu2', 'stu3']
    for (const pid of PIDS3) {
      await assignRole(gid, pid)
      await studentPreGame(gid, pid, code)
      await beOnThePage(gid, pid)
    }
    await matchNow(gid)

    const d0 = await dashboard(gid)
    const groups0 = d0.result?.groups ?? []
    check(groups0.length >= 1, `1. matching formed ${groups0.length} group(s) from 3 students`)

    const rosterSnap = await callFn('getRoster', asDev(gid, {}))
    const membersById = {}
    for (const g of rosterSnap.result?.groups ?? []) {
      membersById[g.group_id] = Object.values(g.participants_by_role ?? {}).flat()
    }
    const membersOf = (g) => membersById[g.group_id] ?? []
    /*
      ⚠ NO SHORT GROUP TO FIND — AND THAT IS THE FEATURE. `triggerMatching` is chained:
      it forms the full human groups and then bot-fills the leftover in the same action,
      so by the time matching returns, the odd student is ALREADY in a full group with a
      robot. An instructor never sees a short group and never has to know a second button
      exists. So the group to drive is the one with a BOT in it, not the one with a
      missing seat.
    */
    const short = groups0.find((g) => membersOf(g).some((pid) => String(pid).startsWith('bot_')))
    check(!!short, `2. matching bot-filled the odd student's group (sizes: ${groups0.map((g) => membersOf(g).length).join(', ')})`)
    if (!short) throw new Error('no bot-filled group — the odd-seat case cannot be exercised')
    check(membersOf(short).length === 2,
      `2. and that group is FULL — one human, one robot (${membersOf(short).join(', ')})`)

    // Pressing Match again must not mint a second bot group for a student who has one.
    const again = await matchNow(gid)
    const d1 = await dashboard(gid)
    check(again.ok && (d1.result?.groups ?? []).length === groups0.length,
      `2. re-matching is idempotent — still ${groups0.length} groups`)

    const st = await startClass(gid)
    check(st.ok, `3. Start class — ${st.ok ? `started ${st.result.started}` : st.error}`)

    const humanPid = membersOf(short).find((pid) => !String(pid).startsWith('bot_'))
    const botGroupNow = async () => {
      const dd = await dashboard(gid)
      return (dd.result?.groups ?? []).find((g) => g.group_id === short.group_id)
    }

    // ⚠ IDEMPOTENCY, FIRED TWICE, CHECKED ON THE STATE. The runner is idempotent by
    // construction — the engine rejects a seat that has already acted this stage — and
    // the proof is that the ROUND does not jump. Checking the return value would only
    // prove the runner agrees with itself.
    const beforeR = (await botGroupNow())?.round ?? 0
    await callFn('getRoundView', asStudent(gid, humanPid, { group_id: short.group_id })).catch(() => {})
    await callFn('getRoundView', asStudent(gid, humanPid, { group_id: short.group_id })).catch(() => {})
    const afterR = (await botGroupNow())?.round ?? 0
    check(afterR - beforeR <= 1, `4. two bot passes did not double-advance the round (${beforeR} → ${afterR})`)

    /*
      ⚠ THE HUMAN SEAT MUST ACT — this group is ONE human and ONE robot, which is what an
      odd class actually produces. An earlier version of this gate polled and asserted
      "no human action", and the group correctly sat at round 1 forever: half of every
      round belonged to a student who was never going to press anything.
      "Unattended" describes the BOT's seat, not the group.

      So the human plays a fixed, deliberately dumb policy — always report the truth,
      always produce 2 — and every assertion below is about what the BOT did opposite it.
    */
    let bg = null
    for (let i = 0; i < 120; i++) {
      const v = await callFn('getRoundView', asStudent(gid, humanPid, { group_id: short.group_id }))
      if (v.ok) {
        const view = v.result.view
        if (view.owes === 'message') {
          await submitMessage(gid, humanPid, short.group_id, view.demandType)
        } else if (view.owes === 'production') {
          await submitProduction(gid, humanPid, short.group_id, 2)
        }
      }
      bg = await botGroupNow()
      if (bg?.status === 'finished') break
      await sleep(120)
    }
    check(bg?.status === 'finished',
      `5. ten rounds played out against the server bot (${bg?.status} @ round ${bg?.round})`)

    // 6. THE STRATEGIES RAN — assert the history, not merely that it finished.
    const rep = await callFn('getRoundReport', asDev(gid, {}))
    const rows = (rep.ok ? rep.result.rows : []).filter((r) => r.group_id === short.group_id)
    check(rows.length === 10, `6. ten rounds on record for the bot group (got ${rows.length})`)
    /*
      ⚠ ASSERT ONLY THE SEAT THE BOT ACTUALLY HOLDS. This group is one human and one
      robot, and role assignment is late — the bot may be Retailer OR Supplier. An
      earlier version asserted BOTH strategies over the same ten rounds and failed on
      "production after LOW never changed", because production was the HUMAN's, and the
      human here deliberately produces 2 every round. The assertion was true of the bot
      and false of the group, which is the sort of failure that reads as a bot bug and
      is not one.
    */
    /*
      ⚠ THE BOT'S ROLE COMES FROM THE HUMAN'S OWN VIEW, and this is not a workaround.
      A group is two seats with two distinct roles, so whichever role the human does not
      hold is the bot's — derived from a shape that is already load-bearing rather than
      one invented for the test.

      Two earlier attempts read fields that do not exist: `retailer_participant_id` off
      the report rows, then `pidBySeat`/`roleBySeat` off getInstructorRoundView (which
      returns `{ ok, state, history }` and no seat→pid map at all). Both produced
      "unknown" and silently skipped every strategy assertion below — a check that never
      runs, which is the exact shape of the false greens this build keeps producing.
    */
    const humanView = await callFn('getRoundView', asStudent(gid, humanPid, { group_id: short.group_id }))
    const humanRole = humanView.ok ? humanView.result.view.role : null
    const botRole = humanRole === 'retailer' ? 'supplier' : humanRole === 'supplier' ? 'retailer' : null
    check(botRole === 'retailer' || botRole === 'supplier',
      `6. the bot's role is known — human is ${humanRole ?? '?'}, so the bot is ${botRole ?? 'unknown'}`)
    // ⚠ AND THE BRANCH BELOW MUST ACTUALLY EXECUTE. Counting assertions is not the same
    // as running them: if botRole were null the whole strategy block would be skipped and
    // the suite would still report a rising pass count.
    strategyChecksRun = 0

    if (botRole === 'retailer') {
      const highRows = rows.filter((r) => r.demandType === 'HIGH')
      check(highRows.length > 0 && highRows.every((r) => r.message === 'HIGH'),
        `6. RETAILER bot reported HIGH on every HIGH round (${highRows.length} such rounds)`)
      strategyChecksRun++
    } else if (botRole === 'supplier') {
      const lowReports = rows.filter((r) => r.message === 'LOW')
      check(lowReports.length > 0 && lowReports.every((r) => r.production === 1),
        `6. SUPPLIER bot produced 1 after every LOW report (${lowReports.length} such rounds)`)
      const cleanHigh = rows.filter((r) => r.message === 'HIGH' &&
        !rows.some((p) => p.round < r.round && p.message === 'HIGH' && p.demandType === 'LOW'))
      check(cleanHigh.every((r) => r.production === 3),
        `6. SUPPLIER bot produced 3 after HIGH while never yet lied to (${cleanHigh.length} rounds)`)
      strategyChecksRun += 2
    }
    check(strategyChecksRun > 0,
      `6. the strategy assertions ACTUALLY RAN (${strategyChecksRun}) — not skipped by an unknown role`)

    // 7. ⚠ THE PUSH LANDS, AND THE BOT IS NOT IN IT.
    pushed = []
    const sc = await scoreAndRecord(gid)
    await sleep(800)
    check(sc.ok, `7. scoreAndRecord — ${sc.ok ? `scored ${sc.result.scored}` : sc.error}`)
    check(pushed.length > 0, `7. gradebook records LANDED from a bot-driven game (${pushed.length})`)
    check(pushed.every((p) => !String(p.participant_id).startsWith('bot_')),
      '7. and NO bot appears in the gradebook')
  }

  // ⚠ ONLINE IS THE HARDER CASE FOR BOTS. There is no clock, so nothing defaults a seat
  // the runner failed to drive — the polling backstop is the ONLY thing moving the game.
  // A bot bug that classroom mode papers over with a timeout hangs here forever.
  banner('BOTS (ONLINE) — no clock, backstop only → unattended → gradebook')
  {
    const gid = 'e2e-bots-online'
    await syncRoster(gid)
    await callFn('updateGameConfig', asDev(gid, { clock_mode: 'off', num_rounds: 10 }))

    // ⚠ THREE ELIGIBLE STUDENTS, SO THE CLASS IS ODD. With an even number online
    // grouping pairs everyone and there is no seat for a bot at all — an earlier version
    // used one student, the synced roster supplied a partner, and the "no robot in the
    // group" failure was the fixture's fault rather than the runner's.
    const ONLINE3 = ['stu1', 'stu2', 'stu3']
    for (const pid of ONLINE3) {
      await assignRole(gid, pid)
      await callFn('submitKnowledgeCheck', asStudent(gid, pid, { answer: 'player' }))
      await callFn('completePrep', asStudent(gid, pid, {}))
      await beOnThePage(gid, pid)
    }
    // One online student is an odd class of one: the chained matcher pairs them with a
    // robot, exactly as it does in a classroom.
    /*
      ⚠ THE REAL INSTRUCTOR WORKFLOW: PRE-GROUP EVERYONE, THEN UNGROUP THE NO-SHOWS.

      Online grouping pairs every rostered student regardless of pre-game state, so a
      roster of four produces two full human groups and there is no seat for a bot at
      all. Two earlier attempts tried to make a student INELIGIBLE beforehand; grouping
      ignores eligibility, so both failed and it read as a bot fault.

      Ungrouping after the fact is not a trick to make the fixture work — it is what an
      instructor actually does when someone does not turn up, and it leaves exactly the
      state a bot exists to repair: a group one seat short, mid-setup.
    */
    await callFn('groupParticipantsOnline', asDev(gid, {}))
    const ogAll = await callFn('getOnlineGroups', asDev(gid, {}))
    const groupsAll = ogAll.result?.groups ?? []
    check(groupsAll.length >= 1, `1. online pre-grouping formed ${groupsAll.length} group(s)`)

    const victimGroup = groupsAll[0]
    const noShow = (victimGroup?.occupants ?? [])[1]?.participant_id
    check(!!noShow, `1. a group with two occupants to ungroup from (${(victimGroup?.occupants ?? []).length})`)
    if (!noShow) throw new Error('no two-occupant online group to ungroup from')

    // Empty target_group_id → ungroup. This is the "no-show" case.
    const mv = await callFn('moveSeat', asDev(gid, { participant_id: noShow, target_group_id: '' }))
    check(mv.ok, `2. ungrouped the no-show ${noShow} — ${mv.ok ? 'ok' : mv.error}`)

    const ogShort = await callFn('getOnlineGroups', asDev(gid, {}))
    const g0 = (ogShort.result?.groups ?? []).find((g) => g.group_id === victimGroup.group_id)
    check((g0?.occupants ?? []).length === 1,
      `2. that group is now SHORT — one human waiting (${(g0?.occupants ?? []).length})`)
    if (!g0) throw new Error('the ungrouped-from group vanished')

    const top = await callFn('topUpGroupWithBots', asDev(gid, { group_id: g0.group_id }))
    check(top.ok && top.result.added === 1,
      `2. topUpGroupWithBots filled the empty seat (added ${top.ok ? top.result.added : '?'})`)
    const ogFull = await callFn('getOnlineGroups', asDev(gid, {}))
    const occ = (ogFull.result?.groups ?? []).find((g) => g.group_id === g0.group_id)?.occupants ?? []
    check(occ.some((o) => String(o.participant_id).startsWith('bot_')),
      `2. and the online group now contains a robot (${occ.map((o) => o.participant_id).join(', ')})`)

    for (const pid of ONLINE3) await callFn('recordLogin', asStudent(gid, pid, {}))
    let bg = null
    for (let i = 0; i < 120; i++) {
      const humanOnline = occ.map((o) => o.participant_id).find((pid) => !String(pid).startsWith('bot_'))
      const v = await callFn('getRoundView', asStudent(gid, humanOnline, { group_id: g0.group_id }))
      if (v.ok) {
        const view = v.result.view
        if (view.owes === 'message') await submitMessage(gid, humanOnline, g0.group_id, view.demandType)
        else if (view.owes === 'production') await submitProduction(gid, humanOnline, g0.group_id, 2)
      }
      const dd = await dashboard(gid)
      bg = (dd.result?.groups ?? []).find((g) => g.group_id === g0.group_id)
      if (bg?.status === 'finished') break
      await sleep(120)
    }
    // ⚠ NO CLOCK HERE AT ALL. Every bot action in this block came from the polling
    // backstop; if the backstop were removed this block would hang rather than fail.
    check(bg?.status === 'finished',
      `3. the online group finished with NO clock — bots driven purely by the backstop (${bg?.status} @ round ${bg?.round})`)

    pushed = []
    const sc = await scoreAndRecord(gid)
    await sleep(800)
    check(sc.ok, `4. scoreAndRecord (online bots) — ${sc.ok ? `scored ${sc.result.scored}` : sc.error}`)
    check(pushed.length > 0, `4. gradebook records LANDED from the ONLINE bot game (${pushed.length})`)
    check(pushed.every((p) => !String(p.participant_id).startsWith('bot_')),
      '4. and no bot appears in the online gradebook either')
  }

  // ⚠ THE HELPER MUST HAVE RUN. Every leak assertion lives inside assertNoLeak, and a
  // helper that is never reached passes vacuously — `[].every()` is true. Counting the
  // assertions and requiring a floor is what makes the block above evidence rather than
  // decoration.
  check(leakChecks >= 40, `WIRE: the leak assertions actually ran (${leakChecks} made across both paths)`)

  /*
    ═══════════════════════════════════════════════════════════════════════════════
    THE HISTORY ROW MUST BE COMPLETE — AND THIS IS WHY THE LEAK ASSERTIONS NEED IT.
    ═══════════════════════════════════════════════════════════════════════════════

    ⚠ EVERY ABSENCE CHECK ABOVE PASSES TRIVIALLY IF THE FIELD IS NEVER WRITTEN AT ALL.
    "demand_type is absent from the supplier's view" is equally true of a working reveal
    and of a build that simply dropped the field on the floor. Elena found exactly that on
    a real Game-over screen: four columns blank — Actual Forecast, Reported Forecast,
    Production, Customer Demand — while the profits rendered fine. Profits are the ONLY
    fields whose names survived the slice-1 rewrite, so a row carrying just those is the
    signature of a payload built by the placeholder-era code.

    `revealsAfter` was supposed to be the complement, and it was not enough: it only
    counted rows where demandType happened to be set, so zero rows would have meant zero
    counted and the check merely required "> 0" somewhere in the run.

    So this asserts, on EVERY completed row of EVERY seat: all six substantive fields
    PRESENT, of the right TYPE, and — for the two that both seats must be able to
    reconcile — carrying the SAME value for the retailer and the supplier. A blank column
    can no longer hide behind a green absence check.
  */
  check(revealsAfter > 0,
    `WIRE: and the truth DOES reach the supplier once a round is over (${revealsAfter} rounds seen)`)
  check(historyRowsChecked > 0,
    `WIRE: history rows were actually inspected (${historyRowsChecked}) — not zero rows passing vacuously`)
  check(historyRowFaults.length === 0,
    `WIRE: every history row is COMPLETE for both seats` +
    (historyRowFaults.length ? ` — ${historyRowFaults.slice(0, 4).join('; ')}` : ''))

  banner(`RESULT — ${PASS} passed, ${FAIL} failed`)
  return FAIL === 0
}

main()
  .then((ok) => { tearDown(); process.exit(ok ? 0 : 1) })
  .catch((e) => { console.error(e); tearDown(); process.exit(1) })
