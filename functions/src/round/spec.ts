// ═══════════════════════════════════════════════════════════════════════════════
// INFORMATION SHARING, DECLARED (spec §1.1, §2, §4, §5, §6.1).
//
// This file DECLARES the game; @mygames/stage-engine RUNS it. Every payoff, draw,
// default action and legality rule is INJECTED here and invoked by the engine, which
// contains no game theory and must never contain any.
//
//   round open   the engine draws demand_type (HIGH/LOW) AND actual_demand (1/2/3)
//   stage 1      RETAILER sends a message, HIGH or LOW. Sees the true type. The message
//                need not be true — that is the subject of the game.
//   stage 2      SUPPLIER commits production 1/2/3, having seen the MESSAGE only.
//   resolution   payoffs; both draws become public and land in history.
//
// ── WHY BOTH DRAWS HAPPEN AT ROUND OPEN ──────────────────────────────────────
// `actual_demand` is not needed until resolution, and drawing it early means the value
// EXISTS on the server while the Supplier is still deciding. That is deliberate, and it
// is observationally identical: nothing between round open and resolution reads it, and
// the reveal rule withholds it. The reason is determinism — the engine's `ResolveInput`
// carries no rng (extraction spec §3.5.1), so resolution must be a function of state
// alone. Drawing late would mean a resolver that rolls dice, and a class that cannot be
// replayed.
//
// ⚠ THE COST OF THAT CHOICE IS A LEAK SURFACE, AND IT IS PAID FOR BY ASSERTION.
// Because both values exist early, "the engine hides them" is not enough — the
// SUPPLIER'S ACTUAL PAYLOAD must be checked for absence, on the wire, at stage 2:
// `'demand_type' in payload === false` plus a scan of every key, never a null or a blank
// standing in for hidden. Same for any client-readable Firestore document. The precedent
// is Pricing's competitor rule ids reaching the browser through config/main via the SDK
// while every callable payload was clean.
// ═══════════════════════════════════════════════════════════════════════════════

import type { Seat, StageGameSpec, StageContext, RoundRecord } from '@mygames/stage-engine'
import {
  LOTS, profileFor,
  type DemandType, type Lots, type RoundSettings,
} from './settings'
import { resolveRound, validateMessage, validateProduction } from './resolver'

// ── roles (spec §5) ────────────────────────────────────────────────────────────

/**
 * THE DECLARED ROLE UNIVERSE (extraction spec §3.8). Every role key used in
 * `actingRoles` or `visibleTo` must appear here, so a mistyped key is caught at spec
 * validation — before any group exists — rather than silently skipping a stage.
 *
 * Assigned LATE: a group is two interchangeable seats until play begins, and the roles
 * are revealed at game start by a seeded shuffle. That is what lets the knowledge check
 * use the late-assignment gate, and what keeps seat move and bot fill role-blind.
 */
export type GameRole = 'retailer' | 'supplier'
export const GAME_ROLES: GameRole[] = ['retailer', 'supplier']
export const ROLE_LABEL: Record<GameRole, string> = { retailer: 'Retailer', supplier: 'Supplier' }

// ── stages ─────────────────────────────────────────────────────────────────────

export const STAGE_MESSAGE = 'message'
export const STAGE_PRODUCTION = 'production'
export const STAGE_ORDER = [STAGE_MESSAGE, STAGE_PRODUCTION] as const
export type StageId = (typeof STAGE_ORDER)[number]

// ── round fields ───────────────────────────────────────────────────────────────

/** The truth. Visible to the Retailer throughout; to everyone once the round resolves. */
export const FIELD_DEMAND_TYPE = 'demand_type'
/** Actual demand in lots. Visible to NOBODY until resolution — not even the Retailer. */
export const FIELD_ACTUAL_DEMAND = 'actual_demand'

// ── actions ────────────────────────────────────────────────────────────────────

export type SeatAction =
  | { kind: 'message'; message: DemandType }
  | { kind: 'production'; production: Lots }

export interface RoundResult {
  message: DemandType
  production: Lots
  demandType: DemandType
  actualDemand: Lots
  sales: number
  profits: { retailer: number; supplier: number }
  truthful: boolean
}

