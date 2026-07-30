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
  ONE free-text question, one report. The spec's question set (Q1–Q9) has a single
  free-text item — the Q9 debrief paragraph. The placeholder bank also carried a
  `prep_expectation` warm-up; it was scaffolding, not spec content, and went with the rest
  of the placeholder set. Its report id had to go with it or the gate fails as an orphan,
  which is the gate working: a report outliving its question is exactly what it watches for.
*/
export const TIER2_REPORT_IDS: string[] = [
  'debrief_reflection',
]
