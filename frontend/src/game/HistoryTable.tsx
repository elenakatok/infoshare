import { HistoryTable as SharedHistoryTable, col, group, sub, num, colors } from '@mygames/game-ui'
import type { RoundRecord, Role } from '../api'

// ═══════════════════════════════════════════════════════════════════════════════
// THE HISTORY TABLE — columns as DATA on the shared widget.
// ⚠ PLACEHOLDER_GAME columns (spawn Part 1); §1.3 specifies seven, identical per role.
//
// `col` / `group` / `sub` describe the columns; the widget owns the grouped headers,
// the shading, the overflow wrapper and the empty state. Do not hand-write a <table>
// here — three games did, and the third one's horizontal-scroll bug had already been
// fixed twice elsewhere.
//
// ── WHY HISTORY IS IDENTICAL FOR EVERY SEAT ──────────────────────────────────
// The privacy in a stage game is WITHIN a round, not across the game. Once a round
// resolves, the hidden draw becomes public and lands here for everyone — which is
// exactly what makes a misleading signal discoverable one round later, and therefore
// what makes reputation possible. If your game needs a column one role cannot see,
// stop: that is a different design, and it needs the reveal rule, not a filtered
// column list.
//
// ── THE REVEAL CONTRACT (Extraction Spec §3.5.2) ─────────────────────────────
// game-ui takes NO runtime dependency on the stage engine — nine live games resolve
// this package, and giving it an engine dependency changes what all nine install. So
// this widget renders faithfully WHATEVER IT IS HANDED. It cannot protect you.
// The reveal is discharged SERVER-SIDE: `history` arrives from getRoundView, built
// through the engine's `buildSeatView`, so the in-flight round is not in the array at
// all. The harness asserts that on the wire rather than trusting this comment.
// ═══════════════════════════════════════════════════════════════════════════════

const money = (n: number) => num(n)


/** The viewer's own block is marked `mine` and lightly shaded. */
/**
 * THE SEVEN COLUMNS (spec §1.2), IDENTICAL FOR BOTH ROLES.
 *
 * ⚠ THE PRIVACY IN THIS GAME IS WITHIN A ROUND, NOT ACROSS THE GAME. Once a round
 * resolves the true type and the realised demand become public to both seats — which is
 * exactly what makes a misleading report discoverable one round later, and therefore what
 * makes reputation possible at all. Do not filter a column by role.
 *
 * The columns come from THREE different places, a distinction invisible in the list and
 * needed by anyone wiring it (spec §1.2):
 *   Actual Forecast    round field  demand_type
 *   Reported Forecast  submission   stage 1
 *   Production         submission   stage 2
 *   Customer Demand    round field  actual_demand
 *   both Profits       result value from the resolver
 */
/**
 * GROUPED MODE — TWO HEADER ROWS, exactly as crisis renders it.
 *
 * ⚠ THE FLAT SEVEN WERE WHAT SET THE WIDTH. Every column spelled out its owner
 * ("Reported Forecast by Retailer"), repeating in each header what a group header says
 * once. Nine hundred pixels of table for seven values, overflowing a 1300px window.
 *
 * Crisis fits TEN columns in ~400px because the top row groups by WHO and the bottom row
 * carries short labels. Same widget, a mode infoshare simply was not using — I built the
 * group/sub model in slice 3, noted infoshare's flat seven "falls out of the model", and
 * drew the wrong conclusion: the model was right and the table was the wrong shape.
 *
 * ⚠ NO STYLE VALUES HERE. Padding, font sizes, row height, the two-row header and the
 * `mine` shading all live in the shared widget, so this cannot drift from crisis by
 * inventing its own numbers — which is exactly what the breakout div did.
 * `mine` also renders the block header as "You (Retailer)" / "You (Supplier)".
 */
function sections(viewerRole?: Role) {
  return [
    col<RoundRecord>('round', 'Period', (h) => h.round, { align: 'left' }),

    group<RoundRecord>('retailer', 'Retailer', [
      sub('message', 'Reported', (h) => h.message),
      sub('profitR', 'Profit', (h) => money(h.profits.retailer),
        { testId: (h) => `retailer-profit-${h.round}` }),
    ], { mine: viewerRole === 'retailer' }),

    group<RoundRecord>('supplier', 'Supplier', [
      sub('production', 'Produced', (h) => h.production),
      sub('profitS', 'Profit', (h) => money(h.profits.supplier),
        { testId: (h) => `supplier-profit-${h.round}` }),
    ], { mine: viewerRole === 'supplier' }),

    /*
      WHAT REALLY HAPPENED. Belongs to neither seat, so it takes no `mine` shading.
      ⚠ Both cells are public to BOTH seats once the round resolves — that is what makes
      a report that did not match discoverable one round later.
    */
    group<RoundRecord>('demand', 'Demand', [
      sub('demandType', 'Type', (h) => h.demandType),
      sub('sold', 'Sold', (h) => h.sales),
    ]),
  ]
}

/**
 * ⚠ RENDERED EXACTLY AS CRISIS RENDERS IT — no wrapper, no width, no breakout.
 *
 * This used to sit inside a centred band (`width: min(94vw, 1000px)`, `marginLeft: 50%`,
 * `transform: translateX(-50%)`), added when I mis-diagnosed a table that was too wide.
 * The real cause was the caption (see below); the band was an extra change that then
 * broke narrow windows — it takes the table OUT of the page's normal flow, so at ~570px
 * the PAGE scrolled sideways instead of the table, and the widget's own scroll container
 * never became the thing that moved.
 *
 * The shared widget already does the right thing: `overflowX: auto` with `maxWidth: 100%`
 * scrolls the TABLE inside whatever box it is given. Crisis, PD and Pricing all get that
 * for free by not wrapping it. So does this now.
 *
 * ⚠ THE EXPLANATION STAYS OUTSIDE THE TABLE. game-ui renders `caption` as a <tfoot> cell
 * spanning every column; before v0.28.0 it inherited the body cells' `white-space:
 * nowrap`, so one long sentence set the table's MINIMUM width — measured at 1875px in a
 * 1000px box, pushing four of the seven columns out of reach. That is fixed in the shared
 * widget now, but keeping prose out of the table costs nothing and removes the coupling
 * entirely.
 */
export default function HistoryTable({ history, viewerRole }: { history: RoundRecord[]; viewerRole?: Role }) {
  return (
    <div>
      <SharedHistoryTable<RoundRecord>
        rows={history}
        sections={sections(viewerRole)}
        testId="game-history"
        rowKey={(h) => h.round}
        rowTestId={(h) => `game-history-row-${h.round}`}
        emptyMessage="No completed rounds yet."
      />
      {history.length > 0 && (
        <p style={{ color: colors.textSecondary, fontSize: '0.75rem', margin: '0.4rem 0 0' }}>
          The Demand block is what really happened — both players see it once the round
          is over.{viewerRole ? ' Your own block is shaded.' : ''}
        </p>
      )}
    </div>
  )
}
