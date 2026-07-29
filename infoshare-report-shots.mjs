// Screenshots of the reports page against the demo dataset, for review before deploy.
//   node infoshare-report-shots.mjs        (emulator + vite dev must be running)

import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(ROOT, 'report-shots')
const BASE = process.env.BASE || 'http://localhost:5174'
const IID = process.env.DEMO_INSTANCE || 'demo'

mkdirSync(OUT, { recursive: true })

const shot = async (page, name, locator) => {
  const file = path.join(OUT, `${name}.png`)
  if (locator) await locator.screenshot({ path: file })
  else await page.screenshot({ path: file, fullPage: true })
  console.log(`  ✓ ${name}.png`)
}

const main = async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })

  // The dashboard bootstraps the instructor session; /reports inherits it.
  await page.goto(`${BASE}/dashboard?_dev_game_instance_id=${IID}`, { waitUntil: 'networkidle' })
  await sleep(2500)
  await shot(page, '00-dashboard-layout')

  await page.goto(`${BASE}/reports?_dev_game_instance_id=${IID}`, { waitUntil: 'networkidle' })
  await sleep(2500)
  await shot(page, '01-reports-tiles')

  for (const [tile, name, wait] of [
    ['tile-summary', '02-overall', 800],
    ['tile-trustworthiness', '03-trustworthiness', 1200],
    ['tile-trust', '04-trust', 1200],
    ['tile-reciprocity', '05-reciprocity', 1000],
    ['tile-students', '06-per-student', 800],
    ['tile-debrief', '07-debrief', 800],
  ]) {
    const t = page.locator(`[data-testid="${tile}"]`)
    if (await t.count() === 0) { console.log(`  ⃠ ${name} — tile absent`); continue }
    await t.click()
    await sleep(wait)
    await shot(page, name)
    await page.keyboard.press('Escape').catch(() => {})
    await page.mouse.click(5, 5)
    await sleep(400)
  }

  // Per-group scope, to show the charts work at group level too.
  await page.locator('[data-testid="tile-trustworthiness"]').click()
  await sleep(800)
  const sel = page.locator('[data-testid="scope-picker"]')
  if (await sel.count()) {
    const opts = await sel.locator('option').all()
    if (opts.length > 4) {
      await sel.selectOption({ index: 4 })   // the liar-recovers pair
      await sleep(1200)
      await shot(page, '08-trustworthiness-one-group')
    }
  }

  await browser.close()
  console.log(`\nImages: ${OUT}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
