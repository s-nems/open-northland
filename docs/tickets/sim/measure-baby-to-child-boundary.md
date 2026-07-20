# Measure the original's baby→child boundary

**Area:** packages/sim · **Origin:** branch fix/child-growup-time, 2026-07-20 · **Priority:** P3
**Needs user:** yes — the measurement is an observation of the running original, which an agent cannot make.

`packages/sim/src/systems/lifecycle/ageclass.ts` now pins the *total* childhood to observation of the
running original: a settler born at age 0 becomes an adult at 12 years, after 4 minutes of ×1 play
(`TICKS_PER_AGE_YEAR = 240`, `GROWUP_TICKS * 2 = 2880`).

What is still approximated is where inside that childhood the baby sprite becomes the child sprite.
`GROWUP_TICKS` splits it evenly (6 years baby, 6 years child) purely because the two-stage model was
already written that way — the boundary was never measured, and no readable rule file carries it (no
growth key in `jobtypes.ini` / `tribetypes.ini` / `houses.ini`, and the reversing repo has no decompiled
gameplay logic for it).

## Scope

Watch a newborn in the original at ×1 and record the wall-clock time at which its sprite changes from
`baby_*` to `child_*`. Convert with `TICKS_PER_SECOND = 12` and replace the even split: `GROWUP_TICKS`
becomes the measured baby duration, and the child stage becomes `2880 - GROWUP_TICKS` rather than an
equal second half. That means `ageclass.ts` needs two named durations instead of one doubled constant —
`growthSystem` and `ageClassAt` currently both key off `GROWUP_TICKS * 2` for adulthood, and
`spawnAgeTicks` returns `GROWUP_TICKS` as "start of the child stage", so all three read the new pair.

Keep the childhood total at the already-measured 2880 ticks; only the internal boundary moves.

## Verify

`npm test`, `npm run check`, `npm run build`. Update the cadence test in
`packages/sim/test/lifecycle/growth-system.test.ts` ("a childhood lasts the observed 4 minutes of x1
play, and 12 age-years") so it still pins the total, plus the new baby/child boundary. Human sign-off on
`?scene=children` for the sprite change happening at the right moment.
