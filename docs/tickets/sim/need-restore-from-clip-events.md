# Drive per-satisfier need restore magnitudes from the atomic-clip events

**Area:** sim · **Origin:** needs-pacing worktree, 2026-07-20 · **Priority:** P3

Eating and sleeping are now PARTIAL refills — one meal takes `EAT_HUNGER_RESTORE` (40%) off hunger and one
sleep takes `SLEEP_FATIGUE_RESTORE` (20%) off fatigue (`packages/sim/src/systems/lifecycle/needs.ts`,
applied in `systems/agents/atomic.ts`). Both are single flat constants, so every satisfier of a need is
worth exactly the same. The original is finer-grained than that, and two loose ends remain:

- **Per-clip magnitudes.** `DataCnmd/atomicanimations12/atomicanimations.ini` gives different values per
  clip: `viking_civilist_eat_slot_food` = `event 30 2 +4000`, but `viking_civilist_eat_athome` and
  `viking_civilist_eat_slot_candy` = `+6000` (and candy adds `event 40 3 +4000` on the LEISURE channel —
  a treat cheers a settler up as well as feeding them). Sleep likewise differs: `viking_civilist_sleep`
  pulses rest twice, `viking_soldier_sleep` four times.
- **`pray` and `enjoy` still zero their bars outright** (`atomic.ts` `applyEffect`), which is now
  inconsistent with the eat/sleep partial model.

Blocked on the same unknown as [needs-drain-from-events](needs-drain-from-events.md) (the rise half of the
same problem, worth doing together): the reserve span the raw `event <at> <channel> <delta>` values are
measured against is not readable. `effects-combat/need-cost.ts` assumes ~10000 for the ENERGY channel,
which is what makes `+4000` = the observed 40% meal; the CONDITION channel's span does NOT fit the
observed 20% sleep under that assumption, so at least one channel has its own span.

**Source basis:** the mod's readable `atomicanimations.ini` event rows; channel ids from
`Data/GameSourceIncludes/logicdefines.inc` (`CHANGE_CONDITION` = 1, `CHANGE_ENERGY` = 2,
`CHANGE_SOCIAL` = 3, `CHANGE_RELIGION` = 4). The per-channel reserve span is the unknown to pin
first — by observation of the running original, since it is not in the data.

## Scope

- Pin each channel's reserve span (observation), then replace the flat `EAT_HUNGER_RESTORE` /
  `SLEEP_FATIGUE_RESTORE` with a read view over the completed atomic's own clip events, keyed by the
  channel → need map that `need-cost.ts` already uses for drains.
- Fold `pray`/`enjoy` onto the same path so no satisfier zeroes a bar by special case.
- Behaviour changes → **goldens move intentionally**; name the mechanic in the commit.

## Verify

- `npm test`; the eat/forage/sleep drive suites assert restore amounts directly and will need updating.
- `?map=<id>` with needs on — **user judges the pacing** (how much of the day settlers spend feeding
  and resting).

**The restore ratio is currently inverted (2026-07-20).** The readable clips give the civilist's sleep
`+8000` on channel 1 (two `+4000` pulses) against the meal's `+4000` on channel 2 — sleep restores
*twice* what a meal does. The sim has it the other way round: `SLEEP_FATIGUE_RESTORE` (20%) is half
`EAT_HUNGER_RESTORE` (40%), so settlers nap about twice as often as they eat. Both constants are
pinned by observation, and the per-channel reserve span this ticket is blocked on is exactly what
would reconcile them — but the inversion is the sharpest evidence that the two channels do NOT share
one span, so record it as the test any proposed span must pass.
