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
const rows = await page.locator('[data-testid^="online-group-"]').count()
const occupantsShown = (await page.locator('[data-testid="online-match-control"]').innerText().catch(()=>'')).match(/\d+\/\d+ seats/g) ?? []
console.log(`  after clicking Group participants: ${rows} group row(s), seat labels: ${JSON.stringify(occupantsShown)}`)
console.log(`  page errors: ${errors.length}${errors.length?' — '+errors[0]:''}`)

const ok = toggle===1 && panel===1 && boundary===0 && rows>0 && occupantsShown.length>0 && errors.length===0
console.log(ok ? '  ✓ toggle, panel, and REAL GROUP ROWS — no crash' : '  ✗ see above')
await page.screenshot({path:'report-shots/22-online-panel.png',fullPage:true})
await b.close()
process.exitCode = ok?0:1
