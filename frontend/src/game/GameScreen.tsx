import { useCallback, useEffect, useRef, useState } from 'react'
import {
  RoundResultsScreen, colors, typography, layout, spacing,
} from '@mygames/game-ui'
import type { AdvancePolicy } from '@mygames/game-ui'
import {
  getRoundView, submitMessage, submitProduction, checkRoundClock,
  type RoundViewResult, type DemandType, type Lots,
} from '../api'
import HistoryTable from './HistoryTable'
import ClockBar from './ClockBar'
import InformationPanel from './InformationPanel'
import { colourFor, tintFor, textFor } from '../demandColours'

// ═══════════════════════════════════════════════════════════════════════════════
// THE STUDENT GAME SCREEN — the two decision screens (spec §1.1).
//
// ⚠ THIS COMPONENT DECIDES NOTHING. It polls `getRoundView`, renders what came back,
// and posts intents. It does not compute a payoff to "show the number sooner", does not
// decide whether a stage is over, and does not know the payoff formulas. Every one of
// those, added to a screen, is a rule a student can read in the bundle and a second
// implementation that will disagree with the server on some edge case.
//
// ── WHY POLLING, AND NOT A FIRESTORE LISTENER ────────────────────────────────
// The round-state document is DENIED to clients (see firestore.rules), because it holds
// the fields the reveal rule is hiding. A listener would need read access to the very
// document whose contents must not reach this browser. Polling a callable that applies
// the reveal is the point, not a limitation.
//
// ── THE TWO ADVANCE BRANCHES ─────────────────────────────────────────────────
// Classroom shows the round result on a timer and advances when the timer expires OR
// when every seat clicks Continue, whichever is first — a mandatory click creates one
// stall point per round, which is the exact failure the clock exists to prevent.
// Online has no clock, so it advances on Continue only, with all seats clicking: online
// groups self-schedule, nobody is watching, and auto-advancing past someone who is
// still reading is worse than waiting. Same screen, one branch — `AdvancePolicy`.
// ═══════════════════════════════════════════════════════════════════════════════

const POLL_MS = 1500

