# Finish barracks training: the coin spend, the soldier's own clip, the school, and the panel

**Area:** sim + app · **Priority:** P2

The drill itself landed (`systems/settlers/drives/training.ts`, `?scene=barracks`): a settler sent to a
barracks walks in, runs the civilist EXERCISE clip for 15 s of game time banking its `+1` TRAINING experience
per completed repetition, and steps back out enlisted as the base soldier class. The `trainforjob` rows now
open a fighter trade beside the unreachable `needforjob` rows (`schoolingMet`, `progression/unlocks.ts`), and
an AI seat hires a garrison out of its true surplus (`ai-player/workforce/garrison.ts`). Still open:

- **The coin spend and the soldier's own TRAIN clip.** `<tribe>_soldier_train` (atomic 90, length 28)
  carries `event 2 30 −1` (`ATOMIC_ANIMATION_EVENT_TYPE_CHANGE_GOLD`) beside `event 22 29 +25`; the
  drill runs the civilist EXERCISE clip (atomic 89, `+1`, free) for everyone, so a serving soldier
  drilling again pays nothing and banks at the recruit's rate. Wiring atomic 90 for a fighter needs a
  reading for the gold event — the barracks does carry `logicstock 8 100 1` (coin), so "spend one from
  this house's stock" is the candidate — and both events landing on their frames rather than on atomic
  completion (the `attack`/`construct` pattern).
- **Extract `logicSchoolSize` so the two LEARN houses separate on their own field.** The barracks and
  the school share `logicmaintype 4`, and the IR carries neither `logicSchoolSize` (barracks 25, school
  5) nor anything else naming the difference; `isBarracksType` currently tells them apart by the worker
  slots only the barracks declares (`logicworker 24 4`). Carry the field through
  `tools/asset-pipeline/src/decoders/ini/types/buildings.ts` and key the classifier on it.
- **The school's own half.** Up to 5 learners take a trade a tribe member has mastered, and the TRAINING
  bucket is flushed when the trained target changes (`logicdefines.inc` 609-610; user decision
  2026-07-25) — today it accrues permanently, which will pre-pay civilian rows once the school teaches.
  The civilian rows are `trainforjob` 9..30 at amount 10 and `trainforgood` at 10..30, several of which
  read expType 57 (`JOB_EXPERIENCE_TYPE_JOB_DRUID_GENERAL`) rather than the TRAINING bucket.
- **The drill has no read of its own, and a refused order is silent.** The barracks Pracownicy field now
  draws the recruits (`hud/details-panel/worker-selection.ts`), but nothing separates them from the staff
  the limits strip above counts, and nothing on the settler panel says a drill is in flight or how far it
  has to run (`TrainingOrder` is already in the snapshot; the unlock forecast skips fighter targets, so
  the TRAINING repeats against `trainforjob 31 5 77` are shown as a bare number with no target). The
  refusals are silent too: `trainSoldier` drops the order for six reasons and `view/unit-controls`
  enqueues it for any settler, so right-clicking a barracks the signpost network cannot reach does
  nothing at all. The assign-workplace hover wash (`highlights/assign-highlight.ts`) is the existing
  shape, and today it reds the same barracks for the same colonist that right-clicking trains.
- **The armed classes in the fallback catalog.** `game/sandbox/content/catalog/tribes.ts` carries the
  gate rows for the base class only; 32..41 are gated the same way in the real table, but several are
  tower worker slots the sandbox staffs, so their rows wait on the weapon-equip slice
  ([barracks-recruitment](barracks-recruitment.md)).
- **The `allow*` gates** and the XP→level curve (see [combat-calibration](combat-calibration.md)).

Standing decisions this slice must keep: the progression toggle never unlocks a fighter trade, XP
accrual keeps running while the toggle is off, and an AI seat skips the experience tree but not the
barracks.

**Source basis (extracted):** `logicdefines.inc` EXERCISE 89 / TRAIN 90 (710-711),
`ATOMIC_ANIMATION_EVENT_TYPE_GET_TRAINING 29` (749), `CHANGE_GOLD 30` (750),
`JOB_EXPERIENCE_TYPE_TRAINING 77` (613); `setatomic 6 89 "<tribe>_civilist_exercise"` and
`setatomic 31 90 "<tribe>_soldier_train"` in every playable tribe; `houses.ini` school `logictype 38 /
logicSchoolSize 5` against barracks `logictype 39 / logicSchoolSize 25 / logicworker 24 4`;
`trainforjob 31/32/34/40 5 77` and `33/35/41 10 77`.

## Verify

- `npm test` — existing goldens byte-identical.
- `?scene=barracks`: a coin leaves the barracks stock on a soldier's drill, the panel names the drill in
  flight and separates a recruit from the staff, and a refused order says so — **user's eyes**.
