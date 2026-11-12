# Drop the experience gates on soldier and hero trades

**Area:** sim · **Focus:** progression/unlocks · **Priority:** P2

Owner ruling: a soldier is a soldier. He puts on a weapon and that is his rank; no experience threshold
stands between him and a better one. The separate soldier trades per weapon are a legacy of the data
model and stay, but nothing may gate them on experience.

Today `settlerMeetsNeed` (`packages/sim/src/systems/progression/unlocks.ts`) treats the fighter trades as
a gated band even with profession progression off: it reads each tribe's `needforjob` rows for the
soldier and hero trades (5 repeats of the soldier or hero general track for the base ranks, 10 landed
hits of the weapon class for the iron spear, long sword and long bow) and accepts barracks schooling
(`schoolingMet`, the `trainforjob` rows on the training bucket) as the alternative. The player never
feels it, because arming goes through `equipGood`, which checks no experience; only `setJob`, the
militia's hunter call-up and the computer player's promotion reads reach the gate. It is dead weight that
reads as a rule, and `grantFightExperience` feeds the soldier and hero general tracks one repeat per hit
only so these gates have something to read (named an approximation there).

## Scope

- `settlerMeetsNeed`: a fighter trade is met without reading `needforjob` or `trainforjob` rows. Keep
  `typeAllowed` and the tribe-tech gate (`jobEnabled`) as they are.
- Delete what only served the gate: `schoolingMet`, `TRAINING_EXPERIENCE_TYPE` if nothing else reads it,
  and the per-hit accrual into the soldier and hero general tracks in `grantFightExperience`. The
  weapon-class buckets stay: they raise damage and size the star.
- Follow the readers: the computer player's promotion and requirement reads, the settler panel's
  upcoming-unlock rows, the sandbox catalog's soldier requirement rows
  (`packages/app/src/game/sandbox/content/catalog/tribes.ts`) and the barracks scene
  (`packages/app/src/scenes/army/barracks.ts`). None may show or wait on a soldier threshold.
- The extracted rows stay in content as data; the sim stops reading them for fighter trades.

## Verify

- One case in the unlocks test: a fresh civilian with no experience meets every soldier trade, with
  profession progression on and off.
- Saved experience maps lose the general-track entries for fighters, so the state hash moves; move the
  goldens in the same commit and name the change.
