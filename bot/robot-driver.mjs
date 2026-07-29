// ═══════════════════════════════════════════════════════════════════════════════
// ROBOT MODE — the BROWSER runner. THE SHELL IS COMPLETE; THE STRATEGY IS NOT.
//
// Fills N seats of a live game with robots that PLAY THROUGH THE REAL UI in headed,
// tiled Chromium windows an instructor can watch. Per seat the driver:
//   1. drives login → knowledge check → prep → attendance → ready through the EXISTING
//      launcher (POST /api/student-url {mode:'ready'}) — nothing reimplemented here;
//   2. opens a tiled headed window at the ?token= game URL;
//   3. waits for the game to start, then runs read → decide → ACT-VIA-UI → wait until
//      the game finishes.
//
// ⚠ THIS FILE IS WHY THE TEMPLATE EXISTS. Robot mode kept not making it into a spawn
// without a separate prompt, because every game rebuilt the shell from scratch. The
// shell — windows, tiling, drive-to-ready, the loop, the launcher button — generalises
// completely. What does NOT generalise is exactly two things, both marked below:
//
//        ▸ SLOT 1  READ   turning the seat view into what decide() needs
//        ▸ SLOT 2  ACT    turning an action into clicks
//
// Fill those two, implement decide(), and robot mode works. Nothing else here changes.
//
// ── THE READ PATH, AND WHY IT IS NOT TESTID SCRAPING ─────────────────────────
// It reads `window.__gameState` directly — exactly what getRoundView returned. A label
// or testid rename therefore cannot break the robot, and, more importantly, the robot
// sees EXACTLY what the student sees and cannot accidentally read a hidden field.
//
// ── THE ACT PATH, AND WHY IT IS NOT A CALLABLE ───────────────────────────────
// Actions go THROUGH THE UI — click the button a student clicks. That is what makes a
// robot run a real test of the frontend rather than of the server, which the round-loop
// harness already covers. Do not "speed it up" by calling the callable directly; you
// would delete the only thing this runner tests that nothing else does.
//
// ── THE STRATEGY ─────────────────────────────────────────────────────────────
// Imported INWARD from functions/lib — the SAME compiled decide() the server bot runner
// uses. There is no mirrored copy and there must never be one; a drift test between two
// copies is a confession that two copies exist.
//
// Usage: node robot-driver.mjs --instance <id> [--seats 2] [--pace watch|fast]
//                              [--launcher http://localhost:5180] [--screen 1920x1080]
// Prereq: `npm run build` in ../functions, the launcher running, and an instructor who
// has generated an attendance code and started the game.
// ═══════════════════════════════════════════════════════════════════════════════

import { createRequire } from 'node:module'
import { decide } from '../functions/lib/round/decide.js'
import { DEFAULT_ROUND_SETTINGS as S } from '../functions/lib/round/settings.js'

// Playwright resolves from the repo root node_modules (installed for the harnesses);
// the bot directory has none of its own.
const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

// ── CLI ────────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const a = {}
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]
    if (k.startsWith('--')) {
      a[k.slice(2)] = argv[i + 1]?.startsWith('--') || argv[i + 1] === undefined ? true : argv[++i]
    }
  }
  return a
}
const args = parseArgs(process.argv.slice(2))
const INSTANCE = args.instance
/**
 * ⚠ TWO SEATS BY DEFAULT, BECAUSE A GROUP IS TWO SEATS.
 *
 * Info Sharing is Retailer + Supplier, so filling BOTH with robots is what makes a full
 * game run unattended — one robot and one empty seat just waits forever (online) or
 * plays a game of defaults (classroom), and neither is a test of anything.
 *
 * More than 2 is legitimate — it fills N/2 groups — but it is never what you want for a
 * smoke run, so it warns.
 */
const GROUP_SIZE = 2
const SEATS = Math.max(1, Math.min(16, Number(args.seats) || GROUP_SIZE))
const PACE = String(args.pace || 'watch')
const LAUNCHER = String(args.launcher || 'http://localhost:5180').replace(/\/$/, '')
const [SCREEN_W, SCREEN_H] = String(args.screen || '1920x1080').split('x').map(Number)

if (!INSTANCE || INSTANCE === true) {
  console.error('ERROR: --instance <gameInstanceId> is required.')
  process.exit(1)
}

if (SEATS % GROUP_SIZE !== 0) {
  console.warn(
    `WARNING: --seats ${SEATS} is not a multiple of the group size (${GROUP_SIZE}).\n` +
    '         At least one group will be short a seat and will not finish on its own.',
  )
}

// "Watch" paces the robots at human speed so a class can follow along; "fast" is for
// a smoke run. Neither affects what is decided.
const THINK = PACE === 'watch' ? { min: 5000, max: 15000 } : { min: 700, max: 1400 }
const POLL_MS = 1500
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const think = () => sleep(THINK.min + Math.random() * (THINK.max - THINK.min))

// ── window tiling ──────────────────────────────────────────────────────────────

function tile(index, total) {
  const cols = Math.ceil(Math.sqrt(total))
  const rows = Math.ceil(total / cols)
  const w = Math.floor(SCREEN_W / cols)
  const h = Math.floor(SCREEN_H / rows)
  return { x: (index % cols) * w, y: Math.floor(index / cols) * h, width: w, height: h }
}

