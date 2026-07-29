// ═══════════════════════════════════════════════════════════════════════════════
// THE SETTINGS MANIFEST — kept OUT of App.tsx on purpose.
//
// ⚠ SO IT CAN BE TESTED WITHOUT BOOTING THE APP. Importing App.tsx pulls in firebase.ts,
// which initialises Firestore/Auth/RTDB at module load and throws in a test environment.
// A manifest that can only be read by starting the whole app is a manifest nothing will
// ever assert against — and this list going unchecked is exactly how the Settings page
// spent three slices writing keys the game never read.
//
// settingsKeys.test.ts compares this against round/settings.ts and the game definition.
// ═══════════════════════════════════════════════════════════════════════════════

export const configSections = [
  {
    id: 'rounds',
    title: 'Rounds',
    fields: [
      { key: 'round_seconds', label: 'Seconds per decision (round clock)', kind: 'positiveInt' as const, placeholder: '120' },
      { key: 'num_rounds',    label: 'Number of rounds',                   kind: 'positiveInt' as const, placeholder: '10' },
      { key: 'clock_mode',    label: 'Clock: "on" (classroom) or "off" (online play)', kind: 'string' as const, placeholder: 'on' },
    ],
  },
  {
    id: 'payoffs',
    title: 'Payoffs and draws',
    fields: [
      /*
        ⚠ THESE KEYS MUST BE THE ONES THE GAME READS (round/settings.ts CONFIG_KEYS).
        They used to be the placeholder game's — pUp, highCapacity, lowCapacity,
        retailerRate, supplierRate, unitCost — so every payoff and probability control on
        this page wrote a key the game NEVER READ. The fields looked editable and did
        nothing: an instructor could change the HIGH probability and the game would keep
        using the default. Six dead keys, and eight real ones with no field at all.

        The bidirectional test in settingsKeys.test.ts now fails the build if the two
        sides ever drift again.

        ⚠ "when demand is HIGH" ON ALL THREE LOT PROBABILITIES. Without it a reader
        assumes there are six numbers to set; LOW is DERIVED as the reverse of HIGH and
        is deliberately not editable, which is what makes an asymmetric pair
        unrepresentable.
      */
      { key: 'p_high',         label: 'HIGH demand probability (0–1)',              kind: 'string' as const, placeholder: '0.5' },
      { key: 'p_lots_1',       label: 'Chance demand is 1 lot when demand is HIGH', kind: 'string' as const, placeholder: '0.02' },
      { key: 'p_lots_2',       label: 'Chance demand is 2 lots when demand is HIGH', kind: 'string' as const, placeholder: '0.33' },
      { key: 'p_lots_3',       label: 'Chance demand is 3 lots when demand is HIGH', kind: 'string' as const, placeholder: '0.65' },
      { key: 'retail_price',   label: 'Retail price per lot',                       kind: 'string' as const, placeholder: '3' },
      { key: 'wholesale_price', label: 'Wholesale price per lot',                   kind: 'string' as const, placeholder: '2' },
      { key: 'unit_cost',      label: 'Supplier cost per lot made',                 kind: 'string' as const, placeholder: '1' },
      { key: 'bot_punishment_rounds', label: 'Bot punishment length (rounds)',      kind: 'positiveInt' as const, placeholder: '1' },
    ],
  },
  {
    id: 'contact',
    title: 'Instructor contact',
    fields: [
      { key: 'instructor_email', label: 'Instructor email (for the "cannot reach my group" flag)', kind: 'string' as const, placeholder: 'you@university.edu' },
    ],
  },
]
