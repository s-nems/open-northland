# Verify / pin the canonical human hitpoints (provisional 5000)

**Area:** app + sim · **Origin:** battle HP calibration, 2026-07-15 · **Priority:** P3

The original's **human** hitpoints are not in the readable data (source basis "Combat hit resolution") —
only buildings (`logichitpoints`, HQ 100000) and animals (`hitpointsAdult` 15000–20000) carry an
extracted HP. So the settler HP is a **provisional clean-room approximation of 5000**, chosen against the
real weapon scale (`weapons.ini` `damagevalue 0`: fist 400, short_sword 1600, long_sword/iron_spear 3800),
which puts a fighter at ~3 sword swings / ~2 long-sword swings — the original's many-hits melee, no one-shots.

HP is now **content-driven and single-source** (there are no per-scene / per-color HP overrides left):
- `packages/app/src/catalog/units.ts` — `HUMAN_HITPOINTS = 5000`, the ONE value.
- `TribeType.hitpoints` (schema) carries it; the sandbox tribe builder and the real-content overlay both set
  it from `HUMAN_HITPOINTS`, so every settler on either base reads one value via `settlerHitpoints` at spawn.
- `packages/sim/src/systems/conflict/spawn/settlers.ts` — `DEFAULT_SETTLER_HITPOINTS = 300` is now ONLY the
  fallback for content whose tribes leave `hitpoints` unset (the sim unit-test fixtures). Reconcile it with
  the real scale (or give the fixtures a tribe HP) so a fallback settler isn't one-shot — this moves sim
  goldens (intentional; name the mechanic in the commit).

## Scope

- Pin the canonical human HP: observe the original (how many sword swings kill a settler) or find a decodable
  human-hitpoints record. Update `HUMAN_HITPOINTS` and state the source basis.
- Reconcile the `DEFAULT_SETTLER_HITPOINTS` fallback / sim fixtures with the real scale.
- Consider whether age scales HP (the original's `hitpoints_adult` naming implies a per-age human pool — see
  the note in `reproduction.ts`); if so, `TribeType.hitpoints` grows a baby counterpart like the animals'.

## Verify

- `npm test` (sim goldens move only for the intended fallback/fixture change).
- Browser `?scene=battle` / `?scene=sandbox` — **user's eyes** on the melee pace (many-hits, not one-shot).
