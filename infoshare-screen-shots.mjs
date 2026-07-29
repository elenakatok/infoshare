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


/**
 * ⚠ ASSERT THE PAYOFF TABLE, DO NOT PHOTOGRAPH IT.
 *
 * The emulator's fixed warning bar sits across the bottom of the viewport and covered the
 * "3 lots" row in the first two rounds of screenshots. Emulator-only, so no student is
 * affected — but it meant the complete payoff table had never actually been SEEN
 * rendering, and "it looked right in the picture" is exactly the standard that let a
 * 1875px history table hide four of its seven columns through four screenshots.
 *
 * So: check the structure (3 demand rows × 3 production columns), check every one of the
 * nine cells has text, and check that nothing is drawn ON TOP of any of them —
 * `elementFromPoint` at each cell's centre must land inside that same cell. That last
 * check is the one the warning bar fails, and it is why the table is scrolled clear of it
 * first rather than the check being relaxed to let it pass.
 */
async function assertPayoffTable(page, label) {
  await page.locator('[data-testid="payoff-table"]').scrollIntoViewIfNeeded()
  await sleep(300)
  const r = await page.evaluate(() => {
    const t = document.querySelector('[data-testid="payoff-table"]')
    if (!t) return { ok: false, why: 'no payoff table on the page' }
    const rows = [...t.querySelectorAll('tbody tr')]
    const headers = [...t.querySelectorAll('thead th')].map((h) => h.textContent.trim())
    const cells = [], empty = [], covered = []
    for (const d of [1, 2, 3]) {
      for (const q of [1, 2, 3]) {
        const c = t.querySelector(`[data-testid="payoff-${d}-${q}"]`)
        if (!c) { cells.push(null); continue }
        const text = c.textContent.trim()
        cells.push(text)
        if (!text) empty.push(`${d}-${q}`)
        const b = c.getBoundingClientRect()
        const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)
        // The hit may be the cell or something inside it; anything else is drawn on top.
        if (!hit || !(c === hit || c.contains(hit))) {
          covered.push(`${d}-${q} (covered by <${hit ? hit.tagName.toLowerCase() : 'nothing'}>)`)
        }
      }
    }
    return {
      ok: true, rowCount: rows.length, headers, cells, empty, covered,
      rowLabels: rows.map((tr) => tr.children[0].textContent.trim()),
    }
  })

  if (!r.ok) { console.log(`  \u2717 ${label}: ${r.why}`); process.exitCode = 1; return }
  let bad = false
  const fail = (m) => { console.log(`  \u2717 ${label}: ${m}`); process.exitCode = 1; bad = true }

  if (r.rowCount !== 3) fail(`${r.rowCount} demand rows, expected 3 (${r.rowLabels.join(', ')})`)
  if (r.headers.length !== 4) fail(`${r.headers.length} header cells, expected 4 (${r.headers.join(' | ')})`)
  if (r.cells.length !== 9 || r.cells.some((c) => c === null)) fail('not all nine payoff cells exist')
  if (r.empty.length) fail(`empty cells: ${r.empty.join(', ')}`)
  if (r.covered.length) fail(`cells with something drawn over them: ${r.covered.join('; ')}`)
  if (!bad) {
    console.log(`  \u2713 ${label}: 3\u00d73 payoff table complete and unobstructed \u2014 ${r.cells.join('  ')}`)
  }
}

const shot = async (page, name) => {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true })
  console.log(`  ✓ ${name}.png`)
}

