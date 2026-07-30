import type { RoleConfig, OutcomeSchema } from '@mygames/game-engine'

// ═══════════════════════════════════════════════════════════════════════════════
// The frontend's mirror of the MATCHING role config.
//
// ⚠ ONE undifferentiated matching role. The SEAT roles (Retailer / Supplier) are assigned
// late, inside the round loop, and never appear here: the shared roster and matching
// UI would otherwise offer to assign them, which is precisely what late assignment
// exists to avoid.
//
// This mirrors functions/src/gameDefinition.ts. It is a mirror because the frontend
// cannot import from functions/ — keep the two in step, and prefer adding anything
// substantial to the QUESTION BANK pattern (functions/src/kcQuestions.ts) instead,
// which is import-free precisely so both layers can read the same file.
// ═══════════════════════════════════════════════════════════════════════════════

export const infoshareRoleConfig: RoleConfig = {
  roles: [{ key: 'player', label: 'Player', short: 'P' }],
}

/** The single matching role key. Every student holds it, start to finish. */
export const MATCHING_ROLE = 'player'

/**
 * The SEAT roles, labelled — the roles students actually play.
 *
 * ⚠ NOT INTERCHANGEABLE WITH `infoshareRoleConfig`. These are display vocabulary only:
 * they are assigned inside the round loop, they never reach the participant document, and
 * putting them where a matching role is expected breaks Match Now (it waits for a Retailer
 * to be present, and nobody ever is before matching).
 *
 * One copy, because there were about to be three — the dashboard roster, the debrief report
 * and the round engine each need to turn 'retailer' into 'Retailer'. This is the frontend's;
 * functions/src/round/spec.ts holds the server's (`ROLE_LABEL`), and the two are mirrors for
 * the same reason the role config above is: the frontend cannot import from functions/
 * without pulling in `@mygames/stage-engine`, which is server-only.
 */
export const SEAT_ROLE_LABELS: Record<string, string> = {
  retailer: 'Retailer',
  supplier: 'Supplier',
}

/**
 * The roster's display vocabulary: both seat roles plus a label for the state before they
 * are dealt. Fed to the shared dashboard's `displayRoles`.
 *
 * ⚠ IT LIVES HERE, NOT ON THE DASHBOARD PAGE, SO IT CAN BE TESTED. The page imports
 * `../firebase`, which calls `getDatabase()` at module load and throws without a configured
 * databaseURL — so anything exported from the page is unreachable from a unit test, and the
 * mapping between the server's role keys and these labels is exactly the thing worth
 * asserting. See roleVocabulary.test.ts.
 */
export const displayRoleLabels: Record<string, string> = {
  ...SEAT_ROLE_LABELS,
  // Pre-assignment, and the label the matching role falls back to. A state, not a key:
  // "player" on a projected screen reads as a leak of something internal, and "Player"
  // — what the Show: filter used to say — is not a thing anyone plays in this game.
  [MATCHING_ROLE]: 'Unassigned',
}

/** Placeholder outcome schema — the real results live in the round history. */
export const infoshareOutcomeSchema: OutcomeSchema = [
  { key: 'placeholder_result', type: 'decimal', min: 0, max: 1_000_000, step: 1 },
  { key: 'notes', type: 'text' },
]

export type { OutcomeSchema }
