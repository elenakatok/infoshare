// ═══════════════════════════════════════════════════════════════════════════════
// SCREENSHOTS OF THE STUDENT SCREENS, for review before deploy.
//
// ⚠ REAL SCREENS, DRIVEN THROUGH THE REAL CALLABLES. This boots the emulator stack,
// walks one classroom group to a live open round, and photographs what a student
// actually sees. It does NOT hand-render components with fixture props: a screenshot of
// a component in isolation proves the component renders, which was never in doubt — what
// is in doubt is whether the SUPPLIER'S screen shows the true type, and only a real seat
// view can answer that.
//
// The Supplier shot is the one that matters. If the true demand type appears anywhere on
// it, the reveal rule is broken, and no amount of green harness output outweighs seeing
// it on the page.
//
//   node infoshare-screen-shots.mjs        (env KEEP=1 leaves the stack up)
//
// Prereq: nothing — it boots emulators and `vite dev` itself.
// ═══════════════════════════════════════════════════════════════════════════════

import { openSync, mkdirSync } from 'node:fs'
import { spawn, execSync } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const PROJECT   = 'infoshare-mygames-live'
const ROOT      = path.dirname(fileURLToPath(import.meta.url))
// Ports come from firebase.json — functions 5005, firestore 8082, database 9002,
// auth 9101 — the same ones frontend/src/firebase.ts connects to in DEV.
const FUNCTIONS = `http://localhost:5005/${PROJECT}/us-central1`
const FRONTEND  = 'http://localhost:5174'
const OUT       = path.join(ROOT, 'report-shots')
const GID       = 'shots'
const PIDS      = ['stu1', 'stu2']

mkdirSync(OUT, { recursive: true })
const children = []

const freePorts = () => {
  for (const p of [5005, 8082, 9101, 9002, 4002, 4400, 4500, 5174]) {
    try { execSync(`lsof -ti tcp:${p} | xargs kill -9`, { stdio: 'ignore' }) } catch { /* */ }
  }
}