const openSeat = async (browser, pid) => {
  /*
    Tall enough that the numbers panel clears the emulator's fixed bottom bar. The overlap
    assertion is REAL, so the fix is to give the page room rather than to relax the check.

    ⚠ VH is a negative control, not a convenience. `VH=900 node infoshare-screen-shots.mjs`
    reproduces the original defect and the assertion must FAIL:
      ✗ supplier panel: cells with something drawn over them: 3-1 (covered by <p>); …
    If it ever passes at 900, the overlap check has stopped working and every green run
    above it is worthless.
  */
  const page = await browser.newPage({ viewport: { width: 1100, height: Number(process.env.VH) || 1250 } })
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

  /*
    ⚠ THE SHELL MUST FILL THE WINDOW AT ANY WIDTH.
    Elena's 1980px window showed the dark GameHeader bar stopping at ~930px with a
    scrollbar at that edge and white beyond — the whole student page sitting in a
    container that does not grow. Measured, not photographed: the header's own width
    against the viewport, and the document against the viewport in both directions.
  */
  for (const w of [1980, 570]) {
    await retailer.setViewportSize({ width: w, height: 900 })
    await sleep(700)
    const L = await retailer.evaluate(() => {
      const hdr = document.querySelector('header') ?? document.querySelector('[data-testid="game-header"]')
      const de = document.documentElement
      return {
        headerW: hdr ? Math.round(hdr.getBoundingClientRect().width) : null,
        bodyW: Math.round(document.body.getBoundingClientRect().width),
        rootW: Math.round((document.getElementById('root') ?? document.body).getBoundingClientRect().width),
        docScrollW: de.scrollWidth,
        viewportW: window.innerWidth,
      }
    })
    console.log(`  layout@${w}: header ${L.headerW} · root ${L.rootW} · body ${L.bodyW} · ` +
      `document ${L.docScrollW} vs viewport ${L.viewportW}`)
    const spans = L.headerW !== null && Math.abs(L.headerW - L.viewportW) <= 2
    const noSideScroll = L.docScrollW <= L.viewportW + 1
    console.log(spans ? `  ✓ @${w} the header bar spans the full viewport`
                      : `  ✗ @${w} the header is ${L.headerW}px in a ${L.viewportW}px window`)
    console.log(noSideScroll ? `  ✓ @${w} the page does not scroll sideways`
                             : `  ✗ @${w} the page scrolls sideways (${L.docScrollW} > ${L.viewportW})`)
    if (!spans || !noSideScroll) process.exitCode = 1
  }
  await retailer.setViewportSize({ width: 1100, height: 1250 })
  await sleep(400)

  // ── 2. THE INFORMATION PANEL, from the Retailer's screen ─────────────────────
  // ⚠ It is OPEN ALREADY in round 1 — clicking the toggle here would CLOSE it and the
  // assertion below would then fail on a page that is behaving exactly as designed.
  // Assert the round-1 default while we are here, since it is the whole point of it.
  const openInRound1 = await retailer.locator('[data-testid="information-panel"]').count()
  console.log(openInRound1
    ? '  ✓ the numbers panel is OPEN by default in round 1'
    : '  ✗ the numbers panel is closed in round 1 — it should default open')
  if (!openInRound1) { process.exitCode = 1; await retailer.click('[data-testid="info-panel-toggle"]') }
  await retailer.waitForSelector('[data-testid="information-panel"]')
  await sleep(600)
  await assertPayoffTable(retailer, 'retailer panel')
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
  if (!(await supplier.locator('[data-testid="information-panel"]').count())) {
    await supplier.click('[data-testid="info-panel-toggle"]')
  }
  await supplier.waitForSelector('[data-testid="information-panel"]')
  await sleep(600)
  await assertPayoffTable(supplier, 'supplier panel')
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
      // ⚠ LEAF columns from the BODY. `thead th` counts 10 in grouped mode (4 block
      // headers + 6 sub-headers), which is not the number of values in a row.
      cols: [...t.querySelectorAll('tbody tr:first-child td')].map((c, i) => [String(i), Math.round(c.getBoundingClientRect().width)]),
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

  /*
    ⚠ THE NARROW VIEWPORT IS THE ONLY CASE THAT CAN FAIL.
    The earlier assertion measured 1000px of table in a 1000px box — a case that is true
    by construction and could never have caught Elena's ~570px window, where the table
    spilled and the PAGE scrolled sideways instead of the table.

    Three things must hold at 570px, and they are different claims:
      1. the table is WIDER than its box     — otherwise nothing is being tested
      2. its own container SCROLLS           — scrollWidth > clientWidth, overflowX auto
      3. the PAGE does not scroll sideways   — document scrollWidth <= innerWidth
    (3) is the one the breakout div broke: the table moved out of normal flow, so the
    document grew instead of the container.
  */
  /*
    ⚠ RESIZE, DO NOT RELOAD. A load-at-each-width test passed on the broken table: a
    fresh load re-lays-out from scratch, while the real complaint is a window being
    dragged. Resizing the SAME page is the case that actually failed.

    ⚠ 1300px IS THE HEADLINE NUMBER. The flat seven overflowed there; grouped mode must
    fit with no scrollbar at all. 570px must still scroll the TABLE and never the PAGE.
  */
  const measure = async (w) => {
    await supplier.setViewportSize({ width: w, height: 900 })
    await sleep(600)
    return supplier.evaluate(() => {
      const t = document.querySelector('[data-testid="game-history"]')
      const wrap = t.parentElement
      const de = document.documentElement
      return {
        subCols: t.querySelectorAll('thead tr:last-child th').length,
        leafCols: t.querySelectorAll('tbody tr:first-child td').length,
        headerRows: t.querySelectorAll('thead tr').length,
        tableW: Math.round(t.getBoundingClientRect().width),
        boxClientW: wrap.clientWidth,
        boxScrollW: wrap.scrollWidth,
        docScrollW: de.scrollWidth,
        viewportW: window.innerWidth,
      }
    })
  }

  const wide = await measure(1300)
  console.log(`  @1300: ${wide.headerRows} header rows, ${wide.leafCols} leaf cols (${wide.subCols} grouped), table ${wide.tableW}px ` +
    `in ${wide.boxClientW}px (scrollW ${wide.boxScrollW}) · page ${wide.docScrollW}/${wide.viewportW}`)
  const fitsWide = wide.boxScrollW <= wide.boxClientW + 1
  const twoRows = wide.headerRows === 2
  console.log(twoRows ? '  ✓ two header rows (grouped mode)' : `  ✗ ${wide.headerRows} header row(s) — not grouped`)
  console.log(fitsWide ? '  ✓ @1300 fits with NO horizontal scroll' : `  ✗ @1300 still overflows (${wide.boxScrollW} > ${wide.boxClientW})`)

  /*
    ⚠ 570 NO LONGER OVERFLOWS, AND THAT IS THE POINT. Grouped mode shrank the table from
    ~900px to ~470px, so at 570 it FITS — the old assertion ("the table must scroll here")
    was asserting the broken behaviour and had to be replaced rather than kept green.

    The real requirement is: the page NEVER scrolls sideways at any width, and the table
    scrolls inside its own box only when the window is GENUINELY too narrow. So 570 checks
    the first, and a deliberately cramped 360 checks the second — otherwise "it scrolls
    when needed" is untested at every width.
  */
  const narrow = await measure(570)
  console.log(`  @570 : table ${narrow.tableW}px in ${narrow.boxClientW}px (scrollW ${narrow.boxScrollW}) · page ${narrow.docScrollW}/${narrow.viewportW}`)
  const fits570 = narrow.boxScrollW <= narrow.boxClientW + 1
  const pageStill = narrow.docScrollW <= narrow.viewportW + 1
  console.log(fits570 ? '  ✓ @570 fits with no scrollbar at all' : '  · @570 the table scrolls in its box (acceptable)')
  console.log(pageStill ? '  ✓ @570 the PAGE does not scroll sideways' : `  ✗ @570 the page scrolls (${narrow.docScrollW} > ${narrow.viewportW})`)

  const tiny = await measure(360)
  console.log(`  @360 : table ${tiny.tableW}px in ${tiny.boxClientW}px (scrollW ${tiny.boxScrollW}) · page ${tiny.docScrollW}/${tiny.viewportW}`)
  const tableScrolls = tiny.boxScrollW > tiny.boxClientW
  const pageStillTiny = tiny.docScrollW <= tiny.viewportW + 1
  console.log(tableScrolls ? '  ✓ @360 genuinely too narrow — the TABLE scrolls in its own box'
                           : '  ✗ @360 nothing overflows — the scroll path is untested')
  console.log(pageStillTiny ? '  ✓ @360 the PAGE still does not scroll sideways'
                            : `  ✗ @360 the page scrolls (${tiny.docScrollW} > ${tiny.viewportW})`)

  if (!(twoRows && fitsWide && pageStill && tableScrolls && pageStillTiny)) process.exitCode = 1
  await supplier.screenshot({ path: path.join(OUT, '17-history-570px.png'), fullPage: false })
  await measure(1300)
  await supplier.screenshot({ path: path.join(OUT, '18-history-1300px.png'), fullPage: false })
  console.log('  ✓ 17-history-570px.png, 18-history-1300px.png')
  await supplier.setViewportSize({ width: 1100, height: Number(process.env.VH) || 1250 })
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
