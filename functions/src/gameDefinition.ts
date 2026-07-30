import type { Outcome, OutcomeSchema, RoleConfig } from '@mygames/game-engine'
import type { GameDefinition, PrepTextQuestion } from '@mygames/game-server'
import { ALL_QUESTIONS, buildQuestions } from './kcQuestions'
import { DEFAULT_ROUND_SETTINGS as D, CONFIG_KEYS, settingsFromConfig } from './round/settings'

// ═══════════════════════════════════════════════════════════════════════════════
// THE GAME DEFINITION — Information Sharing (infoshare).
//
// Everything the shared platform needs to run this game as DATA: identity, roles,
// group composition, scoring, config fields, questions. The generic machinery lives
// once in @mygames/game-server and @mygames/game-ui and is INJECTED with this object.
// Nothing here is logic that another game would also need — if you find yourself
// writing such a thing, it belongs in a shared package, and Elena approves every
// general-versus-specific call.
//
// ── MATCHING ROLES ARE NOT SEAT ROLES ────────────────────────────────────────
// This is the single most confusing thing about a late-assignment stage game, so:
//
//   `roles` / `composition` below are the MATCHING roles. There is exactly ONE,
//   `player`, and matching forms undifferentiated groups of N.
//
//   Retailer and Supplier are SEAT roles. They are assigned inside the round loop
//   (round/machine.ts `assignRoles`), seeded, immediately before round 1, and
//   matching never sees them.
//
// Do NOT scaffold the seat roles into `composition`. Doing so would make matching
// assign them, which breaks the late-assignment knowledge-check gate, makes seat move
// and bot fill role-sensitive, and hard-codes a seat model into the matcher — three
// costs for no benefit.
// ═══════════════════════════════════════════════════════════════════════════════

/** ONE undifferentiated matching role. See the note above before changing this. */
export const infoshareRoleConfig: RoleConfig = {
  roles: [{ key: 'player', label: 'Player', short: 'P' }],
}

/**
 * PLACEHOLDER outcome schema.
 *
 * A stage game's real results live in the round-state document and its history, not in
 * the negotiated-outcome form — but the shared finalize and push path still expects a
 * schema, so this is a minimal one that lets that path run. Scoring ignores it.
 */
export const infoshareOutcomeSchema: OutcomeSchema = [
  { key: 'placeholder_result', type: 'decimal', min: 0, max: 1_000_000, step: 1 },
  { key: 'notes', type: 'text' },
]

export const infoshareScoreSense: Record<string, 'value' | 'cost'> = { player: 'value' }

/**
 * PARTICIPATION-ONLY SCORING, and the default for the stage family.
 *
 * Every present player earns the same flat point regardless of how they played. The
 * single-role z-score pool is therefore DEGENERATE — sample SD 0, so the engine's
 * zero-SD guard normalises every present student to 0. A report that looks
 * "suspiciously uniform" is CORRECT, not broken.
 *
 * A true no-show (never matched, no role) is handled by the shared engine — status
 * `no_show`, raw null, z = −2 — never here. Server-side bots are excluded from scoring
 * entirely, in scoreAndRecord.ts.
 *
 * ⚠ THE `outcome` ARGUMENT IS IGNORED ON PURPOSE. Reading in-game profit into a grade
 * is the thing participation-only scoring exists to prevent. If a game genuinely
 * grades on performance, that is a spec decision Elena makes explicitly — it is not a
 * default to drift into.
 */
export function computeScoreBreakdown(
  roleKey: string,
  _outcome: Outcome | null,
  _configData?: Record<string, unknown>,
): { value_or_cost: number; raw_score: number } {
  return roleKey === 'player' ? { value_or_cost: 1, raw_score: 1 } : { value_or_cost: 0, raw_score: 0 }
}

export function computeRawScore(
  roleKey: string, outcome: Outcome | null, configData?: Record<string, unknown>,
): number {
  return computeScoreBreakdown(roleKey, outcome, configData).raw_score
}