// ── drive one seat to the game screen, via the launcher ────────────────────────

async function readyUrlFor(seatIndex) {
  const res = await fetch(`${LAUNCHER}/api/student-url`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ instance: INSTANCE, index: seatIndex, mode: 'ready' }),
  })
  if (!res.ok) throw new Error(`launcher /api/student-url failed: ${res.status} ${await res.text()}`)
  const body = await res.json()
  return body.url
}

// ═══════════════════════════════════════════════════════════════════════════════
// ▸ SLOT 1 — READ.
//
// Turn the page's `window.__gameState` into what decide() takes. For Info Sharing they
// are the same object — the seat view the screen renders IS the seat view the brain
// reasons over, which is the property that makes a robot run mean anything.
//
// ⚠ RETURN IT WHOLE, AND DO NOT "TIDY" IT. In particular do not normalise a missing
// `demandType` to null: the Supplier's view has NO SUCH KEY, decide() tests for it by
// presence, and a helpful `?? null` here would turn a broken reveal into a bot that
// silently reports HIGH forever instead of one that throws.
// ═══════════════════════════════════════════════════════════════════════════════
async function readSeatView(page) {
  return page.evaluate(() => {
    const s = window.__gameState
    return s ? s.view : null
  })
}

// ═══════════════════════════════════════════════════════════════════════════════
// ▸ SLOT 2 — ACT.
//
// Turn an action from decide() into clicks. THROUGH THE UI — see the header. The test ids
// are the ones the real decision screens render:
//
//   stage 1  message-choices-HIGH   message-choices-LOW      (Retailer)
//   stage 2  production-choices-1/2/3                        (Supplier)
//
// One rule: wait for the control before clicking it. A robot that clicks faster than the
// page renders produces a flaky failure that looks like a game bug, and it will be
// investigated as one.
//
// ⚠ CLICK, NEVER CALL. Do not "speed this up" by invoking submitMessage/submitProduction
// directly. The round-loop harness already proves the server; the ONLY thing this runner
// tests that nothing else does is that the button a student presses is wired to it.
// ═══════════════════════════════════════════════════════════════════════════════
async function actInUi(page, action) {
  const sel =
    action.kind === 'message'    ? `[data-testid="message-choices-${action.message}"]`
  : action.kind === 'production' ? `[data-testid="production-choices-${action.production}"]`
  : null
  if (!sel) throw new Error(`actInUi: unknown action kind ${JSON.stringify(action)}`)
  await page.waitForSelector(sel, { timeout: 15000 })
  await page.click(sel)
}

// ── the loop (SHARED — do not edit per game) ───────────────────────────────────

/**
 * Dismiss the round-results screen if it is up.
 *
 * ⚠ SHELL WORK, NOT A SLOT. `results-continue` is a FIXED test id on the shared
 * RoundResultsScreen widget, so this is identical for every stage game.
 *
 * Without it a two-robot game stalls after round 1: the round has resolved server-side,
 * but the results screen is covering the decision controls, so `actInUi` cannot find a
 * button to click. In ONLINE mode nothing dismisses it but a click — there is no timer —
 * so the run would hang indefinitely and look like a game bug.
 */
async function dismissResultsIfShowing(page) {
  const btn = page.locator('[data-testid="results-continue"]')
  if (await btn.count() === 0) return false
  if (await btn.isDisabled().catch(() => true)) return false
  await btn.click().catch(() => {})
  return true
}

async function runSeat(page, label) {
  for (;;) {
    if (await dismissResultsIfShowing(page)) {
      console.log(`[${label}] continued past the round result`)
      await sleep(POLL_MS)
      continue
    }
    const view = await readSeatView(page)
    if (!view) { await sleep(POLL_MS); continue }
    if (view.status === 'finished') {
      console.log(`[${label}] game over`)
      return
    }
    if (!view.owes) { await sleep(POLL_MS); continue }

    await think()
    const action = decide(view, S)
    console.log(`[${label}] round ${view.round} ${view.stage} → ${JSON.stringify(action)}`)
    await actInUi(page, action)
    await sleep(POLL_MS)
  }
}

// ── main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Robot mode: ${SEATS} seat(s) on instance ${INSTANCE} (pace=${PACE}) — ` +
    `${SEATS / GROUP_SIZE} full group(s)`)
  const browsers = []
  const runs = []

  for (let i = 0; i < SEATS; i++) {
    const box = tile(i, SEATS)
    const browser = await chromium.launch({
      headless: false,
      args: [`--window-position=${box.x},${box.y}`, `--window-size=${box.width},${box.height}`],
    })
    browsers.push(browser)
    const page = await browser.newPage({ viewport: { width: box.width, height: box.height - 90 } })
    const url = await readyUrlFor(i)
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    runs.push(runSeat(page, `seat ${i}`).catch((e) => console.error(`[seat ${i}]`, e.message)))
  }

  await Promise.all(runs)
  // Left open on purpose: the final screen is usually the thing worth looking at.
  console.log('All seats finished. Windows left open — close them when you are done.')
  void browsers
}

main().catch((e) => { console.error(e); process.exit(1) })
