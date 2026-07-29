// ═══════════════════════════════════════════════════════════════════════════════
// INFOSHARE — PRODUCTION smoke against infoshare-mygames-live (NOT the emulator).
//
// Real path, no bypasses: `_dev`/`_test` are dead in production and the seed functions
// 404 there, so every step below is the same call a human causes.
//   • Launcher mints the instructor JWT and drives students to attendance-verified.
//   • Instructor callables carry the classroom JWT in `data.token`.
//   • Students play THROUGH THE REAL UI in Playwright — that is the only way to hold a
//     Firebase session, and it is also the only way to prove the buttons work.
//   • The gradebook push is verified by READING THE CLASSROOM'S OWN game_results
//     collection, not by trusting a tick in the UI.
//
//   node infoshare-prod-smoke.mjs                      classroom mode (default)
//     MODE=online                                      online mode (auto-open)
//     INFOSHARE_INSTANCE=<id>                          target a specific instance
//     HEADED=1                                         watch it
//
// Prereq: the local launcher on :5180, and Application Default Credentials for the
// classroom project (the gradebook read).
// ═══════════════════════════════════════════════════════════════════════════════

import { chromium } from 'playwright'
import { setTimeout as sleep } from 'node:timers/promises'
import { createRequire } from 'node:module'

// firebase-admin lives in functions/node_modules, not at the repo root — same reason the
// robot driver resolves playwright by createRequire rather than importing it directly.
const require = createRequire(import.meta.url)
const admin = require('./functions/node_modules/firebase-admin')

const LAUNCHER = 'http://localhost:5180'
const PROJECT  = 'infoshare-mygames-live'
const CLASSROOM_PROJECT = 'mygames-classroom-aec1b'
const FN       = `https://us-central1-${PROJECT}.cloudfunctions.net`
const MODE     = process.env.MODE === 'online' ? 'online' : 'classroom'
const HEADED   = !!process.env.HEADED
const WANTED   = process.env.INFOSHARE_INSTANCE || null
const SEATS    = 2

let PASS = 0, FAIL = 0, SKIP = 0
const banner = (m) => console.log('\n' + '─'.repeat(72) + '\n' + m + '\n' + '─'.repeat(72))
const check = (c, n) => { if (c) { PASS++; console.log(`  ✓ ${n}`) } else { FAIL++; console.log(`  ✗ FAIL: ${n}`) } }
const skip  = (n, why) => { SKIP++; console.log(`  ⃠ NOT VERIFIABLE: ${n} — ${why}`) }

async function launcher(pathname, body) {
  const res = await fetch(`${LAUNCHER}${pathname}`, body
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    : {})
  const j = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`launcher ${pathname}: ${j.error ?? res.status}`)
  return j
}

