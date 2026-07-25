# Implement barracks training and exercise (coin spend, XP buckets, unlock gates)

**Area:** sim + app · **Priority:** P2
**Blocked by:** [barracks recruitment](barracks-recruitment.md)

Progression accrues work/production/carry/fight XP and the `needfor*` accrued-XP gates are live
(repeats-scale thresholds; fight swings feed the weapon buckets AND the band tracks 69/70 the basic
soldier-class and hero-variant gates read). Still unwired: the barracks train/exercise atomics, the
coin spend, and the `trainfor*`/`allow*` schooling gates (marked "a later slice" in
`progression/unlocks.ts`).

Decisions (user, 2026-07-25):
- The school/LEARN house (up to 5 civilians learn a trade a tribe member has mastered, without the
  XP; the TRAINING bucket 77 is flushed when the trained target changes) stays with this slice, not
  the progression-toggle work.
- The global profession-progression toggle (`setProfessionProgression`, `ProgressionRules`) NEVER
  unlocks fighter-band jobs (soldier 31..41 / hero 42..47) — those unlock only through barracks
  training, so the toggle's carve-out must survive this slice.
- XP accrual keeps running while the toggle is off (bonuses still pay off); only the gates lift.

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
