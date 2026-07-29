import { RoundSeriesChart, colors } from '@mygames/game-ui'
import type { Series, PairPoint } from './analytics'

// ═══════════════════════════════════════════════════════════════════════════════
// The two round-series charts and the reciprocity scatter.
//
// Both series charts use the SHARED RoundSeriesChartSVG shell (spec §10) — the same one
// Pricing uses — so infoshare's charts are not a different generation of picture.
// ═══════════════════════════════════════════════════════════════════════════════

const RETAILER = '#D38626'   // the house orange
const SUPPLIER = '#2563eb'

const toPoints = (s: Series) => s.map((p) => ({ round: p.round, value: p.value, n: p.n }))

/**
 * A. TRUSTWORTHINESS — two series, and the split is the analysis.
 *
 * The true-HIGH line sits near 1.0 because a Retailer never has a reason to misreport
 * HIGH. All the behaviour is the true-LOW line. Showing them together is what lets a
 * student SEE the asymmetry rather than be told it.
 */
export function TrustworthinessChart({ data, scope }: { data: { trueHigh: Series; trueLow: Series }; scope: string }) {
  return (
    <RoundSeriesChart
      series={[
        { key: 'trueLow', label: 'Demand was LOW', color: RETAILER, points: toPoints(data.trueLow) },
        { key: 'trueHigh', label: 'Demand was HIGH', color: '#94a3b8', points: toPoints(data.trueHigh) },
      ]}
      yDomain={[0, 1]}
      formatValue={(v) => `${Math.round(v * 100)}%`}
      ariaLabel={`Proportion of reports matching the true demand type, by round — ${scope}`}
      testIdPrefix="chart-trustworthiness"
      countSeriesKey="trueLow"
      caption={
        <>
          A Retailer never loses by reporting HIGH when demand really is HIGH, so the grey
          line is near the top almost by construction. <strong>The orange line is the
          game</strong> — telling the truth about LOW is what costs something.
          Rounds resolved by the clock are excluded.
        </>
      }
    />
  )
}

/**
 * B. TRUST — average production after each kind of report.
 *
 * Keyed on what the Supplier SAW. Converging lines mean the message stopped mattering.
 */
export function TrustChart({ data, scope }: { data: { afterHigh: Series; afterLow: Series }; scope: string }) {
  return (
    <RoundSeriesChart
      series={[
        { key: 'afterHigh', label: 'After a HIGH report', color: SUPPLIER, points: toPoints(data.afterHigh) },
        { key: 'afterLow', label: 'After a LOW report', color: '#7c3aed', points: toPoints(data.afterLow) },
      ]}
      yDomain={[1, 3]}
      formatValue={(v) => v.toFixed(2)}
      ariaLabel={`Average production by report received, by round — ${scope}`}
      testIdPrefix="chart-trust"
      countSeriesKey="afterHigh"
      caption={
        <>
          The gap between the lines <strong>is</strong> belief. A Supplier who has stopped
          listening orders the same amount whatever the message, and the two lines close.
          Rounds resolved by the clock are excluded.
        </>
      }
    />
  )
}

/**
 * C. RECIPROCITY — one dot per pair, class-wide only.
 *
 * Hand-drawn SVG rather than the round-series shell: this is not a time series, and
 * forcing it into one would mean lying about the x axis. Pairs with no true-LOW rounds
 * are listed under the plot rather than drawn at zero — zero would read as "never
 * honest" when the truth is "never tested".
 */
export function ReciprocityScatter({ points }: { points: PairPoint[] }) {
  const plotted = points.filter((p) => p.truthAboutLow !== null && p.productionAfterLow !== null)
  const skipped = points.filter((p) => p.truthAboutLow === null || p.productionAfterLow === null)

  const W = 460, H = 340, PAD = 52
  const x = (v: number) => PAD + v * (W - PAD - 16)
  const y = (v: number) => H - PAD - ((v - 1) / 2) * (H - PAD - 16)

  return (
    <div data-testid="chart-reciprocity">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W }} role="img"
        aria-label="Retailer honesty about LOW against supplier production after a LOW report, one point per pair">
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={`gx${t}`}>
            <line x1={x(t)} y1={16} x2={x(t)} y2={H - PAD} stroke="#eee" />
            <text x={x(t)} y={H - PAD + 16} fontSize="10" fill="#666" textAnchor="middle">{Math.round(t * 100)}%</text>
          </g>
        ))}
        {[1, 1.5, 2, 2.5, 3].map((q) => (
          <g key={`gy${q}`}>
            <line x1={PAD} y1={y(q)} x2={W - 16} y2={y(q)} stroke="#eee" />
            <text x={PAD - 8} y={y(q) + 3} fontSize="10" fill="#666" textAnchor="end">{q}</text>
          </g>
        ))}
        <line x1={PAD} y1={H - PAD} x2={W - 16} y2={H - PAD} stroke="#999" />
        <line x1={PAD} y1={16} x2={PAD} y2={H - PAD} stroke="#999" />
        {plotted.map((p) => (
          <g key={p.groupId}>
            <circle cx={x(p.truthAboutLow!)} cy={y(p.productionAfterLow!)} r={7} fill={RETAILER} fillOpacity={0.75} />
            <text x={x(p.truthAboutLow!)} y={y(p.productionAfterLow!) + 3} fontSize="8"
              fill="#fff" textAnchor="middle" fontWeight="700">{p.groupNumber}</text>
          </g>
        ))}
        <text x={(W + PAD) / 2} y={H - 8} fontSize="11" fill="#444" textAnchor="middle">
          Retailer: truth told about LOW
        </text>
        <text x={14} y={(H - PAD) / 2} fontSize="11" fill="#444" textAnchor="middle"
          transform={`rotate(-90 14 ${(H - PAD) / 2})`}>
          Supplier: average order after LOW
        </text>
      </svg>
      <p style={{ fontSize: '0.78rem', color: colors.textSecondary, margin: '0.4rem 0 0' }}>
        One dot per pair, numbered by group. Up and to the right means honesty and belief
        travelled together; a flat cloud means the message never mattered.
        {skipped.length > 0 && (
          <> {skipped.length} pair{skipped.length === 1 ? '' : 's'} not plotted: either no
          LOW round ever came up, or the Retailer never once reported LOW — so the Supplier
          was never given a LOW report to respond to. A pair that always reports HIGH has no
          y value, which is itself the finding.</>
        )}
      </p>
    </div>
  )
}
