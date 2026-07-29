// ═══════════════════════════════════════════════════════════════════════════════
// THE PRE-START SCREEN — matched, but the instructor has not pressed Start.
//
// ⚠ THIS IS A NORMAL STATE IN EVERY SESSION, AND IT USED TO LOOK LIKE A FAILURE.
// A student is matched minutes before the class begins. getRoundView correctly throws
// not-found for a group with no round document, and GameScreen rendered that raw server
// sentence — "This group has not started yet." — inside a role="alert".
//
// Deliberately does NOT call startAllGroups. Boot the emulator + vite dev first
// (see infoshare-screen-shots.mjs), then: node infoshare-pre-start-check.mjs
// ═══════════════════════════════════════════════════════════════════════════════
// do NOT press Start, and photograph what the student actually sees.
import { createRequire } from 'node:module'
const { chromium } = createRequire('/Users/emk120030/projects/games-platform/games/infoshare/x.mjs')('playwright')
const FRONTEND = 'http://localhost:5174'
const FN = 'http://localhost:5005/infoshare-mygames-live/us-central1'
const GID = 'prestart'
const PIDS = ['stu1', 'stu2']
const call = async (n, d) => (await (await fetch(`${FN}/${n}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data: d }),
})).json())
const dev = (e = {}) => ({ _dev: { game_instance_id: GID }, ...e })
const stu = (p, e = {}) => ({ _test: { participant_id: p, game_instance_id: GID }, ...e })

await call('seedRosterForTest', { game_instance_id: GID, participant_ids: PIDS })
for (const p of PIDS) {
  await call('assignRole', stu(p)); await call('submitKnowledgeCheck', stu(p, { answer: 'player' }))
  await call('completePrep', stu(p))
}
await call('triggerMatching', dev())
// ⚠ startAllGroups is DELIBERATELY NOT CALLED. This is the gap every class has.
const d = await call('getGameDashboard', dev())
const g = d.result?.groups?.[0]
console.log('group:', g?.group_id, '| started:', g?.started)

const b = await chromium.launch()
const page = await b.newPage({ viewport: { width: 1000, height: 700 } })
await page.goto(`${FRONTEND}/?_pid=stu1&_gid=${GID}`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(6000)
const text = await page.locator('body').innerText()
const calm = await page.locator('[data-testid="not-started-yet"]').count()
const alert = await page.locator('[role="alert"]').count()
console.log(`  not-started-yet panel: ${calm}   role=alert elements: ${alert}`)
console.log(`  raw server sentence visible: ${/has not started yet/i.test(text)}`)
await page.screenshot({ path: '/Users/emk120030/projects/games-platform/games/infoshare/report-shots/16-pre-start.png', fullPage: true })
console.log(calm === 1 && alert === 0 ? '  ✓ calm waiting screen, no alert' : '  ✗ still an error surface')
await b.close()
