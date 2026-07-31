# Cue the missed shot's landing (sound, and optionally a dirt mark)

**Area:** audio (+ render mark, optional) · **Priority:** P3

A hunter's missed arrow flies to its frozen aim point and the sim announces the landing
(`projectileMissed { projectile, shooter, munitionType, at }`), but nothing consumes the event:
`packages/audio/src/data/bindings.ts` binds only `projectileLaunched`/`projectileHit`, and the render
leaves no mark. On screen a miss reads as the arrow popping out of existence.

The original carries the evidence for a distinct no-hit cue: every ranged row in `weapons.ini` has a
`soundtype_NoHit <n> <sound>` table indexed by ground type 1-10 (an arrow thudding into dirt), parallel
to the armor-indexed `soundtype_Hit` table.

## Scope

- Bind `projectileMissed` to a spatial audio group (a thud; per-terrain selection per the
  `soundtype_NoHit` table is the faithful stretch goal - a single group is an acceptable first cut).
- Optionally: a small, short-lived arrow-in-ground render mark at `at` (the `marks.ts` fold is the seam).

## Verification

- Unit: the binding resolves for the event (the existing bindings test shape).
- Human ears on the `hunting` scene: a miss should thud, not vanish silently.
