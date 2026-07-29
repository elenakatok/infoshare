import { useEffect, useMemo, useState } from 'react'
import {
  GameHeader, ReportBoard, RosterReport, RosterNameCell, FreeTextReportSet,
  type ReportTileConfig, type SortableColumn, type RosterReportRow, type FreeTextAnswer,
} from '@mygames/game-ui'
import { getReportData, getRoundReport, type StudentRoundRow, type ReportRow } from '../api'
import { ALL_QUESTIONS } from '../../../functions/src/kcQuestions'
import { babblingVsCredible } from '../../../functions/src/round/resolver'
import { DEFAULT_ROUND_SETTINGS } from '../../../functions/src/round/settings'
import {
  trustworthiness, trust, reciprocity, summary, benchmarkDistance, behavioural,
} from '../reports/analytics'
import { TrustworthinessChart, TrustChart, ReciprocityScatter } from '../reports/Charts'

// ═══════════════════════════════════════════════════════════════════════════════
// REPORTS — Information Sharing.
//
// Structure, tile styling and spacing follow CRISIS's Reports.tsx: a header bar, a
// ReportBoard of tiles, a modal per tile, the same Figure card and table density.
// Infoshare must not be visually distinguishable as a different generation of page.
//
// ── WHAT THIS PAGE IS FOR ────────────────────────────────────────────────────
// TRUST and TRUSTWORTHINESS. Not "average production by round" — that is a statistic,
// not the analysis. Every tile serves one question: did the Retailer tell the truth, did
// the Supplier believe it, and did the two travel together?
//
// ⚠ DEFAULTED ROUNDS ARE EXCLUDED EVERYWHERE (spec §10.1) — see reports/analytics.ts.
// ⚠ THE BENCHMARKS ARE DERIVED from `babblingVsCredible`, never typed. A settings edit
//    must move them, which is the entire reason that solver exists.
// ═══════════════════════════════════════════════════════════════════════════════

const pct = (r: number | null) => (r === null ? '—' : `${(r * 100).toFixed(0)}%`)
const two = (n: number | null) => (n === null ? '—' : n.toFixed(2))

