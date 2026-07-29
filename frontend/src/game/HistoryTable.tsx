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
function sections(viewerRole?: Role) {
  return [
    col<RoundRecord>('round', 'Round', (h) => h.round, { align: 'left' }),
    group<RoundRecord>('retailer', 'Retailer', [
      sub('message', 'Reported', (h) => h.message),
      sub('profitR', 'Profit', (h) => money(h.profits.retailer), {
        testId: (h) => `retailer-profit-${h.round}`,
      }),
    ], { mine: viewerRole === 'retailer' }),
    group<RoundRecord>('supplier', 'Supplier', [
      sub('production', 'Produced', (h) => h.production),
      sub('profitS', 'Profit', (h) => money(h.profits.supplier), {
        testId: (h) => `supplier-profit-${h.round}`,
      }),
    ], { mine: viewerRole === 'supplier' }),
    // The truth, revealed. Deliberately AFTER what was claimed: a student reads left to
    // right and should meet the report before the reality — which is the lesson.
    col<RoundRecord>('demandType', 'Actual type', (h) => h.demandType),
    col<RoundRecord>('actualDemand', 'Demand', (h) => h.actualDemand),
    col<RoundRecord>('sales', 'Sold', (h) => h.sales),
  ]
}

export default function HistoryTable({ history, viewerRole }: { history: RoundRecord[]; viewerRole?: Role }) {
  return (
    <SharedHistoryTable<RoundRecord>
      rows={history}
      sections={sections(viewerRole)}
      testId="game-history"
      rowKey={(h) => h.round}
      rowTestId={(h) => `game-history-row-${h.round}`}
      emptyMessage="No completed rounds yet."
      caption={
        <span style={{ color: colors.textSecondary }}>
          “Actual type” and “Demand” are what really happened — both become visible to both
          players once the round is over, which is why a misleading report is always found
          out one round later.
          {viewerRole ? ' Your block is highlighted.' : ''}
        </span>
      }
    />
  )
}