// ═══════════════════════════════════════════════════════════════════════════════

export const infoshareGameDef: GameDefinition = {
  game_id: 'infoshare',
  roles: infoshareRoleConfig,
  scoreSense: infoshareScoreSense,

  /**
   * FIXED group size. `perRoleCap` EQUAL to `composition` is what locks it: omit the
   * cap and the cap becomes `eligible.length`, letting one group silently absorb the
   * remainder and grow beyond N seats — which the round loop then refuses to open.
   * Remainders are bot-filled at formation instead.
   */
  composition: { player: 2 },
  perRoleCap: 2,

  outcomeSchema: infoshareOutcomeSchema,
  computeRawScore,
  computeScoreBreakdown,
  reservations: { player: 0 },

  // Must match the Porkbun CNAME (infoshare → infoshare-mygames-live.web.app).
  corsOrigins: ['https://infoshare.mygames.live'],

  /**
   * ⚠ MUST MATCH the resolver-map entry added by hand in
   * classroom/functions/src/index.ts (Playbook step 11b). `spawn-secret.sh` creates the
   * secret VALUE in all three places; it does NOT create the BINDING, and codegen does
   * not either. A mismatch here is a 403 on every gradebook push, with a deploy that
   * reported success.
   */
  classroom: {
    callbackSecretId: 'infoshare_v1',
    /**
     * The name of the callback secret in THIS GAME's own Firebase project.
     *
     * ⚠ MUST EQUAL `gameSecretName` for this game in `scripts/game-locations.json`, which
     * is what `spawn-secret.sh` writes into Secret Manager and into
     * `functions/.secret.local`. When the two disagree the deploy reports success and
     * every gradebook push 403s in front of a class.
     *
     * ONE field. finalizeInstance, pushResultsToClassroom, syncRoster AND scoreAndRecord
     * all read it, so they cannot disagree with each other — only with the manifest.
     */
    callbackSecretName: 'INFOSHARE_CALLBACK_SECRET',
  },

  /**
   * Instructor Settings fields.
   *
   * ⚠ TWO THINGS THAT BITE:
   *
   * 1. NO DECIMAL KIND EXISTS. `ConfigFieldDef` offers 'string' | 'positiveInt' |
   *    'url'. Probabilities and rates are therefore `kind: 'string'`, parsed in
   *    round/settings.ts. (`OutcomeSchema`'s 'decimal' is a different type for a
   *    different job — it does not apply here.)
   *
   * 2. ADDING A FIELD REQUIRES REDEPLOYING **BOTH** `getGameConfig` AND
   *    `updateGameConfig`. The recognised-field list is baked into the deployed
   *    bundle, so the symptom of forgetting is "No recognised fields to update" on
   *    code that is perfectly correct.
   */
  configFields: [
    { key: 'player_role_name', kind: 'string', default: 'Player' },
    { key: 'player_sheet_url', kind: 'url', default: '/role-info/infoshare.pdf' },
    { key: 'round_seconds', kind: 'positiveInt', default: 120 },

    /**
     * Clock is a PER-INSTANCE setting, not a build-time one: 'on' for a classroom
     * session (stages time out to the injected default table, spec §6.1) and 'off' for
     * online play (a stage closes only when its seat acts). `ConfigFieldDef` has no
     * boolean kind, hence a two-value string.
     */
    { key: 'clock_mode', kind: 'string', default: 'on' },

    /**
     * Where students write when they cannot reach their group in online mode. Not
     * auto-populated: the owning instructor's address lives on the CLASSROOM course
     * document, in a different Firebase project, and is never synced into a game
     * instance. Empty until the instructor fills it in.
     */
    { key: 'instructor_email', kind: 'string', default: '' },

    // ── the game (spec §2, §3, §4) ────────────────────────────────────────────
    //
    // ⚠ THREE PROBABILITY FIELDS, NOT SIX. The instructor edits the HIGH profile; LOW
    // is its exact reverse, derived in round/settings.ts and never editable. Two
    // editable profiles could be made asymmetric, and asymmetry silently breaks the
    // teaching result in §3.2. Three fields makes that unrepresentable.
    //
    // ⚠ LABELLED BY LOTS, NEVER High/Medium/Low — "High" and "Low" are the demand TYPE,
    // and a settings field called "High" beside a type called HIGH will be misread.
    //
    // The sum-to-1 constraint spans all three and so cannot be expressed on any one of
    // them; `validateHighProfile` enforces it server-side in updateGameConfig.
    { key: CONFIG_KEYS.pHigh, kind: 'decimal', default: D.pHigh, min: 0, max: 1, step: 0.01 },
    { key: CONFIG_KEYS.p1, kind: 'decimal', default: D.high[1], min: 0, max: 1, step: 0.01 },
    { key: CONFIG_KEYS.p2, kind: 'decimal', default: D.high[2], min: 0, max: 1, step: 0.01 },
    { key: CONFIG_KEYS.p3, kind: 'decimal', default: D.high[3], min: 0, max: 1, step: 0.01 },

    // Prices (§3). Decimals, not positiveInt: a wholesale price of 2.50 is a perfectly
    // reasonable variation and the defaults being whole numbers is a coincidence.
    { key: CONFIG_KEYS.retailPrice, kind: 'decimal', default: D.retailPrice, min: 0, step: 0.01 },
    { key: CONFIG_KEYS.wholesalePrice, kind: 'decimal', default: D.wholesalePrice, min: 0, step: 0.01 },
    { key: CONFIG_KEYS.unitCost, kind: 'decimal', default: D.unitCost, min: 0, step: 0.01 },

    // Rounds (§4): 10, fixed, shown, drawn per group.
    { key: CONFIG_KEYS.numRounds, kind: 'positiveInt', default: D.numRounds },
    { key: CONFIG_KEYS.botPunishmentRounds, kind: 'positiveInt', default: D.botPunishmentRounds },
  ],

  /** Info-page links. Every `key` here must also appear in `configFields` above. */
  roleInfoLinks: [
    { roleKey: 'player', links: [{ key: 'player_sheet_url', label: 'Game instructions' }] },
  ],

  /**
   * The question bank, REBUILT FROM THIS INSTANCE'S CONFIG on every serve and every grade.
   *
   * ⚠ THIS IS THE LINE THAT KEEPS THE KNOWLEDGE CHECK HONEST. Four of the seven graded
   * questions are about the payoff table and the demand triple, and both are editable in
   * Settings. A bank built once at module load encodes the DEFAULT market: an instructor
   * who changes a price for their section gets a check that marks a student wrong for
   * reading the payoff table in front of them correctly. Nothing throws, nothing logs, and
   * the only trace is one question the whole class fails.
   *
   * `prepDefaultsFor` (game-server ≥ 0.25.0) is what makes the drift unrepresentable
   * rather than merely unlikely — the SAME derivation serves and grades, because it is
   * called per request by all four question functions and by the Settings page.
   *
   * `prepDefaults` stays as the no-config fallback and is what the frontend's Tier 2
   * coverage gate asserts against. `satisfies` rather than a cast: it type-checks the
   * structural mirror against the real `PrepTextQuestion` here, at the one place both
   * types are in scope.
   */
  prepDefaults: ALL_QUESTIONS satisfies PrepTextQuestion[] as PrepTextQuestion[],
  prepDefaultsFor: (cd) =>
    buildQuestions(settingsFromConfig(cd)) satisfies PrepTextQuestion[] as PrepTextQuestion[],

  /** Legacy stub fields. Must be present; content is served via `prepDefaults`. */
  content: {
    infoPDFs: {} as Record<string, { private: string; public?: string }>,
    kcQuestions: [],
    prepQuestions: [],
    scenarioText: {},
  },
}