export type EngineRecord = RoundRecord<SeatAction, RoundResult>
export type GameStageContext = StageContext<SeatAction>


// ── the shapes screens and reports read ────────────────────────────────────────

/** One completed round, flattened. Identical for both seats — history has no secrets. */
export interface StoredRoundRecord {
  round: number
  retailerSeat: number
  supplierSeat: number
  message: DemandType
  production: Lots
  demandType: DemandType
  actualDemand: Lots
  sales: number
  profits: { retailer: number; supplier: number }
  /** message === demandType. The Tier-3 signature series (§10). */
  truthful: boolean
  /** Seats whose submission came from a clock default. Reported, never charted (§10.1). */
  defaulted: { retailer: boolean; supplier: boolean }
}

/**
 * What ONE seat may see right now — the student payload, and the only thing the round
 * callable returns.
 *
 * ⚠ `demandType` and `actualDemand` are OPTIONAL and that is the mechanism. When the
 * reveal rule withholds a draw the KEY IS ABSENT — not null, not undefined-but-present.
 * Consumers must test presence (`'demandType' in view`); `view.demandType == null` and
 * `view.demandType ?? 'unknown'` both quietly turn "hidden" into a rendered value.
 */
export interface SeatView {
  seat: number
  role: GameRole
  status: 'in_progress' | 'finished'
  round: number
  numRounds: number | null
  stage: StageId | null
  owes: StageId | null
  /** The Retailer's message, once stage 1 has closed. */
  currentMessage: DemandType | null
  /** Present ONLY for the Retailer, and only before resolution. */
  demandType?: DemandType
  /** Never present before resolution — hidden from BOTH seats. */
  actualDemand?: Lots
  history: StoredRoundRecord[]
  pendingCount: number
}

// ── reading submissions ────────────────────────────────────────────────────────

type Subs = Readonly<Record<string, Readonly<Record<Seat, SeatAction>>>>

export function seatOfRole(roleBySeat: Readonly<Record<Seat, string>>, role: GameRole): Seat {
  const found = Object.keys(roleBySeat).find((s) => roleBySeat[Number(s)] === role)
  return found === undefined ? -1 : Number(found)
}

export function messageOf(subs: Subs, roleBySeat: Readonly<Record<Seat, string>>): DemandType | null {
  const a = (subs[STAGE_MESSAGE] ?? {})[seatOfRole(roleBySeat, 'retailer')]
  return a && a.kind === 'message' ? a.message : null
}

export function productionOf(subs: Subs, roleBySeat: Readonly<Record<Seat, string>>): Lots | null {
  const a = (subs[STAGE_PRODUCTION] ?? {})[seatOfRole(roleBySeat, 'supplier')]
  return a && a.kind === 'production' ? a.production : null
}

// ── the draw ───────────────────────────────────────────────────────────────────

/**
 * Draw lots from a distribution using the engine's seeded stream.
 *
 * Cumulative over LOTS in order, so the mapping from a uniform draw to a lot count is
 * fixed and reproducible. The final `?? 3` guards float dust only — the cumulative sum
 * can land a hair under 1 — and is never reached for a validated triple.
 */
export function drawLots(rng: () => number, dist: { 1: number; 2: number; 3: number }): Lots {
  const u = rng()
  let acc = 0
  for (const k of LOTS) {
    acc += dist[k]
    if (u < acc) return k
  }
  return 3
}

// ── the spec ───────────────────────────────────────────────────────────────────

export interface SpecOptions {
  settings: RoundSettings
  /** Overrides settings.numRounds when the instance config differs. */
  numRounds?: number
}

