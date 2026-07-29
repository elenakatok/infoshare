// ═══════════════════════════════════════════════════════════════════════════════
// "MISSING TOKEN" MUST NEVER REACH THE INSTRUCTOR'S SCREEN.
//
// ⚠ IT WAS HAPPENING IN PRODUCTION, EVERY TIME. The Groups panel mounts and polls before
// the instructor's Firebase session exists, so the first calls throw
// `invalid-argument: Missing token`. The strip rendered that verbatim in RED, then it
// vanished a second later — a fault reported on a page that was working.
//
// ⚠ THIS SAMPLES FROM THE FIRST PAINT, not the settled page. The error was visible for
// about a second; a check that waits for things to settle cannot see it, which is why it
// survived so long and had to be spotted by eye on a real dashboard.
//
// Boot the emulator + vite dev first, then: node infoshare-token-check.mjs
// ═══════════════════════════════════════════════════════════════════════════════
import { createRequire } from 'node:module'
const { chromium } = createRequire('/Users/emk120030/projects/games-platform/games/infoshare/x.mjs')('playwright')
const FRONTEND='http://localhost:5174', FN='http://localhost:5005/infoshare-mygames-live/us-central1'
const GID='tok', PIDS=['stu1','stu2']
const call=async(n,d)=>(await(await fetch(`${FN}/${n}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({data:d})})).json())
const dev=(e={})=>({_dev:{game_instance_id:GID},...e}), stu=(p,e={})=>({_test:{participant_id:p,game_instance_id:GID},...e})
await call('seedRosterForTest',{game_instance_id:GID,participant_ids:PIDS})
for(const p of PIDS){await call('assignRole',stu(p));await call('submitKnowledgeCheck',stu(p,{answer:'player'}));await call('completePrep',stu(p))}
await call('triggerMatching',dev())

const b=await chromium.launch(); const page=await b.newPage({viewport:{width:1200,height:800}})
// ⚠ SAMPLE FROM THE FIRST PAINT. The red error appeared for ~1s and vanished; a check
// that only looks at the settled page cannot see it, which is why it survived this long.
const seen=[]
await page.goto(`${FRONTEND}/dashboard?_dev_game_instance_id=${GID}`,{waitUntil:'domcontentloaded'})
for(let i=0;i<25;i++){
  const s=await page.evaluate(()=>({
    alerts:[...document.querySelectorAll('[role="alert"]')].map(e=>e.textContent.trim()).filter(Boolean),
    loading:!!document.querySelector('[data-testid="control-strip-loading"]'),
    strip:!!document.querySelector('[data-testid="game-control-strip"]'),
  })).catch(()=>null)
  if(s) seen.push(s)
  await new Promise(r=>setTimeout(r,300))
}
const anyAlert=seen.flatMap(s=>s.alerts)
const tokenAlert=anyAlert.filter(t=>/missing token/i.test(t))
const sawLoading=seen.some(s=>s.loading)
const settled=seen[seen.length-1]
console.log(`  samples: ${seen.length} | saw "Connecting…": ${sawLoading} | alerts seen: ${anyAlert.length}`)
console.log(tokenAlert.length===0 ? '  ✓ "Missing token" never rendered as an alert'
                                  : `  ✗ still shown: ${tokenAlert[0]}`)
console.log(settled.strip && settled.alerts.length===0 ? '  ✓ the panel settled with no alert'
                                  : `  ✗ settled with alerts: ${JSON.stringify(settled.alerts)}`)
await b.close()
process.exitCode = tokenAlert.length===0 ? 0 : 1
