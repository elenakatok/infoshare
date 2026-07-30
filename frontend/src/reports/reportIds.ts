// ═══════════════════════════════════════════════════════════════════════════════
// THE TIER 2 REPORT REGISTRY — one entry per free-text question.
//
// This list is the OTHER half of the spawn gate. `tier2Gate.test.ts` compares it
// against the question bank and fails by name if a free-text question has no report
// here, or if an id here matches no question (a typo, or a report left behind after
// its question was deleted).
//
// ⚠ DO NOT "FIX" A FAILING GATE BY ADDING AN ID HERE WITHOUT A REPORT. The id is a
// claim that the report exists and renders; adding it to silence the test converts a
// red build into a silently missing report, which is exactly the failure the gate was
// written to catch. Render the report in Reports.tsx, then add the id.
// ═══════════════════════════════════════════════════════════════════════════════

/*
  TWO free-text questions, two reports — and they are a matched pair, not a question plus a
  leftover.

  ⚠ `prep_expectation` READS LIKE SCAFFOLDING AND IS NOT. It was deleted once on exactly
  that reading. It is the BEFORE half: what a student expects the Retailer's signal to be
  worth, answered before they have played a round. `debrief_reflection` is the AFTER half.
  The 9/28 lecture opens on the contrast between them, so a report for one without the
  other delivers half a lecture — and does it silently, because each report renders
  perfectly on its own.
*/
export const TIER2_REPORT_IDS: string[] = [
  'prep_expectation',
  'debrief_reflection',
]
