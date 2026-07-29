// ═══════════════════════════════════════════════════════════════════════════════
// DEMO SEED — a realistic class, for looking at the reports.
//
// ⚠ VARIED BEHAVIOUR IS THE POINT. A dataset where every pair behaves identically tells
// you nothing about whether a chart READS well — every line is flat and the scatter is
// one dot in six places. These six pairs are deliberately different from each other, and
// two of them change over the ten rounds:
//
//   1  HONEST         tells the truth about LOW throughout. Supplier believes throughout.
//   2  HONEST-ISH     mostly honest, two lapses. Supplier stays trusting.
//   3  LIAR           always reports HIGH. Supplier learns and stops listening.
//   4  LIAR→RECOVERS  lies early, is punished, then tells the truth and is believed again.
//                     THE interesting line: both charts should show the turn.
//   5  ERRATIC        no pattern. Supplier hedges at 2 throughout.
//   6  HONEST + SLOW-TRUSTING  honest from round 1; supplier only comes to believe late.
//
// Plus a handful of clock defaults, so the "excluded" counts are non-zero and can be
// seen to be excluded.
//
// Writes round documents DIRECTLY — this is a fixture for looking at charts, not a test
// of the round loop (the harnesses do that). It bypasses play on purpose: driving 60
// rounds through callables to look at a picture is slow and proves nothing extra.
//
//   node infoshare-seed-demo.mjs        (emulator must be running)
// ═══════════════════════════════════════════════════════════════════════════════

const PROJECT = 'infoshare-mygames-live'
const FS = `http://localhost:8082/v1/projects/${PROJECT}/databases/(default)/documents`
const IID = process.env.DEMO_INSTANCE || 'demo'
const ROUNDS = 10

const S = { retailPrice: 3, wholesalePrice: 2, unitCost: 1 }
const HIGH = { 1: 0.02, 2: 0.33, 3: 0.65 }
const LOW = { 1: 0.65, 2: 0.33, 3: 0.02 }

// Deterministic so the screenshots are reproducible.
let seed = 20260729
const rnd = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff
  return seed / 0x7fffffff
}
const drawLots = (d) => {
  const u = rnd()
  let acc = 0
  for (const k of [1, 2, 3]) { acc += d[k]; if (u < acc) return k }
  return 3
}

/** Per-pair behaviour. `report` decides the message; `order` decides production. */
const PAIRS = [
  {
    name: 'honest',
    report: (type) => type,
    order: (msg) => (msg === 'HIGH' ? 3 : 1),
  },
  {
    name: 'honest-ish',
    report: (type, r) => (type === 'LOW' && (r === 4 || r === 7) ? 'HIGH' : type),
    order: (msg) => (msg === 'HIGH' ? 3 : 1),
  },
  {
    name: 'liar',
    report: () => 'HIGH',
    // Believes for three rounds, then stops and hedges — the message stopped meaning anything.
    order: (msg, r) => (r <= 3 ? (msg === 'HIGH' ? 3 : 1) : 2),
  },
  {
    name: 'liar-recovers',
    // Lies through round 4, then tells the truth for the rest.
    report: (type, r) => (r <= 4 ? 'HIGH' : type),
    // Punishes from 4 (hedge at 2), starts believing again from 7 once reports hold up.
    order: (msg, r) => (r <= 3 ? (msg === 'HIGH' ? 3 : 1) : r <= 6 ? 2 : (msg === 'HIGH' ? 3 : 1)),
  },
  {
    name: 'erratic',
    report: (type, r) => (r % 3 === 0 ? (type === 'HIGH' ? 'LOW' : 'HIGH') : type),
    order: () => 2,
  },
  {
    name: 'slow-trust',
    report: (type) => type,
    // Hedges early, comes to believe from round 5.
    order: (msg, r) => (r <= 4 ? 2 : (msg === 'HIGH' ? 3 : 1)),
  },
]

/** Rounds where a seat went silent, so the excluded-defaults count is visible. */
const DEFAULTS = { 2: [9], 5: [3, 8] }   // pair index → rounds

const enc = (v) => {
  if (v === null) return { nullValue: null }
  if (typeof v === 'boolean') return { booleanValue: v }
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }
  if (typeof v === 'string') return { stringValue: v }
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } }
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } }
}

async function put(path, obj) {
  const res = await fetch(`${FS}/${path}`, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, enc(v)])) }),
  })
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`)
}

async function main() {
  console.log(`Seeding demo data into instance "${IID}" …`)

  for (let p = 0; p < PAIRS.length; p++) {
    const pair = PAIRS[p]
    const gid = `g${p + 1}`
    const retailer = `stu_r${p + 1}`
    const supplier = `stu_s${p + 1}`

    await put(`game_instances/${IID}/groups/${gid}`, {
      group_id: gid, game_instance_id: IID, status: 'matched',
      player_participants: [retailer, supplier], bot_participants: [],
      lead_participant_id: retailer,
    })
    for (const [pid, nm] of [[retailer, `Retailer ${p + 1}`], [supplier, `Supplier ${p + 1}`]]) {
      await put(`game_instances/${IID}/participants/${pid}`, {
        participant_id: pid, game_instance_id: IID, display_name: nm,
        role: 'player', group_id: gid, is_bot: false,
        raw_score: 1, finalized_at: new Date().toISOString(),
        knowledge_check_score: 6,
        text_answers: {},
      })
    }

    const history = []
    for (let r = 1; r <= ROUNDS; r++) {
      const demandType = rnd() < 0.5 ? 'HIGH' : 'LOW'
      const actualDemand = drawLots(demandType === 'HIGH' ? HIGH : LOW)
      const isDefault = (DEFAULTS[p] ?? []).includes(r)
      const message = isDefault ? 'HIGH' : pair.report(demandType, r)
      const production = isDefault ? 2 : pair.order(message, r)
      const sales = Math.min(actualDemand, production)
      history.push({
        round: r,
        retailerSeat: 0, supplierSeat: 1,
        message, production, demandType, actualDemand, sales,
        profits: {
          retailer: (S.retailPrice - S.wholesalePrice) * sales,
          supplier: S.wholesalePrice * sales - S.unitCost * production,
        },
        truthful: message === demandType,
        defaulted: { retailer: isDefault, supplier: isDefault },
      })
    }

    await put(`game_instances/${IID}/infoshare_round/${gid}`, {
      group_id: gid,
      pid_by_seat: { '0': retailer, '1': supplier },
      seat_by_pid: { [retailer]: 0, [supplier]: 1 },
      stage_seconds: 120, clock_enabled: true, stage_deadline_ms: null, bot_seats: [],
      state: {
        status: 'finished', round: ROUNDS, stageIndex: 0,
        seats: [0, 1], roleBySeat: { '0': 'retailer', '1': 'supplier' },
        horizonBySeat: { '0': ROUNDS, '1': ROUNDS }, seed: 1,
        roundFields: {}, submissions: {}, defaultedThisRound: [], timeouts: [],
        history: history.map((h) => ({
          round: h.round, roundFields: {}, submissions: {},
          result: {
            message: h.message, production: h.production, demandType: h.demandType,
            actualDemand: h.actualDemand, sales: h.sales, profits: h.profits, truthful: h.truthful,
          },
          defaulted: h.defaulted.retailer ? [0, 1] : [],
        })),
      },
    })
    console.log(`  pair ${p + 1} (${pair.name}) — ${ROUNDS} rounds`)
  }

  console.log(`\nDone. Open http://localhost:5174/reports?_dev_instance=${IID}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
