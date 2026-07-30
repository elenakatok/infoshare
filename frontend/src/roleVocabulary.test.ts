import { describe, it, expect } from 'vitest'
import { infoshareRoleConfig, MATCHING_ROLE, SEAT_ROLE_LABELS, displayRoleLabels } from './gameConfig'
import type { Role } from './api'

// ═══════════════════════════════════════════════════════════════════════════════
// THE TWO ROLE VOCABULARIES, AND THE WIRING BETWEEN THEM.
//
// ⚠ THE BUG THIS PINS WAS INVISIBLE AND LASTED THE WHOLE BUILD. The roster's Role column
// and its Show: filter both read the MATCHING role, which in this game is `player` for
// every student from enrolment to gradebook. So a projected dashboard said "player" twenty
// times while the class was visibly playing Retailer and Supplier, and nothing anywhere
// was wrong enough to fail.
//
// The fix has two halves that can drift apart silently:
//   • the SERVER sends seat roles as the keys 'retailer' / 'supplier'
//     (functions/src/round/spec.ts GAME_ROLES);
//   • the DASHBOARD looks those keys up in a label map.
// A typo on either side is a Role column that falls back to printing the raw key — which
// is precisely the state this slice set out to fix, arrived at by a different route. So the
// keys are checked against the frontend's own `Role` union, at compile time and at run time.
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Compile-time half: every member of the `Role` union must be a key of SEAT_ROLE_LABELS.
 * Adding a third seat role without labelling it fails `tsc -b`, not just this test.
 */
const EXHAUSTIVE: Record<Role, string> = {
  retailer: SEAT_ROLE_LABELS.retailer,
  supplier: SEAT_ROLE_LABELS.supplier,
}

describe('seat-role labels', () => {
  it('label every seat role the server can send, and nothing else', () => {
    expect(Object.keys(SEAT_ROLE_LABELS).sort()).toEqual(['retailer', 'supplier'])
    for (const [key, label] of Object.entries(SEAT_ROLE_LABELS)) {
      expect(label, key).toBeTruthy()
      // A label that is just the key capitalised differently is still a label; a label that
      // IS the key means the lookup is doing nothing.
      expect(label).not.toBe(key)
    }
  })

  it('are the same map the debrief report uses — one vocabulary, not three', () => {
    expect(EXHAUSTIVE).toEqual(SEAT_ROLE_LABELS)
  })
})

describe('the dashboard display map', () => {
  it('covers both seat roles AND the pre-assignment matching role', () => {
    // All three, because the roster renders rows in all three states: before matching,
    // after matching but before round 1 opens, and once seats are dealt.
    expect(Object.keys(displayRoleLabels).sort()).toEqual(['player', 'retailer', 'supplier'])
    expect(displayRoleLabels.retailer).toBe('Retailer')
    expect(displayRoleLabels.supplier).toBe('Supplier')
  })

  it('labels the matching role as a STATE, never as "Player" or the raw key', () => {
    // "Player" is what the Show: filter used to say, and it is not a thing anyone plays
    // in this game. "player" is worse — an internal key on a projected screen.
    expect(displayRoleLabels[MATCHING_ROLE]).toBe('Unassigned')
    expect(Object.values(displayRoleLabels)).not.toContain('Player')
    expect(Object.values(displayRoleLabels)).not.toContain('player')
  })

  it('does NOT put the seat roles where matching would see them', () => {
    // The trap: seat roles in the matching role config gate Match Now on a Retailer being
    // present, and nobody holds a role that is assigned after matching. Match Now would
    // simply never enable, with nothing on screen to explain it.
    const matchingKeys = infoshareRoleConfig.roles.map((r) => r.key)
    expect(matchingKeys).toEqual([MATCHING_ROLE])
    for (const seatRole of Object.keys(SEAT_ROLE_LABELS)) {
      expect(matchingKeys).not.toContain(seatRole)
    }
  })
})
