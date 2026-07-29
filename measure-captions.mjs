// ═══════════════════════════════════════════════════════════════════════════════
// HOW CLOSE IS EACH SHARED-HistoryTable CAPTION TO BREAKING ITS TABLE?
//
// game-ui renders `caption` as a <tfoot><td colSpan=N> that inherits the body cells'
// `white-space: nowrap`. So the caption becomes ONE UNWRAPPABLE LINE, and the table's
// minimum width is max(caption width, sum of column min-content widths). When the caption
// wins, EVERY column inflates proportionally and the rightmost ones are pushed outside
// the scroll box — with no visible affordance that they exist.
//
// Measures both halves in a real browser at the real tokens. MEASUREMENT ONLY.
//   node measure-captions.mjs
// ═══════════════════════════════════════════════════════════════════════════════
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)('playwright')

const FONT       = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
const SIZE_XS    = '0.78rem'   // typography.sizeXs  — the caption
const SIZE_TABLE = '0.9rem'    // typography.sizeTable — the header cells
const CELL_PAD   = 16          // td/th padding 0.3rem 0.5rem, both sides

// ⚠ THE NUMBER THAT DECIDES WHETHER IT ACTUALLY BREAKS. A caption wider than the columns
// only inflates them; columns become UNREACHABLE only when the resulting table is wider
// than the box it scrolls in. Every student shell in the fleet is the same:
// layout.contentWidth 640px minus layout.pagePad 2rem on each side.
const SHELL = 640 - 2 * 32     // 576px

// Captions are quoted with the `viewerRole` branch INCLUDED — the worst case, and the
// one a student in a seat actually sees.
const GAMES = [
  {
    name: 'crisis',
    caption: 'A dash (—) in a Fix column means no crisis occurred that round. Your block is highlighted.',
    // Leaf column headers, left to right.
    cols: ['Period', 'Bid', 'Alloc', 'Fix?', 'Profit', 'Bid', 'Alloc', 'Fix?', 'Profit', 'Profit'],
  },
  {
    name: 'template-stage',
    caption: '“Actual” is what really happened that round — it becomes visible to both players once the round is over. Your block is highlighted.',
    cols: ['Round', 'Signal', 'Profit', 'Quantity', 'Profit', 'Actual', 'Sold'],
  },
  {
    name: 'infoshare (BEFORE — the one that broke)',
    caption: 'The Actual Forecast and Customer Demand columns are what really happened. Both become visible to both players once a round is over — which is why a report that did not match is always found out, one round later. Your own profit column is in bold.',
    cols: ['Period', 'Actual Forecast', 'Reported Forecast by Retailer', 'Production', 'Customer Demand', "Retailer's Profit", "Supplier's Profit"],
  },
  {
    name: 'infoshare (AFTER — caption outside, wider band)',
    // ⚠ infoshare does NOT use the standard shell for its history: seven columns need
    // 856px, so it renders in a centred band up to 1000px. Without this override the row
    // below would read as broken when it is the fixed, measured-green case.
    box: 1000,
    caption: null,
    cols: ['Period', 'Actual Forecast', 'Reported Forecast by Retailer', 'Production', 'Customer Demand', "Retailer's Profit", "Supplier's Profit"],
  },
  { name: 'pd (singleplayer)',      caption: null, cols: ['— passes no caption —'] },
  { name: 'pricing (singleplayer)', caption: null, cols: ['— passes no caption —'] },
]

const browser = await chromium.launch()
const page = await browser.newPage()
const measure = (text, size) => page.evaluate(([t, font, s]) => {
  const el = document.createElement('span')
  el.style.cssText = `font-family:${font};font-size:${s};white-space:nowrap;position:absolute;visibility:hidden`
  el.textContent = t
  document.body.appendChild(el)
  const w = el.getBoundingClientRect().width
  el.remove()
  return w
}, [text, FONT, size])

const rows = []
for (const g of GAMES) {
  const capW = g.caption ? Math.round(await measure(g.caption, SIZE_XS)) + CELL_PAD : 0
  let colsW = 0
  if (!g.cols[0].startsWith('—')) {
    for (const c of g.cols) colsW += Math.round(await measure(c, SIZE_TABLE)) + CELL_PAD
  }
  rows.push({
    name: g.name,
    chars: g.caption ? g.caption.length : 0,
    capW, colsW,
    binding: !g.caption ? 'no caption' : capW > colsW ? 'CAPTION' : 'columns',
    tableW: Math.max(capW, colsW),
    // Positive = fits the shell, nothing hidden. Negative = columns off-screen.
    box: g.box ?? SHELL,
    fits: (g.box ?? SHELL) - Math.max(capW, colsW),
  })
}
await browser.close()

console.log(`\nstudent shell = ${SHELL}px (contentWidth 640 − pagePad 2rem × 2)\n`)
console.log('game                                        chars  caption  columns    table     box   vs box  verdict')
console.log('─'.repeat(108))
for (const r of rows) {
  const verdict = r.binding === 'no caption' ? 'unaffected'
    : r.fits < 0 ? 'COLUMNS OFF-SCREEN'
    : r.fits < 80 ? 'fits — but near the edge'
    : 'fits'
  console.log(
    r.name.padEnd(42),
    String(r.chars || '—').padStart(5),
    (r.capW ? r.capW + 'px' : '—').padStart(8),
    (r.colsW ? r.colsW + 'px' : '—').padStart(8),
    (r.tableW ? r.tableW + 'px' : '—').padStart(8),
    (r.box + 'px').padStart(7),
    `${r.fits >= 0 ? '+' : ''}${r.fits}px`.padStart(9),
    ' ' + verdict,
  )
}
console.log('\n"vs shell" = 576 − table width. Negative means columns are outside the scroll')
console.log('box with no affordance. A small positive is not safety: it is one added word.')
