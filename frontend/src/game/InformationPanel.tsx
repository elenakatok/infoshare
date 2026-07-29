import { useState } from 'react'
import { HIGH_COLOUR, LOW_COLOUR } from '../demandColours'
import { colors, typography, spacing } from '@mygames/game-ui'
import { payoffTable } from '../../../functions/src/round/resolver'
import { DEFAULT_ROUND_SETTINGS, profileFor, LOTS, type RoundSettings, type Lots } from '../../../functions/src/round/settings'

// ═══════════════════════════════════════════════════════════════════════════════
// THE INFORMATION PANEL (spec §1.4) — one panel, both histograms AND the payoff table,
// reachable from EVERY decision screen, for BOTH roles.
//
// ⚠ INLINE SVG COMPUTED FROM CONFIG. NEVER AN IMAGE FILE. The demand triple is a
// Settings field: a PNG of the histograms becomes a lie the moment an instructor edits
// it, and the student reads 0.65 off a picture while the game draws something else. Same
// never-stale rule that governs the knowledge check. Both the bars and every cell of the
// table below are derived from the same settings the resolver uses.
//
// ⚠ BOTH ROLES SEE BOTH HISTOGRAMS. The distributions are public knowledge — the Supplier
// needs them to reason about what a HIGH report is worth, which is the entire decision
// they are being asked to make. Stated explicitly because this is exactly the kind of
// thing that gets quietly role-gated by someone being careful about information. What is
// private is THIS ROUND'S DRAW, not the distribution it came from.
//
// Shape follows the printed sheet (scripts/instructions/content-infoshare.js): two
// histograms side by side, payoff table beneath. The sheet even tells students "You will
// see these on screen during the game" — so it has to be the same picture.
// ═══════════════════════════════════════════════════════════════════════════════


function Histogram({ type, s }: { type: 'HIGH' | 'LOW'; s: RoundSettings }) {
  const dist = profileFor(type, s)
  const colour = type === 'HIGH' ? HIGH_COLOUR : LOW_COLOUR
  const W = 210, H = 150, PAD_L = 34, PAD_B = 30
  const plotH = H - PAD_B - 12
  const barW = (W - PAD_L - 10) / LOTS.length

  return (
    <figure style={{ margin: 0 }} data-testid={`histogram-${type.toLowerCase()}`}>
      <figcaption style={{ fontSize: typography.sizeSm, fontWeight: 700, marginBottom: 2, color: colour }}>
        {type} demand type
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W }} role="img"
        aria-label={`Probability of 1, 2 or 3 lots when the demand type is ${type}: ` +
          LOTS.map((k) => `${k} lots ${Math.round(dist[k] * 100)}%`).join(', ')}>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}>
            <line x1={PAD_L} y1={12 + plotH * (1 - t)} x2={W - 6} y2={12 + plotH * (1 - t)} stroke="#eee" />
            <text x={PAD_L - 5} y={12 + plotH * (1 - t) + 3} fontSize="8" fill="#666" textAnchor="end">
              {Math.round(t * 100)}%
            </text>
          </g>
        ))}
        {LOTS.map((k, i) => {
          const h = plotH * dist[k]
          return (
            <g key={k}>
              <rect x={PAD_L + i * barW + barW * 0.18} y={12 + plotH - h}
                width={barW * 0.64} height={Math.max(h, 0.5)} fill={colour} />
              <text x={PAD_L + i * barW + barW / 2} y={12 + plotH - h - 3}
                fontSize="9" fill="#333" textAnchor="middle" fontWeight="700">
                {Math.round(dist[k] * 100)}%
              </text>
              <text x={PAD_L + i * barW + barW / 2} y={H - PAD_B + 14}
                fontSize="9" fill="#444" textAnchor="middle">{k}</text>
            </g>
          )
        })}
        <line x1={PAD_L} y1={12 + plotH} x2={W - 6} y2={12 + plotH} stroke="#999" />
        <text x={PAD_L + (W - PAD_L) / 2} y={H - 4} fontSize="9" fill="#555" textAnchor="middle">
          Lots customers want
        </text>
      </svg>
    </figure>
  )
}

const th: React.CSSProperties = {
  textAlign: 'left', padding: '0.3rem 0.6rem', borderBottom: '2px solid #ddd',
  fontSize: '0.75rem', fontWeight: 600, background: '#faf7f2', whiteSpace: 'nowrap',
}
const td: React.CSSProperties = {
  padding: '0.3rem 0.6rem', borderBottom: '1px solid #eee',
  fontSize: '0.8rem', fontVariantNumeric: 'tabular-nums',
}