export function makeGameSpec({ settings: s, numRounds }: SpecOptions): StageGameSpec<SeatAction, RoundResult> {
  const rounds = numRounds ?? s.numRounds

  return {
    roles: GAME_ROLES,

    stages: [
      {
        // ── stage 1: the message. Free, and that is the point (spec §1.2). ──────
        id: STAGE_MESSAGE,
        actingRoles: ['retailer'],
        validate: (_seat, action) => {
          if (action.kind !== 'message') return 'Only the Retailer sends a message.'
          const check = validateMessage(action.message)
          return check.ok ? null : check.reason
        },
        /**
         * Spec §6.1 — LOCKED. No message → HIGH.
         *
         * The Retailer always prefers production 3 (§3.1), so HIGH is the move a
         * self-interested Retailer has a reason to make in every round. It takes no side
         * and leaks no information the student did not give.
         *
         * ⚠ §10.1: because HIGH is "truthful" roughly half the time BY ACCIDENT, a
         * defaulted round must be EXCLUDED from the Tier-3 proportion-truthful chart —
         * the chart the 9/28 lecture opens on. The default is recorded here; the
         * exclusion is the reports slice's job, and this is the note that says so.
         */
        defaultFor: () => ({ kind: 'message', message: 'HIGH' }),
      },
      {
        // ── stage 2: production. Sees the MESSAGE, not the truth. ───────────────
        id: STAGE_PRODUCTION,
        actingRoles: ['supplier'],
        // `observes` governs SUBMISSIONS: the Supplier may read stage 1's message. It
        // does NOT grant the round fields — that is the `fields` rule below, and the two
        // are deliberately separate mechanisms.
        observes: [STAGE_MESSAGE],
        validate: (_seat, action) => {
          if (action.kind !== 'production') return 'Only the Supplier sets production.'
          const check = validateProduction(action.production, s)
          return check.ok ? null : check.reason
        },
        /** Spec §6.1 — LOCKED. No production → 2. A competent, side-neutral move. */
        defaultFor: () => ({ kind: 'production', production: 2 }),
      },
    ],

    fields: [
      /**
       * The Retailer is the informed side: they see the type from the moment the round
       * opens. Everyone sees it once the round resolves, which is what makes a lie
       * discoverable exactly one round later (spec §1.2) — and therefore what makes
       * reputation possible at all.
       */
      { name: FIELD_DEMAND_TYPE, visibleTo: ['retailer'], revealAt: 'resolution' },
      /**
       * Actual demand is hidden from BOTH seats until resolution. The Retailer knows the
       * TYPE, never the realisation (spec §1.2) — so `visibleTo` is empty, NOT
       * ['retailer'].
       */
      { name: FIELD_ACTUAL_DEMAND, visibleTo: [], revealAt: 'resolution' },
    ],

    // Spec §4: shown, not hidden. The end-game effect is WANTED here — last-round lying
    // is the cleanest callback to the PD backward-induction lecture.
    roundCount: { mode: 'fixed', n: rounds, display: 'shown', drawScope: 'group' },
    endCondition: { kind: 'fixedRounds' },
    groupSize: { n: 2 },

    /**
     * The game HAS a clock; whether it runs is per-instance (spec §6). Classroom sets
     * clock_mode 'on' and stages time out to the defaults above; online sets 'off' and a
     * stage closes only when its seat acts. The engine knows nothing about mode and must
     * not learn — that lives in the game and the platform.
     */
    hasClock: true,

    openRound: (_ctx, rng) => {
      const demandType: DemandType = rng() < s.pHigh ? 'HIGH' : 'LOW'
      const actualDemand = drawLots(rng, profileFor(demandType, s))
      return { [FIELD_DEMAND_TYPE]: demandType, [FIELD_ACTUAL_DEMAND]: actualDemand }
    },

    resolveRound: (input) => {
      // Defaults have already been applied by the engine if a seat went silent, so a
      // missing submission here would be an engine bug rather than an absent student.
      // The fallbacks mirror the default table so a round can still resolve either way.
      const message = messageOf(input.submissions, input.roleBySeat) ?? 'HIGH'
      const production = productionOf(input.submissions, input.roleBySeat) ?? 2
      const demandType = input.roundFields[FIELD_DEMAND_TYPE] as DemandType
      const actualDemand = input.roundFields[FIELD_ACTUAL_DEMAND] as Lots
      // INVOKED, never computed here.
      return resolveRound({ message, production, demandType, actualDemand }, s)
    },
  }
}
