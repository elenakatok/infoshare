import { HistoryTable as SharedHistoryTable, col, num, colors } from '@mygames/game-ui'
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
const mineIf = (mine: boolean, text: string) =>
  mine ? <strong>{text}</strong> : <span>{text}</span>

function sections(viewerRole?: Role) {
  return [
    col<RoundRecord>('round', 'Period', (h) => h.round, { align: 'left' }),
    col<RoundRecord>('demandType', 'Actual Forecast', (h) => h.demandType),
    col<RoundRecord>('message', 'Reported Forecast by Retailer', (h) => h.message),
    col<RoundRecord>('production', 'Production', (h) => h.production),
    col<RoundRecord>('actualDemand', 'Customer Demand', (h) => h.actualDemand),
    // Both profits, to both roles. The viewer's OWN column is bolded so they can find
    // themselves at a glance — emphasis only; the numbers shown are the same either way.
    col<RoundRecord>('profitR', "Retailer's Profit",
      (h) => mineIf(viewerRole === 'retailer', money(h.profits.retailer)),
      { testId: (h) => `retailer-profit-${h.round}` }),
    col<RoundRecord>('profitS', "Supplier's Profit",
      (h) => mineIf(viewerRole === 'supplier', money(h.profits.supplier)),
      { testId: (h) => `supplier-profit-${h.round}` }),
  ]
}

/**
 * ⚠ THE EXPLANATION IS RENDERED OUTSIDE THE TABLE, AND THAT IS LOAD-BEARING.
 *
 * game-ui renders `caption` as a `<tfoot>` cell that inherits the body cells'
 * `white-space: nowrap`. A long caption therefore becomes ONE UNWRAPPABLE LINE that sets
 * the table's minimum width — measured here at 1875px for a two-sentence caption, which
 * inflated all seven columns proportionally (2.1×) and pushed four of them outside the
 * scroll box. It looked exactly like "seven columns don't fit", and it was not: the
 * columns need about 900px. Pass `caption` only something short, or nothing.
 *
 * ⚠ Worth fixing in game-ui — `whiteSpace: 'normal'` on that tfoot cell — but that is a
 * shared package rendering nine live games' tables, so it is Elena's call, not a change
 * to make in passing. Nothing here depends on it.
 *
 * The band is wider than the student shell (~570px) because seven columns need ~900px.
 * The shared widget's horizontal scroll still handles phones.
 */
export default function HistoryTable({ history, viewerRole }: { history: RoundRecord[]; viewerRole?: Role }) {
  return (
    <div style={{ width: 'min(94vw, 1000px)', marginLeft: '50%', transform: 'translateX(-50%)' }}>
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
          The Actual Forecast and Customer Demand columns are what really happened. Both
          become visible to both players once a round is over — which is why a report that
          did not match is always found out, one round later.
          {viewerRole ? ' Your own profit column is in bold.' : ''}
        </p>
      )}
    </div>
  )
}
