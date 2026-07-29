// ═══════════════════════════════════════════════════════════════════════════════
// THE DEMAND-TYPE COLOURS — ONE DEFINITION, FOR SCREENS AND REPORTS ALIKE.
//
// ⚠ BLUE IS HIGH, RED IS LOW, EVERYWHERE, AND IT MATCHES THE PRINTED SHEET.
// Students are handed an instruction sheet before they play and then look at a screen
// during it. If the histogram on the paper is blue and the histogram on the screen is
// orange, the two are different pictures of the same thing and the student has to learn
// the key twice — on a projector, from the back of a room, they will not.
//
// ⚠ THIS FILE EXISTS BECAUSE THE CONSTANTS WERE DUPLICATED. They were defined once in
// reports/Charts.tsx and AGAIN in game/InformationPanel.tsx, with four more hex literals
// inlined in GameScreen.tsx. A colour change was therefore a three-file change with one
// place easy to miss — which is exactly the failure mode a shared constant is supposed to
// prevent. Import from here. Do not re-declare a demand colour anywhere else.
// ═══════════════════════════════════════════════════════════════════════════════

/** HIGH demand. Matches the blue on the printed instruction sheet. */
export const HIGH_COLOUR = '#2E5FA3'

/** LOW demand. Matches the red on the printed instruction sheet. */
export const LOW_COLOUR = '#C0392B'

/** Anything that is neither HIGH nor LOW — the reciprocity scatter's pair dots. */
export const NEUTRAL_COLOUR = '#475569'

/**
 * Card backgrounds and heading text for the two decision screens.
 *
 * Darker than the base colour so large bold text stays legible on the tint rather than
 * vibrating against it — the base blue and red are chosen for 6px chart marks on white,
 * which is a different job from 2rem type on a coloured panel.
 */
export const HIGH_TINT = '#EAF1FA'
export const LOW_TINT = '#FDECEA'
export const HIGH_TEXT = '#1F4278'
export const LOW_TEXT = '#8C271C'

/** Pick the pair for a demand type, so callers stop writing the ternary by hand. */
export const colourFor = (t: 'HIGH' | 'LOW') => (t === 'HIGH' ? HIGH_COLOUR : LOW_COLOUR)
export const tintFor = (t: 'HIGH' | 'LOW') => (t === 'HIGH' ? HIGH_TINT : LOW_TINT)
export const textFor = (t: 'HIGH' | 'LOW') => (t === 'HIGH' ? HIGH_TEXT : LOW_TEXT)