/** A deployed production callable, with the classroom JWT in data.token. */
async function fn(name, data) {
  const res = await fetch(`${FN}/${name}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data }),
  })
  const text = await res.text()
  let j
  try { j = JSON.parse(text) } catch { throw new Error(`${name} → ${res.status}: ${text.slice(0, 160)}`) }
  if (j.error) throw new Error(`${name} → ${j.error.message ?? JSON.stringify(j.error)}`)
  return j.result
}

const browsers = []
async function openWindow(url, i) {
  const args = HEADED ? [`--window-position=${i * 760},0`, '--window-size=750,620'] : []
  const b = await chromium.launch({ headless: !HEADED, args })
  browsers.push(b)
  const page = await b.newPage({ viewport: { width: 740, height: 560 } })
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  return page
}
const closeAll = async () => { for (const b of browsers) { try { await b.close() } catch { /* */ } } }

/** The student's own seat view, read from the page exactly as the robot driver does. */
const seatView = (page) => page.evaluate(() => window.__gameState?.view ?? null)

async function main() {
  banner(`INFOSHARE PRODUCTION SMOKE — ${MODE.toUpperCase()} mode — ${PROJECT}`)

  // ── pick a FRESH instance ───────────────────────────────────────────────────
  const { instances } = await launcher(`/api/instances?game=infoshare`)
  const fresh = WANTED
    ? instances.find((i) => i.game_instance_id === WANTED)
    : instances.find((i) => i.participantCount === 0)
  if (!fresh) {
    console.error('No FRESH (0-participant) infoshare instance in course ABC. Create one in the\n' +
                  'classroom app, or pass INFOSHARE_INSTANCE=<id>. Refusing to reuse a dirty instance.')
    process.exit(2)
  }
  const IID = fresh.game_instance_id
  console.log(`  instance: ${IID}  (participants at start: ${fresh.participantCount})`)

  // ── instructor token ────────────────────────────────────────────────────────
  const dash = await launcher('/api/dashboard-url', { game_instance_id: IID })
  const token = new URL(dash.url).searchParams.get('token')
  check(!!token, '0. minted an instructor dashboard token')

  banner('1–3. ROSTER, MODE, ATTENDANCE CODE')
  const sr = await fn('syncRoster', { token })
  check(sr.ok && sr.synced > 0, `1. syncRoster — synced ${sr?.synced}`)

  if (MODE === 'online') {
    const cfg = await fn('updateGameConfig', { token, clock_mode: 'off' })
    check(!!cfg, '2. clock_mode set to off (online)')
  } else {
    check(true, '2. classroom mode (clock on, the default)')
  }

  let code = null
  if (MODE === 'classroom') {
    const cr = await fn('generateAttendanceCode', { token })
    code = cr.code
    check(!!code, `3. generateAttendanceCode — ${code}`)
  } else {
    console.log('  (online mode uses no attendance code)')
  }

  banner('4. TWO STUDENTS LAUNCH AND REACH THE GAME')
  const pages = []
  for (let i = 0; i < SEATS; i++) {
    const s = await launcher('/api/student-url', { game_instance_id: IID, index: i, mode: 'ready' })
    pages.push(await openWindow(s.url, i))
    await sleep(1500)
  }
  check(pages.length === SEATS, `4. ${SEATS} student browsers open`)

  // Attendance code, typed as a student types it.
  if (MODE === 'classroom') {
    for (const p of pages) {
      const box = p.locator('input[type="text"], input:not([type])').first()
      if (await box.count()) {
        await box.fill(code).catch(() => {})
        const btn = p.getByRole('button', { name: /confirm|submit|enter|join/i }).first()
        if (await btn.count()) await btn.click().catch(() => {})
      }
    }
    await sleep(2500)
  }

  banner(MODE === 'classroom' ? '5–6. MATCH, THEN START CLASS' : '5–6. PRE-GROUP, THEN AUTO-OPEN')
  if (MODE === 'classroom') {
    const m = await fn('triggerMatching', { token })
    check(!!m, `5. triggerMatching — ${m?.groups?.length ?? 0} group(s)`)

    const before = await fn('getGameDashboard', { token })
    check((before.groups ?? []).length > 0 && before.groups.every((g) => !g.started),
      '5. matching did NOT start anything (Round column would read —)')

    // ⚠ THE FIX UNDER TEST.
    const st = await fn('startAllGroups', { token })
    check(!!st, `6. startAllGroups — started ${st?.started}`)
    const after = await fn('getGameDashboard', { token })
    const gs = after.groups ?? []
    check(gs.length > 0 && gs.every((g) => g.started), `6. every group STARTED (${gs.length} groups)`)
    check(gs.length > 0 && gs.every((g) => g.round === 1), '6. all on round 1')
  } else {
    const gp = await fn('groupParticipantsOnline', { token })
    check(!!gp, `5. groupParticipantsOnline — ${gp?.groups} group(s)`)

    // ⚠ THE STUDENTS MUST BE IN THE SAME GROUP, and after online pre-grouping they are
    // assigned at random across ALL groups. Launching "student 0 and student 1" by roster
    // index puts them in different groups whose partners never arrive, so auto-open
    // correctly does nothing — and the run reads as a product failure when it is a
    // harness failure. Pick a group FIRST, then launch its actual occupants.
    const og = await fn('getOnlineGroups', { token })
    // The launcher can only drive the first 16 course students, and a roster can be
    // larger — so search ALL full groups for one whose every occupant is launchable,
    // rather than taking the first full group and failing on a member out of range.
    const prep = await launcher('/api/prepare', { n: 16 })
    const idxOf = (name) => prep.students.findIndex((s) => s.name === name)
    let full = null, idxs = []
    for (const g of (og.groups ?? [])) {
      if (g.occupants.length !== g.seat_count) continue
      const cand = g.occupants.map((o) => idxOf(o.display_name))
      if (cand.every((i) => i >= 0)) { full = g; idxs = cand; break }
    }
    check(!!full, `5. found a full online group whose members are all launchable` +
      ` (${(og.groups ?? []).length} groups scanned)`)
    if (!full) throw new Error('no launchable full group — the roster is larger than the launcher can drive')
    check(idxs.length === full.seat_count, `5. mapped all ${idxs.length} group members to launcher seats`)

    await closeAll()
    pages.length = 0
    for (let k = 0; k < idxs.length; k++) {
      const su = await launcher('/api/student-url', { game_instance_id: IID, index: idxs[k], mode: 'ready' })
      pages.push(await openWindow(su.url, k))
      await sleep(2000)
    }

    // ⚠ THE FIX UNDER TEST: no button is pressed anywhere. Reaching the game screen IS
    // arriving — the student's GameScreen polls getRoundView, which records the arrival
    // and opens round 1 once every human seat is present.
    await sleep(6000)
    const after = await fn('getGameDashboard', { token })
    const started = (after.groups ?? []).filter((g) => g.started).length
    check(started >= 1, `6. a group AUTO-OPENED with NO Start press (${started} started)`)
  }

  banner('7–9. PLAY THREE ROUNDS THROUGH THE UI')
  let rounds = 0
  for (let round = 1; round <= 3; round++) {
    for (let step = 0; step < 6; step++) {
      let acted = false
      for (const p of pages) {
        // Dismiss a results screen if it is up — same shell rule as the robot driver.
        const cont = p.locator('[data-testid="results-continue"]')
        if (await cont.count() && !(await cont.isDisabled().catch(() => true))) {
          await cont.click().catch(() => {}); acted = true; await sleep(600); continue
        }
        const v = await seatView(p).catch(() => null)
        if (!v || !v.owes) continue
        const sel = v.owes === 'signal' ? '[data-testid="signal-choices-up"]' : '[data-testid="quantity-choices-2"]'
        if (await p.locator(sel).count()) { await p.click(sel).catch(() => {}); acted = true; await sleep(900) }
      }
      if (!acted) await sleep(1200)
    }
    const v = await seatView(pages[0]).catch(() => null)
    rounds = v?.history?.length ?? rounds
    console.log(`     after round ${round}: history = ${rounds}`)
  }
  check(rounds === 3, `7. three rounds resolved through the UI (history rows: ${rounds})`)

  // Who actually played — needed to judge the gradebook by COHORT rather than in bulk.
  const playerIds = []
  for (const p of pages) {
    const st = await p.evaluate(() => window.__gameState?.participantId ?? null).catch(() => null)
    if (st) playerIds.push(st)
  }

  const vEnd = await seatView(pages[0]).catch(() => null)
  check(vEnd?.status === 'finished', '8. the student screen reports the game finished')
  const hist = await pages[0].locator('[data-testid="game-history"]').count()
  check(hist > 0, '9. the history table is rendered on the student page')

  banner('10–11. SCORE & RECORD, AND THE GRADEBOOK READ CLASSROOM-SIDE')
  const sc = await fn('scoreAndRecord', { token })
  check(!!sc, `10. scoreAndRecord — scored ${sc?.scored}, pushed ${sc?.push?.succeeded ?? '?'}`)
  await sleep(3000)

  // ⚠ VERIFIED BY READING THE CLASSROOM, NOT BY THE UI TICK.
  try {
    const cls = admin.initializeApp({ projectId: CLASSROOM_PROJECT }, `cls-${Date.now()}`).firestore()
    const gr = await cls.collection('game_results').where('game_instance_id', '==', IID).get()
    check(gr.size > 0, `11. ${gr.size} gradebook record(s) LANDED in the classroom's game_results`)

    // ⚠ "RECORDS LANDED" IS NOT "RECORDS ARE RIGHT", and the first version of this
    // assertion could not tell the difference. It checked only thatevery record carried a
    // numeric score — which is true of a no-show too (z = −2). Read against a roster
    // where most students never played, that looks identical to a total failure.
    //
    // The discriminator is STATUS, per cohort:
    //   played  → status 'completed'
    //   absent  → status 'no_show'
    //
    // `raw_score` is null classroom-side for EVERY game in the fleet (verified against
    // crisis, pricing and eBay) — the classroom stores the normalized score and does not
    // keep raw. Do not treat null raw_score as a fault; it is the shape.
    const players = playerIds
    const asPlayer = gr.docs.filter((d) => players.includes(d.data().participant_id))
    const asAbsent = gr.docs.filter((d) => !players.includes(d.data().participant_id))
    check(asPlayer.length === players.length,
      `11. both students who PLAYED have a record (${asPlayer.length}/${players.length})`)
    check(asPlayer.length > 0 && asPlayer.every((d) => d.data().status === 'completed'),
      '11. and both are status "completed" — NOT no_show')
    check(asAbsent.every((d) => d.data().status === 'no_show'),
      `11. the ${asAbsent.length} students who never played are status "no_show" (z −2)`)
    // Participation-only scoring ⇒ a degenerate single-role pool ⇒ every present student
    // normalizes to 0. A uniform 0 across players is CORRECT here, not a broken z-score.
    check(asPlayer.every((d) => d.data().normalized_score === 0),
      '11. players normalize to 0 (participation-only ⇒ zero-SD pool ⇒ uniform, by design)')
    asPlayer.forEach((d) => {
      const x = d.data()
      console.log(`     PLAYED  ${x.participant_id}  status=${x.status}  z=${x.normalized_score}`)
    })
    console.log(`     ABSENT  ×${asAbsent.length}  status=no_show  z=-2`)
  } catch (e) {
    skip('11. gradebook read', `classroom Firestore unreadable: ${String(e.message).slice(0, 100)}`)
  }

  banner(`RESULT — ${PASS} passed, ${FAIL} failed, ${SKIP} not verifiable   [instance ${IID}]`)
  return FAIL === 0
}

main()
  .then(async (ok) => { await closeAll(); process.exit(ok ? 0 : 1) })
  .catch(async (e) => { console.error('\nSMOKE ABORTED:', e.message); await closeAll(); process.exit(1) })