async function callFn(name, data) {
  const res = await fetch(`${FUNCTIONS}/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ data }),
  })
  const body = await res.json().catch(() => ({}))
  return { ok: res.ok && !body.error, result: body.result, error: body.error?.message }
}
const asDev = (extra = {}) => ({ _dev: { game_instance_id: GID }, ...extra })
// ⚠ `_test` for a STUDENT, `_dev` for an INSTRUCTOR — they are different envelopes and
// mixing them fails with a bare "Missing token" that reads like an auth bug.
const asStudent = (pid, extra = {}) =>
  ({ _test: { participant_id: pid, game_instance_id: GID }, ...extra })

async function bringUp() {
  freePorts(); await sleep(1000)
  execSync('npm run build', { cwd: path.join(ROOT, 'functions'), stdio: 'inherit' })
  const log = openSync(path.join(ROOT, 'shots-emu.log'), 'a')
  children.push(spawn('firebase',
    ['emulators:start', '--only', 'auth,functions,firestore,database', '--project', PROJECT],
    { cwd: ROOT, detached: true, stdio: ['ignore', log, log] }))
  const start = Date.now()
  for (;;) {
    try { const r = await fetch(`${FUNCTIONS}/health`); if (r.ok) break } catch { /* */ }
    if (Date.now() - start > 150_000) throw new Error('functions never came up')
    await sleep(800)
  }
  const vlog = openSync(path.join(ROOT, 'shots-vite.log'), 'a')
  children.push(spawn('npm', ['run', 'dev', '--', '--port', '5174', '--strictPort'],
    { cwd: path.join(ROOT, 'frontend'), detached: true, stdio: ['ignore', vlog, vlog] }))
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(FRONTEND); if (r.ok) break } catch { /* */ }
    await sleep(1000)
  }
  console.log('  stack ready')
}
const tearDown = () => {
  if (process.env.KEEP === '1') return
  for (const c of children) { try { process.kill(-c.pid, 'SIGKILL') } catch { /* */ } }
  freePorts()
}

/** Walk a group to a live, open round — through the same callables the buttons call. */
async function setUp() {
  const step = async (label, name, data) => {
    const r = await callFn(name, data)
    console.log(`    ${r.ok ? '·' : '✗'} ${label}${r.ok ? '' : ` — ${r.error}`}`)
    return r
  }
  await step('seedRoster', 'seedRosterForTest', { game_instance_id: GID, participant_ids: PIDS })
  for (const pid of PIDS) {
    await step(`assignRole ${pid}`, 'assignRole', asStudent(pid, {}))
    await step(`kc ${pid}`, 'submitKnowledgeCheck', asStudent(pid, { answer: 'player' }))
    await step(`prep ${pid}`, 'completePrep', asStudent(pid, {}))
  }
  await step('match', 'triggerMatching', asDev({}))
  await step('start', 'startAllGroups', asDev({}))
  const d = await callFn('getGameDashboard', asDev({}))
  const group = (d.result?.groups ?? [])[0]
  if (!group) throw new Error('no group was formed — cannot photograph a decision screen')

  // Who holds which seat? The Retailer is the seat that owes the message.
  const roles = {}
  for (const pid of PIDS) {
    const v = await callFn('getRoundView', asStudent(pid, { group_id: group.group_id }))
    console.log(`    roundView ${pid}: ${v.ok ? v.result.view.role : v.error}`)
    if (v.ok) roles[v.result.view.role] = pid
  }
  if (!roles.retailer || !roles.supplier) throw new Error(`seats not resolved: ${JSON.stringify(roles)}`)
  return { groupId: group.group_id, roles }
}

const shot = async (page, name) => {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true })
  console.log(`  ✓ ${name}.png`)
}

const openSeat = async (browser, pid) => {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } })
  // Play is the ROOT route, not /play — a wrong path renders an empty router with no
  // error, and the wait below then times out looking like a game that never opened.
  await page.goto(`${FRONTEND}/?_pid=${pid}&_gid=${GID}`, { waitUntil: 'domcontentloaded' })
  // ⚠ NOT 'networkidle'. The game screen polls getRoundView every 1.5s for as long as it
  // is open, so the network is NEVER idle and the wait times out on a perfectly healthy
  // page. Wait for the heading instead — a condition the screen can actually reach.
  await page.waitForSelector('[data-testid="round-heading"]', { timeout: 30000 })
  return page
}

async function main() {
  await bringUp()
  const { groupId, roles } = await setUp()
  const browser = await chromium.launch()

  // ── 1. THE RETAILER'S DECISION SCREEN ────────────────────────────────────────
  const retailer = await openSeat(browser, roles.retailer)
  await sleep(1200)
  await shot(retailer, '10-retailer-decision')

  // ── 2. THE INFORMATION PANEL, from the Retailer's screen ─────────────────────
  await retailer.click('[data-testid="info-panel-toggle"]')
  await retailer.waitForSelector('[data-testid="information-panel"]')
  await sleep(600)
  await shot(retailer, '11-information-panel')

  // ── 3. THE SUPPLIER'S DECISION SCREEN — the one that matters ─────────────────
  // The Retailer reports LOW so the two screens are visibly about different things:
  // if the Supplier's screen showed the true type it would be impossible to miss.
  await retailer.click('[data-testid="message-choices-LOW"]')
  await sleep(2500)

  const supplier = await openSeat(browser, roles.supplier)
  await supplier.waitForSelector('[data-testid="production-choices"]', { timeout: 30000 })
  await sleep(1200)
  await shot(supplier, '12-supplier-decision')

  // ⚠ AND ASSERT IT, not just photograph it. A screenshot is reviewed by a human who may
  // be looking at the buttons; this fails the run.
  const bodyText = await supplier.locator('body').innerText()
  const leaked = /Only you can see this|Demand is (HIGH|LOW)/.test(bodyText)
  console.log(leaked
    ? '  ✗ THE SUPPLIER SCREEN SHOWS THE TRUE TYPE — the reveal rule is broken'
    : '  ✓ the supplier screen carries no trace of the true demand type')
  if (leaked) process.exitCode = 1

  // The Information panel is reachable from the SUPPLIER's screen too — spec §1.4 says
  // every decision screen, both roles, and this is where that is proved.
  await supplier.click('[data-testid="info-panel-toggle"]')
  await supplier.waitForSelector('[data-testid="information-panel"]')
  await sleep(600)
  await shot(supplier, '13-information-panel-supplier')

  // ── 4. THE RESULTS SCREEN, and 5. THE HISTORY TABLE ──────────────────────────
  await supplier.click('[data-testid="production-choices-1"]')
  await sleep(3500)
  await supplier.waitForSelector('[data-testid="results-continue"]', { timeout: 30000 })
  await shot(supplier, '14-round-result')

  // Measure the table rather than eyeballing the screenshot — column widths that change
  // with container width mean the table is being STRETCHED, not clipped at min-content,
  // and the two have opposite fixes.
  const m = await supplier.evaluate(() => {
    const t = document.querySelector('[data-testid="game-history"]')
    if (!t) return null
    const wrap = t.parentElement
    const ths = [...t.querySelectorAll('thead th')]
    return {
      tableW: Math.round(t.getBoundingClientRect().width),
      tableScrollW: t.scrollWidth,
      wrapW: Math.round(wrap.getBoundingClientRect().width),
      wrapClientW: wrap.clientWidth,
      wrapScrollW: wrap.scrollWidth,
      wrapOverflow: getComputedStyle(wrap).overflowX,
      grandW: Math.round(wrap.parentElement.getBoundingClientRect().width),
      cols: ths.map((h) => [h.textContent.trim().slice(0, 22), Math.round(h.getBoundingClientRect().width)]),
    }
  })
  /*
    ⚠ ASSERT, DO NOT JUST PRINT. This started as a debug dump and caught a real defect
    that four screenshots in a row had failed to make obvious: the table was 1875px in a
    1000px scroll box, so columns 4–7 existed but were unreachable, and the shot simply
    looked like a table with a truncated caption. The cause was the caption itself —
    game-ui renders it as a tfoot cell inheriting `white-space: nowrap`, so one long
    sentence sets the table's minimum width and inflates every column proportionally.

    A screenshot cannot fail. This can.
  */
  console.log(`  history: ${m.cols.length} columns, table ${m.tableW}px in a ${m.wrapW}px box`)
  if (m.cols.length !== 7) {
    console.log(`  ✗ the history table has ${m.cols.length} columns, not the seven in spec §1.2`)
    process.exitCode = 1
  }
  if (m.tableW > m.wrapW) {
    console.log(`  ✗ the history table (${m.tableW}px) is wider than its scroll box (${m.wrapW}px) — ` +
      'columns are off-screen with no affordance. Check for a long caption.')
    process.exitCode = 1
  } else {
    console.log('  ✓ all seven history columns fit inside the visible box')
  }

  const hist = supplier.locator('[data-testid="game-history"]')
  if (await hist.count()) {
    await hist.screenshot({ path: path.join(OUT, '15-history-table.png') })
    console.log('  ✓ 15-history-table.png')
  }

  await browser.close()
  console.log(`\nImages: ${OUT}   (group ${groupId})`)
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(tearDown)
