// Real browser, real production data path: the online panel must render groups, not crash.
import { createRequire } from 'node:module'
const { chromium } = createRequire('/Users/emk120030/projects/games-platform/games/infoshare/x.mjs')('playwright')
const FRONTEND='http://localhost:5174', FN='http://localhost:5005/infoshare-mygames-live/us-central1'
const GID='panel', PIDS=['s1','s2','s3']
const call=async(n,d)=>(await(await fetch(`${FN}/${n}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({data:d})})).json())
const dev=(e={})=>({_dev:{game_instance_id:GID},...e}), stu=(p,e={})=>({_test:{participant_id:p,game_instance_id:GID},...e})
await call('seedRosterForTest',{game_instance_id:GID,participant_ids:PIDS})
for(const p of PIDS){await call('assignRole',stu(p));await call('submitKnowledgeCheck',stu(p,{answer:'player'}));await call('completePrep',stu(p))}
await call('updateGameConfig',dev({clock_mode:'off'}))

const b=await chromium.launch(); const page=await b.newPage({viewport:{width:1300,height:1000}})
const errors=[]
page.on('pageerror',e=>errors.push(e.message))
await page.goto(`${FRONTEND}/dashboard?_dev_game_instance_id=${GID}`,{waitUntil:'domcontentloaded'})
await page.waitForTimeout(7000)

const toggle = await page.locator('[data-testid="session-mode-switch"]').count()
const online = await page.locator('[data-testid="mode-online"]').count()
console.log(`  session mode toggle present: ${toggle===1} | online button: ${online===1}`)

const panel = await page.locator('[data-testid="online-match-control"]').count()
const boundary = await page.locator('[data-testid^="panel-error-"]').count()
console.log(`  online panel: ${panel} | boundary tripped: ${boundary}`)

// ⚠ CLICK IT AND REQUIRE GROUPS TO APPEAR. "the panel is present" is also true of a
// panel that renders nothing, which is exactly what optional chaining would have given.
await page.locator('[data-testid="online-group-participants"]').click().catch(()=>{})
await page.waitForTimeout(6000)

/*
  ⚠ THE GROUP ROWS MOVED, AND THAT IS THE POINT OF THE CHANGE. They used to render inside
  the online panel, BELOW a second list of the same groups in the Groups strip. Now there
  is one list: the shared GroupsPanel, which merges the seat picture with the round status
  onto one row. So this counts the panel's rows.

  ⚠ AND IT ASSERTS THE DUPLICATE IS GONE. Counting the new rows alone would stay green if
  the old list came back, and a second list is exactly the regression this turn removed —
  it is what made the dashboard taller and sparser than crisis's for less information.
  `online-group-participants` (the BUTTON) also matches the old `online-group-` prefix, so
  the duplicate check excludes it explicitly rather than by prefix luck.
*/
const rows = await page.locator('[data-testid^="game-control-strip-row-"]').count()
const dupRows = await page.locator('[data-testid^="online-group-"]:not([data-testid="online-group-participants"])').count()
const seatLabels = (await page.locator('[data-testid="game-control-strip"]').innerText().catch(()=>'')).match(/\d+\/\d+/g) ?? []
console.log(`  after clicking Group participants: ${rows} group row(s) in the Groups panel, seat labels: ${JSON.stringify(seatLabels)}`)
console.log(`  duplicate group list in the online panel: ${dupRows} row(s) (must be 0)`)
console.log(`  page errors: ${errors.length}${errors.length?' — '+errors[0]:''}`)

const ok = toggle===1 && panel===1 && boundary===0 && rows>0 && dupRows===0 && seatLabels.length>0 && errors.length===0
console.log(ok ? '  ✓ toggle, panel, ONE list of REAL GROUP ROWS with seat counts — no crash' : '  ✗ see above')
await page.screenshot({path:'report-shots/22-online-panel.png',fullPage:true})
await b.close()
process.exitCode = ok?0:1