function Modal({ title, wide, onClose, children }: { title: string; wide?: boolean; onClose: () => void; children: React.ReactNode }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '3rem 1rem', zIndex: 1000, overflowY: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 8, boxShadow: '0 8px 32px rgba(0,0,0,0.25)', width: '100%', maxWidth: wide ? 'min(1100px, calc(100vw - 2rem))' : 'min(900px, calc(100vw - 2rem))', boxSizing: 'border-box', maxHeight: 'calc(100vh - 6rem)', overflowY: 'auto', padding: '1.25rem 1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>{title}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '1.25rem', cursor: 'pointer', color: '#666' }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

function Figure({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div style={{ border: '1px solid #eee', borderRadius: 8, padding: '0.75rem 1rem', minWidth: 170 }}>
      <div style={{ fontSize: '0.75rem', color: '#666' }}>{label}</div>
      <div style={{ fontSize: '1.4rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {note && <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>{note}</div>}
    </div>
  )
}

const IS_TH: React.CSSProperties = {
  textAlign: 'left', padding: '0.4rem 0.7rem', borderBottom: '2px solid #ddd',
  fontSize: '0.8rem', fontWeight: 600, whiteSpace: 'nowrap', background: '#faf7f2',
}
const IS_TD: React.CSSProperties = {
  padding: '0.4rem 0.7rem', borderBottom: '1px solid #eee',
  fontSize: '0.85rem', fontVariantNumeric: 'tabular-nums',
}

interface Row extends RosterReportRow {
  roundsPlayed: number
  totalProfit: number
  truthAboutLow: number | null
}
type ColKey = 'name' | 'group' | 'role' | 'rounds' | 'profit' | 'truth'

export default function Reports() {
  const [rows, setRows] = useState<Row[]>([])
  const [roundRows, setRoundRows] = useState<StudentRoundRow[]>([])
  const [answers, setAnswers] = useState<Record<string, FreeTextAnswer[]>>({})
  const [active, setActive] = useState<string | null>(null)
  const [groupPick, setGroupPick] = useState<string>('all')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const [base, rounds] = await Promise.all([getReportData(), getRoundReport()])
        setRoundRows(rounds.rows)

        const agg = new Map<string, { rounds: number; profit: number; role: string | null; groupNumber: number; lowTrue: number; lowTold: number }>()
        for (const r of rounds.rows) {
          const live = !(r.defaulted.retailer || r.defaulted.supplier)
          for (const seat of [r.retailerSeat, r.supplierSeat]) {
            const pid = r.pidBySeat[seat]
            if (!pid || pid.startsWith('bot_')) continue
            const role = r.roleBySeat[seat] ?? null
            const profit = role === 'retailer' ? r.profits.retailer : r.profits.supplier
            const cur = agg.get(pid) ?? { rounds: 0, profit: 0, role, groupNumber: r.groupNumber, lowTrue: 0, lowTold: 0 }
            cur.rounds += 1
            cur.profit += profit
            // Truth-about-LOW counts BEHAVIOUR only — a defaulted round is not a choice.
            if (role === 'retailer' && r.demandType === 'LOW' && live) {
              cur.lowTrue += 1
              if (r.truthful) cur.lowTold += 1
            }
            agg.set(pid, cur)
          }
        }

        setRows((base.rows ?? []).map((p: ReportRow): Row => {
          const a = agg.get(p.participant_id)
          return {
            participantId: p.participant_id,
            name: p.display_name,
            groupNumber: a?.groupNumber ?? null,
            role: a?.role ?? null,
            rawScore: p.raw_score,
            absent: !a,
            roundsPlayed: a?.rounds ?? 0,
            totalProfit: a?.profit ?? 0,
            truthAboutLow: a && a.role === 'retailer' && a.lowTrue > 0 ? a.lowTold / a.lowTrue : null,
          }
        }))

        const byQuestion: Record<string, FreeTextAnswer[]> = {}
        for (const q of base.questions ?? []) byQuestion[q.field] = []
        for (const p of base.rows ?? []) {
          for (const q of base.questions ?? []) {
            byQuestion[q.field]?.push({
              participantId: p.participant_id,
              name: p.display_name,
              role: agg.get(p.participant_id)?.role ?? null,
              answer: p.text_answers?.[q.field] ?? null,
            })
          }
        }
        setAnswers(byQuestion)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    })()
  }, [])

  const scoped = useMemo(
    () => (groupPick === 'all' ? roundRows : roundRows.filter((r) => r.group_id === groupPick)),
    [roundRows, groupPick],
  )
  const groups = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of roundRows) m.set(r.group_id, r.groupNumber)
    return [...m.entries()].sort((a, b) => a[1] - b[1])
  }, [roundRows])

  const tw = useMemo(() => trustworthiness(scoped), [scoped])
  const tr = useMemo(() => trust(scoped), [scoped])
  const pairs = useMemo(() => reciprocity(roundRows), [roundRows])
  const sum = useMemo(() => summary(scoped), [scoped])
  const bench = useMemo(
    () => benchmarkDistance(sum, babblingVsCredible(DEFAULT_ROUND_SETTINGS)),
    [sum],
  )

  const columns: SortableColumn<Row, ColKey>[] = useMemo(() => [
    { key: 'name', label: 'Student', render: (r) => <RosterNameCell row={r} />, compare: (a, b) => a.name.localeCompare(b.name) },
    { key: 'group', label: 'Group', render: (r) => r.groupNumber ?? '—', compare: (a, b) => (a.groupNumber ?? -1) - (b.groupNumber ?? -1) },
    { key: 'role', label: 'Role', render: (r) => (r.role === 'retailer' ? 'Retailer' : r.role === 'supplier' ? 'Supplier' : '—'), compare: (a, b) => (a.role ?? '').localeCompare(b.role ?? '') },
    { key: 'rounds', label: 'Rounds', render: (r) => r.roundsPlayed, compare: (a, b) => a.roundsPlayed - b.roundsPlayed },
    {
      key: 'truth', label: 'Truth about LOW',
      render: (r) => (r.role === 'retailer' ? pct(r.truthAboutLow) : '—'),
      compare: (a, b) => (a.truthAboutLow ?? -1) - (b.truthAboutLow ?? -1),
      nullsLast: true, isNull: (r) => r.truthAboutLow === null,
    },
    {
      key: 'profit', label: 'Total profit',
      render: (r) => (r.absent ? '—' : r.totalProfit.toFixed(0)),
      compare: (a, b) => a.totalProfit - b.totalProfit,
      nullsLast: true, isNull: (r) => !!r.absent,
    },
  ], [])

  const hasData = behavioural(roundRows).length > 0
  const scopeLabel = groupPick === 'all' ? 'whole class' : `group ${groups.find(([g]) => g === groupPick)?.[1]}`

  const tiles: ReportTileConfig[] = [
    {
      id: 'summary', title: 'Overall',
      preview: hasData
        ? <span data-testid="tile-summary" style={{ fontSize: '0.9rem', color: '#555' }}>headline numbers · distance from the benchmarks</span>
        : <span data-testid="tile-summary" style={{ color: '#94a3b8', fontSize: '0.85rem' }}>No completed rounds yet.</span>,
      onOpen: () => setActive('summary'), disabled: !hasData, actionLabel: 'Open ↗',
    },
    {
      id: 'trustworthiness', title: 'Trustworthiness by round',
      preview: hasData
        ? <span data-testid="tile-trustworthiness" style={{ fontSize: '0.9rem', color: '#555' }}>truth told, split by what the truth was</span>
        : <span data-testid="tile-trustworthiness" style={{ color: '#94a3b8', fontSize: '0.85rem' }}>No completed rounds yet.</span>,
      onOpen: () => setActive('trustworthiness'), disabled: !hasData, actionLabel: 'Open ↗',
    },
    {
      id: 'trust', title: 'Trust by round',
      preview: hasData
        ? <span data-testid="tile-trust" style={{ fontSize: '0.9rem', color: '#555' }}>average order after each kind of report</span>
        : <span data-testid="tile-trust" style={{ color: '#94a3b8', fontSize: '0.85rem' }}>No completed rounds yet.</span>,
      onOpen: () => setActive('trust'), disabled: !hasData, actionLabel: 'Open ↗',
    },
    {
      id: 'reciprocity', title: 'Reciprocity',
      preview: hasData
        ? <span data-testid="tile-reciprocity" style={{ fontSize: '0.9rem', color: '#555' }}>{pairs.length} pair{pairs.length === 1 ? '' : 's'} · honesty against belief</span>
        : <span data-testid="tile-reciprocity" style={{ color: '#94a3b8', fontSize: '0.85rem' }}>No completed rounds yet.</span>,
      onOpen: () => setActive('reciprocity'), disabled: !hasData, actionLabel: 'Open ↗',
    },
    {
      id: 'students', title: 'Per-student',
      preview: rows.length
        ? <span data-testid="tile-students" style={{ fontSize: '0.9rem', color: '#555' }}>{rows.length} students · sortable</span>
        : <span data-testid="tile-students" style={{ color: '#94a3b8', fontSize: '0.85rem' }}>No students yet.</span>,
      onOpen: () => setActive('students'), disabled: !rows.length, actionLabel: 'Open ↗',
    },
    {
      id: 'debrief', title: 'Debrief answers',
      preview: <span data-testid="tile-debrief" style={{ fontSize: '0.9rem', color: '#555' }}>free-text, grouped by role</span>,
      onOpen: () => setActive('debrief'), actionLabel: 'Open ↗',
    },
  ]

  if (error) return <div style={{ padding: '2rem', textAlign: 'center' }}><p style={{ color: '#c00' }}>{error}</p></div>

  const ScopePicker = () => (
    <div style={{ marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
      <label style={{ fontSize: '0.8rem', color: '#666' }}>Scope</label>
      <select data-testid="scope-picker" value={groupPick} onChange={(e) => setGroupPick(e.target.value)}
        style={{ fontSize: '0.85rem', padding: '0.2rem 0.4rem' }}>
        <option value="all">Whole class</option>
        {groups.map(([gid, n]) => <option key={gid} value={gid}>Group {n}</option>)}
      </select>
      <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
        {sum.rounds} round{sum.rounds === 1 ? '' : 's'} of behaviour
        {sum.excludedDefaults > 0 && ` · ${sum.excludedDefaults} excluded (clock default)`}
      </span>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <GameHeader />
      <div style={{ padding: '1rem 1.5rem 0.5rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
        {/*
          ⚠ THE WAY BACK. This page had none: an instructor who opened Reports had no
          route to the dashboard but the browser's Back button. Crisis, eBay and SAA all
          carry this button; infoshare was the only one without it.

          ⚠ THE QUERY STRING IS CARRIED OVER WHOLE. The instructor's identity lives in
          the URL — `token` + `game_instance_id` in production, `_dev_game_instance_id`
          locally — so a bare href to /dashboard lands on a page with no session and the
          instructor is bounced. Copying `window.location.search` preserves whichever
          scheme opened this page without this file having to know about either, which is
          also why it cannot drift when the param names change.
        */}
        <button
          data-testid="reports-back-to-dashboard"
          onClick={() => { window.location.href = `/dashboard${window.location.search}` }}
          style={{ background: 'none', border: '1px solid #ccc', borderRadius: 4,
                   padding: '0.3rem 0.8rem', cursor: 'pointer', fontSize: '0.85rem' }}
        >← Dashboard</button>
        <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600 }}>Reports — Information Sharing</h2>
      </div>

      <main style={{ flex: 1, padding: '1rem 1.5rem' }}>
        <ReportBoard tiles={tiles} />

        {active === 'summary' && (
          <Modal title="Overall" onClose={() => setActive(null)}>
            <ScopePicker />
            <div data-testid="summary-figures" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
              <Figure label="Avg retailer profit" value={two(sum.retailerProfit)} note="per round" />
              <Figure label="Avg supplier profit" value={two(sum.supplierProfit)} note="per round" />
              <Figure label="Truthful about LOW" value={pct(sum.truthfulAboutLow)} note="where the game happens" />
              <Figure label="Truthful about HIGH" value={pct(sum.truthfulAboutHigh)} note="near 1 by construction" />
              <Figure label="Avg order after HIGH" value={two(sum.orderAfterHigh)} />
              <Figure label="Avg order after LOW" value={two(sum.orderAfterLow)} />
            </div>

            <p data-testid="benchmark-line" style={{ marginTop: '1rem', fontSize: '0.9rem', lineHeight: 1.6 }}>
              <strong>Against the benchmarks.</strong> Babbling (the message ignored) pays
              retailer {two(bench.babbling.retailer)} / supplier {two(bench.babbling.supplier)};
              credible communication pays {two(bench.credible.retailer)} / {two(bench.credible.supplier)}.
              This {scopeLabel} captured{' '}
              <strong>{bench.share.retailer === null ? '—' : `${Math.round(bench.share.retailer * 100)}%`}</strong>{' '}
              of the available gain for retailers and{' '}
              <strong>{bench.share.supplier === null ? '—' : `${Math.round(bench.share.supplier * 100)}%`}</strong>{' '}
              for suppliers.
              <span style={{ color: '#94a3b8' }}> Both benchmarks are computed from the
              current settings, so editing the demand triple moves them.</span>
            </p>
          </Modal>
        )}

        {active === 'trustworthiness' && (
          <Modal title="Trustworthiness by round" wide onClose={() => setActive(null)}>
            <ScopePicker />
            <TrustworthinessChart data={tw} scope={scopeLabel} />
          </Modal>
        )}

        {active === 'trust' && (
          <Modal title="Trust by round" wide onClose={() => setActive(null)}>
            <ScopePicker />
            <TrustChart data={tr} scope={scopeLabel} />
          </Modal>
        )}

        {active === 'reciprocity' && (
          <Modal title="Reciprocity — honesty against belief" onClose={() => setActive(null)}>
            <ReciprocityScatter points={pairs} />
            <div style={{ overflowX: 'auto', border: '1px solid #ddd', borderRadius: 6, marginTop: '1rem' }}>
              <table data-testid="reciprocity-table" style={{ borderCollapse: 'collapse', width: '100%' }}>
                <thead><tr>
                  <th style={IS_TH}>Group</th><th style={IS_TH}>Truth about LOW</th>
                  <th style={IS_TH}>Avg order after LOW</th><th style={IS_TH}>LOW rounds</th>
                </tr></thead>
                <tbody>
                  {pairs.map((p) => (
                    <tr key={p.groupId}>
                      <td style={IS_TD}>{p.groupNumber}</td>
                      <td style={IS_TD}>{pct(p.truthAboutLow)}</td>
                      <td style={IS_TD}>{two(p.productionAfterLow)}</td>
                      <td style={IS_TD}>{p.lowRounds}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Modal>
        )}

        {active === 'students' && (
          <Modal title="Per-student" wide onClose={() => setActive(null)}>
            <RosterReport<Row, ColKey>
              rows={rows}
              columns={columns}
              initialSortKey="group"
              testIds={{ root: 'roster-root', table: 'roster-table', row: (r) => `student-row-${r.participantId}` }}
              cellStyles={{ header: IS_TH, cell: IS_TD }}
            />
          </Modal>
        )}

        {active === 'debrief' && (
          <Modal title="Debrief answers" wide onClose={() => setActive(null)}>
            {/* Grouped by role — Retailer and Supplier answers read very differently (Q9). */}
            <FreeTextReportSet
              questions={ALL_QUESTIONS}
              answersByQuestion={answers}
              groupByRole={{ debrief_reflection: true }}
              roleLabels={{ retailer: 'Retailer', supplier: 'Supplier' }}
            />
          </Modal>
        )}
      </main>
    </div>
  )
}
