# infoshare — Information Sharing (CPFR)

A two-seat repeated stage game about **cheap talk and reputation**. A **Retailer** knows
the demand type and sends a message that need not be true; a **Supplier** must commit
production knowing only the message. Everything is revealed afterwards — so a lie is
always found out, one round later.

Spec: `Information_Sharing_Game_Specification_v1.md` ·
KC: `Information_Sharing_KC_Questions_v1.md`

| | |
|---|---|
| `game_id` | `infoshare` (frozen) |
| Project | `infoshare-mygames-live` |
| Domain | `infoshare.mygames.live` |
| Collection prefix | `infoshare_` (round state: `infoshare_round`) |
| Seat roles | `retailer`, `supplier` (frozen) — assigned **late**, seeded shuffle |
| Matching role | one undifferentiated `player`, group of 2 |
| Callback secret | game side `INFOSHARE_CALLBACK_SECRET` · classroom side `CALLBACK_SECRET_INFOSHARE` · `callbackSecretId` `infoshare_v1` |

Spawned from **`template-stage`** (`a59c0b9`). The spawn checklist lives in that repo's
README; this file does not duplicate it.

---

## ⚠ Status: spawn Part 1. The game is NOT written yet.

The **identity** is fully spawned — ids, project, domain, roles, rules, secret name,
wiring. The **game** is still template-stage's placeholder: two stages (`signal` →
`respond`), one hidden draw, three rounds, a stand-in payoff.

That is deliberate, and the two are tracked by two different markers:

```
grep -rn "REPLACE_FROM_"   functions/src frontend/src   # MUST be empty — identity gate
grep -rln "PLACEHOLDER_GAME" functions/src frontend/src # scheduled work, counts down
```

`infoshare-round-loop.mjs` asserts the first to zero and only *reports* the second.
Collapsing them into one marker — as the template did — makes the gate either fail for
the whole build or get silenced by deleting markers off unfinished code.

### Still owed, per the spec

| Slice | Replaces | Spec |
|---|---|---|
| Round model | stages, the two draws, the reveal point, the default table | §1, §2, §6.1 |
| Payoffs | `round/resolver.ts`, `round/settings.ts` (four decimal settings) | §3 |
| Screens | `GameScreen`, the seven-column history table | §1.1, §1.3 |
| Bots | `round/decide.ts` (Retailer reciprocates, Supplier trusting) | §7.1 |
| KC + debrief | the question bank, auto-derived from the payoff table | §8, §9 |
| Reports | Tier 1b truthfulness, Tier 3 proportion-truthful and average-production | §10 |

## Running it

```
cd functions  && npm install && npm run build
cd ../frontend && npm install && npm run build && npm test
cd ..          && node infoshare-round-loop.mjs      # KEEP=1 leaves the emulators up
```
