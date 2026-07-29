// ═══════════════════════════════════════════════════════════════════════════════
// THE BROWSER-RUNNER GATE — both seats robot-driven, ten rounds, unattended.
//
// ⚠ EVERY ACTION HERE IS A CLICK ON A REAL SCREEN, AGAINST PRODUCTION. The instructor
// steps are Playwright pressing the actual dashboard buttons, and the two student seats
// are the game's own robot driver in headed Chromium. Nothing calls a callable directly.
//
// That constraint is the whole point: a harness that calls the function UNDER the button
// can pass while the button is dead, and that has happened twice in this build (Match Now
// returning a bare `internal` because triggerMatching was never exported; the seven-column
// history that four screenshots failed to show). The e2e already covers the callables.
// This covers the thing the e2e cannot.
//
// PREREQ: the launcher running (default :5181), production credentials, and an infoshare
// instance in course ABC.
//
//   node infoshare-browser-gate.mjs --instance <id> [--launcher http://localhost:5181]
// ═══════════════════════════════════════════════════════════════════════════════

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { setTimeout as sleep } from 'node:timers/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
const ROOT = path.dirname(fileURLToPath(import.meta.url))

const args = {}
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i].startsWith('--')) args[process.argv[i].slice(2)] = process.argv[++i]
}
const INSTANCE = args.instance
const LAUNCHER = (args.launcher || 'http://localhost:5181').replace(/\/$/, '')
if (!INSTANCE) { console.error('ERROR: --instance <gameInstanceId> is required.'); process.exit(1) }

let PASS = 0, FAIL = 0
const check = (ok, label) => { ok ? PASS++ : FAIL++; console.log(`  ${ok ? '✓' : '✗ FAIL:'} ${label}`) }
const banner = (t) => console.log(`\n${'─'.repeat(72)}\n${t}\n${'─'.repeat(72)}`)

/** Click a button by its visible text, if it is there and enabled. */
async function clickByText(page, rx, { timeout = 8000 } = {}) {
  const btn = page.getByRole('button', { name: rx })
  try {
    await btn.first().waitFor({ state: 'visible', timeout })
    if (await btn.first().isDisabled().catch(() => false)) return false
    await btn.first().click()
    return true
  } catch { return false }
}

async function main() {
  banner(`BROWSER GATE — instance ${INSTANCE}`)

  // ── the instructor's dashboard, as an instructor actually opens it ──────────
  const r = await fetch(`${LAUNCHER}/api/dashboard-url`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ game_instance_id: INSTANCE }),
  })
  const body = await r.json()
  check(r.ok && !!body.url, `dashboard URL minted — ${r.ok ? 'ok' : body.error}`)
  if (!body.url) throw new Error('no dashboard url')

  const browser = await chromium.launch({ headless: false })
  const dash = await browser.newPage({ viewport: { width: 1400, height: 1000 } })
  await dash.goto(body.url, { waitUntil: 'domcontentloaded' })
  await sleep(4000)

  // ⚠ THE ATTENDANCE CODE MUST EXIST BEFORE THE ROBOTS DRIVE. The driver's
  // drive-to-ready fetches it, so a missing code strands every seat on the code screen
  // and reads as a robot failure.
  const gen = await clickByText(dash, /generate|attendance code|new code/i)
  console.log(`  · attendance code button: ${gen ? 'pressed' : 'not present (already generated?)'}`)
  await sleep(2500)

  // ── the two student seats: the game's own robot driver ─────────────────────
  banner('ROBOTS — two seats, driven through the real screens')
  const driver = spawn('node', [
    path.join(ROOT, 'bot', 'robot-driver.mjs'),
    '--instance', INSTANCE, '--seats', '2', '--pace', 'fast', '--launcher', LAUNCHER,
  ], { stdio: ['ignore', 'pipe', 'pipe'] })
  let driverOut = ''
  driver.stdout.on('data', (d) => { driverOut += d; process.stdout.write(`    [robot] ${d}`) })
  driver.stderr.on('data', (d) => { driverOut += d; process.stderr.write(`    [robot!] ${d}`) })
  let driverExited = null
  driver.on('exit', (code) => { driverExited = code })

  // Give the seats time to reach waiting-to-match before the instructor matches.
  await sleep(45000)
  check(driverExited === null, `the robot driver is still running (exit ${driverExited})`)

  // ── instructor: Match Now, then Start class — the real buttons ─────────────
  banner('INSTRUCTOR — Match Now, then Start class')
  await dash.reload({ waitUntil: 'domcontentloaded' })
  await sleep(4000)
  const matched = await clickByText(dash, /match now|match students|^match$/i, { timeout: 15000 })
  check(matched, 'Match Now clicked on the real dashboard')
  await sleep(6000)

  dash.once('dialog', (d) => d.accept())   // Start class asks for confirmation
  const started = await clickByText(dash, /start class|start the class|start all/i, { timeout: 15000 })
  check(started, 'Start class clicked on the real dashboard')
  await sleep(5000)

  // ── watch it play out ──────────────────────────────────────────────────────
  banner('PLAY — ten rounds, unattended')
  const deadline = Date.now() + 12 * 60 * 1000
  let finished = false
  while (Date.now() < deadline) {
    await dash.reload({ waitUntil: 'domcontentloaded' }).catch(() => {})
    await sleep(6000)
    const text = await dash.locator('body').innerText().catch(() => '')
    if (/finished/i.test(text)) { finished = true; break }
    if (driverExited !== null && driverExited !== 0) break
  }
  check(finished, `the group reached "finished" on the instructor dashboard`)

  // ── the gradebook push, from the instructor's own button ───────────────────
  banner('SCORE & RECORD — the gradebook push')
  const scored = await clickByText(dash, /score.*record|finalize|push/i, { timeout: 15000 })
  check(scored, 'Score & Record clicked')
  await sleep(8000)

  await dash.screenshot({ path: path.join(ROOT, 'report-shots', '20-browser-gate-dashboard.png'), fullPage: true })
  console.log('  ✓ 20-browser-gate-dashboard.png')

  try { driver.kill('SIGKILL') } catch { /* */ }
  await browser.close()

  banner(`RESULT — ${PASS} passed, ${FAIL} failed`)
  console.log('⚠ The gradebook push is verified by reading the classroom, NOT by this UI.')
  process.exitCode = FAIL === 0 ? 0 : 1
}

main().catch((e) => { console.error(e); process.exitCode = 1 })
