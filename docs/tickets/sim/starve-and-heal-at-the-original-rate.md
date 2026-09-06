# Starve and heal at the original's hitpoint rate

**Area:** sim · **Priority:** P3

`needsSystem` steps hitpoints on its own beat: every tenth tick it takes `max(1, trunc(max/240))` off a
settler whose hunger has pinned, or gives back half that to a wounded one. Both rates are authored, and
`packages/sim/src/systems/lifecycle/needs/system.ts` says so.

The owned copy sets them per tick instead, against a fixed pool: a human's maximum is 5000 hitpoints, an
unfed one loses 2 a tick, anyone else below the maximum gains 1 a tick, and the value is capped at one and
a half times the maximum the same way a need is. From full that is death in 2500 ticks and a full heal in
5000. The current model reaches death in 3000 and heals in 3000, so starvation runs a fifth slow and
healing close to twice fast.

## Scope

- Express both rates as a fraction of `Health.max` per tick, so a 300-point settler and a 20000-point
  target both keep the original's timing, and drop the ten-tick beat if the per-tick step stays exact in
  fixed point.
- Carry the same one-and-a-half-times ceiling hitpoints have in the original, which `NEED_OVERFILL_UNITS`
  already models for needs.
- Keep the healing draught's death save on the lethal step.

## Verify

- `npm test`; the save golden and the needs cases move once, deliberately.
- The `berries` scene still feeds its gatherers before any of them starves.
