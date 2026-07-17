# Snap the motion track when an entity re-enters the drawn set

**Area:** render · **Origin:** bug-hunt review, 2026-07-17 · **Priority:** P3

`trackMotion` (`packages/render/src/gpu/sprite-pool/motion.ts:73-94`) snaps only on first sighting
or a jump past `SNAP_DISTANCE` (128 px ≈ 2 cells). It has no time-gap guard: the else-branch
already computes `dt = tick - m.tick` (used to correct the gait rate) but never uses it to decide
whether to snap. Pooled entities keep their `MotionTrack` while absent from the drawn scene
(indoors, fogged, viewport-culled — the pool retains them, `sprite-pool.ts:363` resumes tracking on
re-entry), so a settler that steps into a workplace, waits seconds, and re-emerges at the door
**under** 128 px from where it vanished lerps from its many-ticks-old anchor to the door over one
tick — a visible wrong-direction glide. Same for anything scrolling back on screen or emerging
from fog within the snap distance.

**Do not fix by snapping on `dt > 1` in `trackMotion`:** multi-tick frames are legitimate for
continuously-visible walkers (fixed-timestep catch-up, ×2/×3 game speed at low fps), and snapping
there would kill interpolation exactly when it is most needed. The correct seam is re-entry: the
reconcile knows when an item joins the drawn set after being absent — reset the track there
(`m.tick = -1`, so the existing first-sighting snap fires; it also leaves the gait clock alone,
matching the documented teleport stance).

## Scope

- In the sprite-pool reconcile, detect an entity re-entering the drawn set after ≥1 frame of
  absence and reset its motion track before the `trackMotion` call. If the reconcile does not
  currently distinguish "hidden last frame" from "drawn last frame", add that bit to the pooled
  entity.
- Unit-test at the pure level: a track updated at tick T, untouched, then updated at tick T+K with
  a small offset must draw at the new anchor immediately (no lerp from the stale one), while a
  continuously-updated track crossing a dt=2 catch-up frame still interpolates.

## Verify

`npm test` (motion/reconcile suites), `npm run check`, `npm run build`. Visual: in a scene with a
staffed workshop, watch a worker re-emerge from the door — no glide from its entry point; human
sign-off (agents cannot self-judge motion smoothness).