export default function GameScreen({
  participantId, gameInstanceId, groupId,
}: { participantId: string; gameInstanceId: string; groupId: string }) {
  const [data, setData] = useState<RoundViewResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /** The round whose result screen is showing, or null when playing. */
  const [showingResultFor, setShowingResultFor] = useState<number | null>(null)
  const [youContinued, setYouContinued] = useState(false)
  const lastSeenRound = useRef<number | null>(null)

  const refresh = useCallback(async () => {
    try {
      const r = await getRoundView(groupId)
      setData(r)
      setError(null)
      // A round resolved since the last poll → show its result.
      const completed = r.view.history.length
      if (lastSeenRound.current !== null && completed > lastSeenRound.current) {
        setShowingResultFor(completed)
        setYouContinued(false)
      }
      lastSeenRound.current = completed
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [groupId])

  useEffect(() => {
    void refresh()
    const t = setInterval(() => { void refresh() }, POLL_MS)
    return () => clearInterval(t)
  }, [refresh])

  /**
   * The clock is nudged from the CLIENT but resolved on the SERVER. This call is a
   * prompt, not an authority: it is a no-op before the deadline, and every seat sends
   * it, so a student who closed their laptop cannot freeze the group.
   */
  useEffect(() => {
    if (!data?.clock_enabled) return
    const t = setInterval(() => { void checkRoundClock(groupId).catch(() => {}) }, POLL_MS)
    return () => clearInterval(t)
  }, [data?.clock_enabled, groupId])

  /**
   * THE ROBOT'S READ PATH — exposed on EVERY branch, before any early return.
   *
   * ⚠ It used to be a child component rendered only in the decision branch, which meant
   * `window.__gameState` went stale the moment the round-results screen appeared. A
   * two-robot game then stalled after round 1: the driver was still reading a view whose
   * `owes` was already satisfied, and nothing dismissed the results screen. Keeping this
   * a top-level effect means the driver always sees the current view, whatever is on
   * screen — and a hook cannot live after a conditional return.
   */
  useEffect(() => {
    if (!data) return
    ;(window as unknown as Record<string, unknown>)['__gameState'] = {
      view: data.view, participantId, gameInstanceId, groupId,
    }
  }, [data, participantId, gameInstanceId, groupId])

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      await refresh()
    } catch (e) {
      // The server's reason, verbatim. Do not rewrite it here — the message a student
      // reads must be the one the rule actually produced.
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (error && !data) return <Shell><p role="alert">{error}</p></Shell>
  if (!data) return <Shell><p>Loading…</p></Shell>

  const v = data.view

  /*
    ⚠ PRESENCE DECIDES, the narrowing is only for the type checker.
    `'demandType' in v` is still the gate — never `v.demandType != null` and never
    `v.demandType ?? 'unknown'`. When the reveal rule withholds the draw the KEY IS
    ABSENT, and a nullish test written the easy way turns "hidden" into a rendered value
    the moment someone changes the server to send null. This binding exists because
    TypeScript does not narrow an optional property through `in` at the use site, not
    because absence and undefined are being treated as the same thing.
  */
  const trueType = 'demandType' in v ? v.demandType : undefined

  // ── the round result screen ──────────────────────────────────────────────────
  if (showingResultFor !== null && v.history.length >= showingResultFor) {
    const row = v.history[showingResultFor - 1]
    const policy: AdvancePolicy = data.clock_enabled
      ? { kind: 'classroom', deadlineMs: data.stage_deadline_ms }
      : { kind: 'online' }
    /*
      ⚠ seatsTotal 1, NOT 2 — and that is not a bug being papered over.
      The result screen is a LOCAL view of an ALREADY-RESOLVED round. Nothing about the
      group waits on it: the next stage opens when both seats SUBMIT, which they cannot do
      until they dismiss this screen anyway. There is no server-side record of who has
      pressed Continue, so passing seatsTotal 2 would render a permanent "Waiting on 2 of
      2" that no event can ever clear — a caption describing a synchronisation that does
      not exist. Per-seat is what the code does, so per-seat is what it says.

      Both branches survive this: classroom still auto-advances when the deadline passes
      (the timer arm is independent of the count), and online still advances on Continue
      and nothing else.
    */
    return (
      <Shell>
        <RoundResultsScreen
          title={`Round ${row.round} result`}
          policy={policy}
          seatsTotal={1}
          seatsContinued={youContinued ? 1 : 0}
          youContinued={youContinued}
          onContinue={() => setYouContinued(true)}
          onAdvance={() => { setYouContinued(false); setShowingResultFor(null) }}
          history={<HistoryTable history={v.history} viewerRole={v.role} />}
        >
          <p data-testid="result-line">
            The Retailer reported <strong>{row.message}</strong>; the true type was{' '}
            <strong>{row.demandType}</strong> and demand was <strong>{row.actualDemand}</strong>.{' '}
            The Supplier produced <strong>{row.production}</strong>; <strong>{row.sales}</strong> sold.
          </p>
          <p data-testid="result-profits">
            The Retailer earned <strong>{row.profits.retailer}</strong>; the Supplier earned{' '}
            <strong>{row.profits.supplier}</strong>.
          </p>
        </RoundResultsScreen>
      </Shell>
    )
  }

  if (v.status === 'finished') {
    return (
      <Shell>
        <h1 style={{ marginTop: 0 }}>Game over</h1>
        <p data-testid="game-over">All rounds are complete. Your instructor will take it from here.</p>
        <HistoryTable history={v.history} viewerRole={v.role} />
      </Shell>
    )
  }

  return (
    <Shell>
      <header style={{ marginBottom: spacing.gapMd }}>
        <h1 style={{ margin: 0 }} data-testid="round-heading">
          Round {v.round}{v.numRounds !== null ? ` of ${v.numRounds}` : ''}
        </h1>
        <p style={{ margin: 0, color: colors.textSecondary }} data-testid="role-line">
          You are <strong>{v.role === 'retailer' ? 'Retailer' : 'Supplier'}</strong>.
        </p>
      </header>

      {data.clock_enabled && (
        <ClockBar
          deadlineMs={data.stage_deadline_ms}
          stageKey={`${v.round}:${v.stage ?? ''}`}
          nudge={v.owes !== null}
        />
      )}

      {/*
        ═══════════════════════════════════════════════════════════════════════
        DECISION SCREEN 1 — THE RETAILER (stage `message`).
        ═══════════════════════════════════════════════════════════════════════

        ⚠ PRESENCE, NOT NULLISHNESS. `'demandType' in v` — never `v.demandType != null`
        and never `v.demandType ?? 'unknown'`. When the reveal rule withholds the draw the
        KEY IS ABSENT, and a nullish test written the easy way turns "hidden" into a
        rendered value the moment someone changes the server to send null.

        The true type is the LOUDEST thing on this screen, deliberately. The Retailer's
        whole decision is what to do with a fact only they hold; burying it in a sentence
        makes the game about reading carefully instead of about choosing.
      */}
      {trueType !== undefined && (
        <section
          data-testid="private-state"
          style={{
            margin: `${spacing.gapMd} 0`, padding: spacing.gapMd, borderRadius: 8,
            border: `2px solid ${colourFor(trueType)}`,
            background: tintFor(trueType),
          }}
        >
          <p style={{ margin: 0, fontSize: typography.sizeSm, color: colors.textSecondary,
                      textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Only you can see this
          </p>
          <p style={{ margin: '0.15rem 0 0', fontSize: '2rem', fontWeight: 800, lineHeight: 1.1,
                      color: textFor(trueType) }}>
            Demand is {trueType}
          </p>
          <p style={{ margin: '0.3rem 0 0', fontSize: typography.sizeSm, color: colors.textSecondary }}>
            This is the true demand type for round {v.round}. The Supplier has not been told it.
          </p>
        </section>
      )}

      {v.owes === 'message' && (
        <>
          {/*
            ⚠ ELENA'S WORDING, VERBATIM. Two sentences, and the first one carries the
            whole design: a student who believes the report is SUPPOSED to be true is not
            running the same experiment as one who does not, and the class data becomes a
            mixture of two populations. Never add "please report honestly", "your report
            should reflect…", or anything else implying an obligation.

            Equally: do not ADD to it. An earlier version explained at length that nothing
            checks the report and that the Supplier sees only the message — both obvious
            from the screen in front of them, and both covered by the instruction sheet
            and the knowledge check. Students do not read paragraphs on a decision screen.
          */}
          <Choices
            label={`Report a demand type to the Supplier.`}
            help={
              <>
                Your report does not have to be true. The Supplier will learn the true
                type after the round is over.
              </>
            }
            testId="message-choices"
            options={[
              { value: 'HIGH', label: 'Report HIGH', tint: colourFor('HIGH') },
              { value: 'LOW', label: 'Report LOW', tint: colourFor('LOW') },
            ]}
            disabled={busy}
            onPick={(val) => act(() => submitMessage(groupId, val as DemandType))}
          />
        </>
      )}

      {/*
        ═══════════════════════════════════════════════════════════════════════
        DECISION SCREEN 2 — THE SUPPLIER (stage `production`).
        ═══════════════════════════════════════════════════════════════════════

        ⚠ THIS BRANCH RENDERS NOTHING ABOUT THE TRUE TYPE — not the value, not a
        placeholder, not a greyed-out box saying "hidden". `v.demandType` is ABSENT from
        the payload here, and the block above is the only thing that reads it. An
        "unknown" chip would be worse than nothing: it advertises that the field exists
        and invites a student to open the network tab looking for it.
      */}
      {v.owes === 'production' && (
        <>
          <section
            data-testid="message-received"
            style={{ margin: `${spacing.gapMd} 0`, padding: spacing.gapMd, borderRadius: 8,
                     border: `2px solid ${colors.borderMid}`, background: colors.white }}
          >
            <p style={{ margin: 0, fontSize: typography.sizeSm, color: colors.textSecondary,
                        textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              The Retailer reported
            </p>
            <p data-testid="reported-type"
               style={{ margin: '0.15rem 0 0', fontSize: '2rem', fontWeight: 800, lineHeight: 1.1,
                        color: v.currentMessage === 'LOW' ? textFor('LOW') : textFor('HIGH') }}>
              {v.currentMessage ?? '—'}
            </p>
            {/* Elena's wording, verbatim. Do not expand it. */}
            <p style={{ margin: '0.3rem 0 0', fontSize: typography.sizeSm, color: colors.textSecondary }}>
              This is what the Retailer chose to tell you. It may or may not be the true
              demand type. After your production decision you will learn the true demand
              type.
            </p>
          </section>
          <Choices
            label="Choose your production, in lots."
            help={
              <>
                Every lot costs you to make whether or not it sells. You keep the revenue
                on lots that sell. Open <em>Show the numbers</em> for the full table.
              </>
            }
            testId="production-choices"
            options={[1, 2, 3].map((n) => ({ value: String(n), label: `Produce ${n}` }))}
            disabled={busy}
            onPick={(val) => act(() => submitProduction(groupId, Number(val) as Lots))}
          />
        </>
      )}

      {v.owes === null && (
        <p data-testid="waiting" style={{ color: colors.textSecondary }}>
          Waiting for the other player… ({v.pendingCount} still to decide)
        </p>
      )}

      {/*
        THE INFORMATION PANEL (spec §1.4) — shown whenever a decision is owed, which is
        both stages and therefore both roles. Keyed on `owes`, NOT on role: keying it on
        role is how one of the two screens quietly loses it.
      */}
      {v.owes !== null && <InformationPanel round={v.round} />}

      {error && <p role="alert" data-testid="action-error" style={{ color: '#b91c1c' }}>{error}</p>}

      <div style={{ marginTop: spacing.gapLg }}>
        <HistoryTable history={v.history} viewerRole={v.role} />
      </div>
    </Shell>
  )
}

/**
 * SEGMENTED BUTTONS, NOT A DROPDOWN OR A NUMBER INPUT.
 *
 * Every option is visible at once, it works on a phone, and it removes an entire
 * validation path — a free number input accepts 7, which then has to be rejected by the
 * server and explained to the student. Do not "improve" this into a text field.
 */
function Choices({
  label, help, options, onPick, disabled, testId,
}: {
  label: string
  help?: React.ReactNode
  options: { value: string; label: string; tint?: string }[]
  onPick: (value: string) => void
  disabled: boolean
  testId: string
}) {
  return (
    <div data-testid={testId} style={{ margin: `${spacing.gapMd} 0` }}>
      <p style={{ margin: `0 0 0.2rem`, fontWeight: 700 }}>{label}</p>
      {help && (
        <p style={{ margin: `0 0 ${spacing.gapSm}`, fontSize: typography.sizeSm,
                    color: colors.textSecondary, maxWidth: '42rem' }}>{help}</p>
      )}
      <div style={{ display: 'flex', gap: spacing.gapSm, flexWrap: 'wrap' }}>
        {options.map((o) => (
          <button
            key={o.value}
            data-testid={`${testId}-${o.value}`}
            disabled={disabled}
            onClick={() => onPick(o.value)}
            style={{
              padding: '0.65rem 1.4rem', fontSize: '1rem', fontWeight: 700,
              cursor: disabled ? 'wait' : 'pointer', borderRadius: 6,
              border: `2px solid ${o.tint ?? colors.borderMid}`,
              background: colors.white, color: o.tint ?? colors.text,
              opacity: disabled ? 0.6 : 1,
            }}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main style={{
      padding: layout.pagePad, maxWidth: layout.contentWidth,
      margin: '0 auto', fontFamily: typography.fontFamily,
    }}>
      {children}
    </main>
  )
}
