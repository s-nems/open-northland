# Implement barracks training and exercise (coin spend, XP buckets, unlock gates)

**Area:** sim + app · **Origin:** combat plan reconciliation, 2026-07-12 · **Blocked by:**
[barracks-recruitment](barracks-recruitment.md)

Progression today accrues only generic good/harvest XP (`packages/sim/src/systems/progression/experience.ts`);
the barracks train/exercise atomics, the coin spend, and the `needfor*`/`allow*`/`trainforjob`
gates are unwired (marked "a later slice" in `progression/unlocks.ts`).

**Source basis (extracted):** training atomics `viking_soldier_train` length 28 → `event 2 30 −1`
(spend a coin) + `event 22 29 +25` (TRAINING XP, bucket 77); `_exercise` → `+1`; atomic actions
EXERCISE 89 / TRAIN 90; `soldier general` type 69 job 31 `experiencefactor 1`
(humanjobexperiencetypes.ini). The XP→level curve and per-level effects are NOT readable — named
calibration constants (see [combat-calibration](combat-calibration.md)).

## Scope

- Train/exercise drive driven by the animation events (coin spend and XP land on the event frames,
  not on completion).
- Wire the `needfor*`/`trainforjob` unlock gates that consume the TRAINING bucket.
- Barracks affordances in the selected-building panel (existing unit-panel pattern); demonstrate an
  unlock in the `?scene=barracks` scene.

## Verify

- `npm test` — existing goldens byte-identical.
- `?scene=barracks`: XP rises, coins drain, a gated job unlocks — **user's eyes**.
