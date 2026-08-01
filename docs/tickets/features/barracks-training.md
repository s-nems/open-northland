# Charge serving soldiers for barracks drills on the authored cue

**Area:** sim, app · **Priority:** P2

The current drill uses the free civilist EXERCISE clip for recruits and serving soldiers. The authored
soldier TRAIN clip is different: atomic 90 has `CHANGE_GOLD -1` on frame 2 and `GET_TRAINING +25` on
frame 22. A serving soldier therefore trains for free and gains experience at the recruit rate.

**Source basis:** `logicdefines.inc` EXERCISE 89 / TRAIN 90 (710-711),
`ATOMIC_ANIMATION_EVENT_TYPE_GET_TRAINING 29` (749), `CHANGE_GOLD 30` (750),
`JOB_EXPERIENCE_TYPE_TRAINING 77` (613), and the tribe `setatomic` rows for civilist EXERCISE and
soldier TRAIN. The barracks has a coin stock slot.

## Scope

- Serving soldiers use atomic 90. Apply its coin and training events on their authored frames.
- Check the owned files or running original for the owner of `CHANGE_GOLD`. If that remains
  unresolved, use the barracks stock and record it as an approximation.
- Refuse the drill when its resolved coin source is empty.
- Keep recruit drills on atomic 89 and preserve the current progression-toggle and AI rules.
- School teaching, drill feedback, and the remaining `allow*` gates are separate work.

## Verify

- Tests pin both cue frames, insufficient coin, recruit drills, and same-seed behavior. Record the
  source or observation used to choose the coin owner.
- `npm test`, `npm run check`, `npm run build`, and `?scene=barracks`.
