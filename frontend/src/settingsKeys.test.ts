import { describe, it, expect } from 'vitest'
import { configSections } from './configSections'
import { CONFIG_KEYS } from '../../functions/src/round/settings'
import { infoshareGameDef } from '../../functions/src/gameDefinition'

// ═══════════════════════════════════════════════════════════════════════════════
// THE BIDIRECTIONAL SETTINGS CHECK — the thing that makes this class of bug impossible.
//
// ⚠ THE FAILURE THIS EXISTS FOR WAS SILENT AND LOOKED FINE. The Settings page carried
// the PLACEHOLDER game's keys (pUp, highCapacity, lowCapacity, retailerRate,
// supplierRate, unitCost) while the game read p_high, p_lots_1..3, retail_price,
// wholesale_price, unit_cost. Every payoff and probability control on the page wrote a
// key nothing ever read: the fields looked editable, accepted input, saved without
// error, and changed NOTHING. Six dead keys; eight real ones with no field at all.
//
// Nothing could catch it. TypeScript sees two unrelated string literals. The e2e sets
// config through the callable, never the page. Only comparing the two lists finds it —
// so the two lists are compared here, and this runs in the frontend suite so it fails at
// BUILD, not in a class.
//
// ⚠ BOTH DIRECTIONS, AND THEY FAIL DIFFERENTLY:
//   a field writing a key nothing reads  → a control that silently does nothing
//   a key with no field                  → a setting the instructor cannot reach
// One direction alone would have passed throughout the entire period the bug was live.
// ═══════════════════════════════════════════════════════════════════════════════

/** Keys the SETTINGS PAGE offers. */
const uiKeys = new Set(
  configSections.flatMap((s) => s.fields.map((f) => f.key as string)),
)

/** Keys the ROUND ENGINE reads out of stored config. */
const gameKeys = new Set(Object.values(CONFIG_KEYS) as string[])

/** Keys the SERVER will accept on updateGameConfig — the third list, and it matters. */
const serverKeys = new Set((infoshareGameDef.configFields ?? []).map((f) => f.key))

/*
  Settings fields that are deliberately NOT round-engine settings. Each is read by
  something other than round/settings.ts, and each is named here rather than excluded by
  a pattern — a pattern would silently absorb the next real orphan.
*/
const NOT_ROUND_SETTINGS = new Set([
  'round_seconds',      // the clock, read by infoshareRound.ts
  'clock_mode',         // session mode, read by the online flow
  'instructor_email',   // the "cannot reach my group" contact
  'player_role_name',   // display only
  'player_sheet_url',   // the info-page link
])

describe('settings keys are bidirectionally consistent', () => {
  it('every Settings field writes a key something actually reads', () => {
    const orphans = [...uiKeys].filter(
      (k) => !gameKeys.has(k) && !NOT_ROUND_SETTINGS.has(k),
    )
    expect(orphans, `Settings fields whose key NOTHING reads: ${orphans.join(', ')}`).toEqual([])
  })

  it('every key the game reads has a Settings field', () => {
    const missing = [...gameKeys].filter((k) => !uiKeys.has(k))
    expect(missing, `game settings with NO Settings field: ${missing.join(', ')}`).toEqual([])
  })

  /*
    ⚠ THE THIRD LIST. A field can name a key the game reads and still do nothing, because
    updateGameConfig only writes keys in the game definition's configFields — the symptom
    is "No recognised fields to update" on code that is otherwise correct. This was
    genuinely missing for bot_punishment_rounds.
  */
  it('every Settings field is a key the server will accept', () => {
    const unrecognised = [...uiKeys].filter((k) => !serverKeys.has(k))
    expect(unrecognised, `Settings fields updateGameConfig would REJECT: ${unrecognised.join(', ')}`).toEqual([])
  })

  it('the check is not vacuous — there are keys on both sides', () => {
    expect(uiKeys.size).toBeGreaterThan(5)
    expect(gameKeys.size).toBeGreaterThan(5)
  })
})