/** The panel's body. Split out so it can be embedded or shown in the drawer. */
export function InformationPanelBody({ settings = DEFAULT_ROUND_SETTINGS }: { settings?: RoundSettings }) {
  const t = payoffTable(settings)
  const money = (n: number) => (n < 0 ? `−${Math.abs(n)}` : `${n}`)

  return (
    <div data-testid="information-panel">
      <h4 style={{ margin: `0 0 ${spacing.gapSm}`, fontSize: '0.95rem' }}>Customer demand</h4>
      <p style={{ margin: `0 0 ${spacing.gapSm}`, fontSize: typography.sizeSm, color: colors.textSecondary }}>
        Chance that customers want this many lots. Both types are shown; only this
        round&apos;s draw is private.
      </p>
      <div style={{ display: 'flex', gap: spacing.gapLg, flexWrap: 'wrap' }}>
        <Histogram type="HIGH" s={settings} />
        <Histogram type="LOW" s={settings} />
      </div>

      <h4 style={{ margin: `${spacing.gapLg} 0 ${spacing.gapSm}`, fontSize: '0.95rem' }}>Profits</h4>
      <p style={{ margin: `0 0 ${spacing.gapSm}`, fontSize: typography.sizeSm, color: colors.textSecondary }}>
        Customers pay {settings.retailPrice} per lot sold; the Retailer pays the Supplier{' '}
        {settings.wholesalePrice}. Each lot costs the Supplier {settings.unitCost} to make,
        sold or not.
      </p>
      <div style={{ overflowX: 'auto', border: '1px solid #ddd', borderRadius: 6, maxWidth: 460 }}>
        <table data-testid="payoff-table" style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th style={th}>
                Customer demand
                <div style={{ fontWeight: 400, fontSize: '0.68rem', color: colors.textSecondary }}>
                  each cell: Retailer / Supplier
                </div>
              </th>
              {LOTS.map((q) => <th key={q} style={th}>Produce {q}</th>)}
            </tr>
          </thead>
          <tbody>
            {LOTS.map((d) => (
              <tr key={d}>
                <td style={{ ...td, fontWeight: 600 }}>{d} lot{d === 1 ? '' : 's'}</td>
                {LOTS.map((q) => (
                  <td key={q} style={td} data-testid={`payoff-${d}-${q}`}>
                    {money(t[d as Lots][q as Lots].retailer)} / {money(t[d as Lots][q as Lots].supplier)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ marginTop: spacing.gapSm, fontSize: typography.sizeXs, color: colors.textSecondary }}>
        Your grade depends on taking part, not on the profits you earn.
      </p>
    </div>
  )
}

/**
 * THE PANEL AS A TOGGLE, on both decision screens.
 *
 * ⚠ OPEN BY DEFAULT IN ROUND 1, THEN THE STUDENT'S OWN CHOICE FOREVER AFTER.
 *
 * Round 1 is when a student most needs the distributions and the payoff table, and when
 * they are least likely to go looking for a control they have never seen. Every round
 * after that, the panel is whatever they last left it — a default that reasserts itself
 * each round would reopen a panel they deliberately closed, ten times running.
 *
 * ⚠ THE CHOICE IS TRACKED, NOT INFERRED. `touched` records whether the student has
 * actually used the toggle. Without it, "open in round 1 only" and "the student closed
 * it in round 1" are the same state, and the panel would spring back open in round 2 for
 * exactly the student who just said no.
 *
 * Deliberately component-local, not persisted: it is a reading preference for one
 * sitting, and a stored one would outlive the class it was set in.
 */
export default function InformationPanel({ settings, round }: { settings?: RoundSettings; round?: number }) {
  const [touched, setTouched] = useState(false)
  const [openedByUser, setOpenedByUser] = useState(false)
  const open = touched ? openedByUser : round === 1

  const toggle = () => {
    setOpenedByUser(!open)
    setTouched(true)
  }

  return (
    <section style={{ margin: `${spacing.gapMd} 0` }}>
      <button
        data-testid="info-panel-toggle"
        onClick={toggle}
        style={{ padding: '0.3rem 0.7rem', fontSize: typography.sizeSm, cursor: 'pointer',
                 borderRadius: 4, border: `1px solid ${colors.borderMid}`, background: colors.white }}
      >
        {open ? 'Hide the numbers ▲' : 'Show the numbers ▼'}
      </button>
      {open && (
        <div style={{ marginTop: spacing.gapSm, padding: spacing.gapMd,
                      border: `1px solid ${colors.borderMid}`, borderRadius: 8, background: colors.white }}>
          <InformationPanelBody settings={settings} />
        </div>
      )}
    </section>
  )
}
