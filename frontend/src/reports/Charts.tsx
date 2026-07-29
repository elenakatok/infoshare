import { RoundSeriesChart, colors } from '@mygames/game-ui'
import type { Series, PairPoint } from './analytics'

// ═══════════════════════════════════════════════════════════════════════════════
// The two round-series charts and the reciprocity scatter.
//
// Both series charts use the SHARED RoundSeriesChartSVG shell (spec §10) — the same one
// Pricing uses — so infoshare's charts are not a different generation of picture.
// ═══════════════════════════════════════════════════════════════════════════════

// ⚠ ONE COLOUR PER CONCEPT, ACROSS EVERY CHART ON THE PAGE — AND ACROSS THE SCREENS AND
// THE PRINTED SHEET TOO. HIGH is always blue and LOW is always red, in the trustworthiness
// series, in the trust series, in the scatter, in every legend, in the in-game numbers
// panel, and on the instruction sheet the student was handed. When the same idea changes
// colour between two pictures a reader has to re-learn the key each time.
//
// Defined ONCE in ../demandColours and re-exported here for the report modules that
// already import from this file. Do not declare a demand colour anywhere else.
export { HIGH_COLOUR, LOW_COLOUR, NEUTRAL_COLOUR } from '../demandColours'
import { HIGH_COLOUR, LOW_COLOUR, NEUTRAL_COLOUR } from '../demandColours'

/** Big enough to read projected — these charts are used in a lecture theatre. */
const DOT = 6

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
        { key: 'trueLow', label: 'Demand was LOW', color: LOW_COLOUR, points: toPoints(data.trueLow) },
        { key: 'trueHigh', label: 'Demand was HIGH', color: HIGH_COLOUR, points: toPoints(data.trueHigh) },
      ]}
      markersOnly
      dotRadius={DOT}
      yAxisLabel="Proportion of reports that were truthful"
      yDomain={[0, 1]}
      formatValue={(v) => `${Math.round(v * 100)}%`}
      ariaLabel={`Proportion of reports matching the true demand type, by round — ${scope}`}
      testIdPrefix="chart-trustworthiness"
      countSeriesKey="trueLow"
      caption={
        <>
          {/*
            ⚠ IF A CAPTION NAMES A COLOUR, IT IS COUPLED TO THE PALETTE. This one said
            "orange" and "teal" and became wrong the moment the palette moved to blue and
            red — a caption that contradicts the chart is worse than no caption, because
            the reader trusts the words. Say HIGH and LOW, which the legend already
            colours, and the sentence survives the next palette change too.
          */}
          A Retailer never loses by reporting HIGH when demand really is HIGH, so the
          <strong> HIGH</strong> dots sit near the top almost by construction.
          <strong> The LOW dots are the game</strong> — telling the truth about LOW is
          what costs something. Each dot is one round; clock-resolved rounds are excluded,
          so the number of groups behind a dot varies and the dots are deliberately not
          joined.
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
        { key: 'afterHigh', label: 'After a HIGH report', color: HIGH_COLOUR, points: toPoints(data.afterHigh) },
        { key: 'afterLow', label: 'After a LOW report', color: LOW_COLOUR, points: toPoints(data.afterLow) },
      ]}
      markersOnly
      dotRadius={DOT}
      yAxisLabel="Average lots produced"
      yDomain={[1, 3]}
      formatValue={(v) => v.toFixed(2)}
      ariaLabel={`Average production by report received, by round — ${scope}`}
      testIdPrefix="chart-trust"
      countSeriesKey="afterHigh"
      caption={
        <>
          The gap between the lines <strong>is</strong> belief. A Supplier who has stopped
          listening orders the same amount whatever the message, and the two sets of dots
          converge. Each dot is one round; clock-resolved rounds are excluded, so the number
          of groups behind a dot varies and the dots are deliberately not joined.
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
            <circle cx={x(p.truthAboutLow!)} cy={y(p.productionAfterLow!)} r={9} fill={NEUTRAL_COLOUR} fillOpacity={0.8} />
            <text x={x(p.truthAboutLow!)} y={y(p.productionAfterLow!) + 3} fontSize="8"
              fill="#fff" textAnchor="middle" fontWeight="700">{p.groupNumber}</text>
          </g>
        ))}
        <text x={(W + PAD) / 2} y={H - 8} fontSize="11" fill="#444" textAnchor="middle">
          Retailer: proportion of LOW rounds reported truthfully
        </text>
        <text x={14} y={(H - PAD) / 2} fontSize="11" fill="#444" textAnchor="middle"
          transform={`rotate(-90 14 ${(H - PAD) / 2})`}>
          Supplier: average lots produced after a LOW report
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
