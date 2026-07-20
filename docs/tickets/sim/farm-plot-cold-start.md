# Shorten the farm's cold start — a lone farmer ploughs 24 fields before watering any

**Area:** sim · **Origin:** farm pacing calibration, 2026-07-20 · **Priority:** P3

The farmer drive orders its ladder `reap > carry > sow > water > wait` (`packages/sim/src/systems/agents/
farming/planner.ts`). Sow beats the can, so a farm starting on bare ground sows its whole `maxFields` plot
(24 on the shipped balance) before it waters a single plant. Measured headless on the sandbox balance
(grass map, farm at the centre, sink beside it):

| crew | plot full at | first grain banked |
|------|--------------|--------------------|
| 1 farmer  | tick 2423 | tick 5163 (≈ 7.2 min at ×1) |
| 2 farmers | tick 932  | tick 3307 (≈ 4.6 min at ×1) |
| 3 farmers | tick 864  | tick 3046 (≈ 4.2 min at ×1) |
| 4 farmers | tick 586  | tick 2324 (≈ 3.2 min at ×1) |

Steady-state pacing and the staggered ripening are correct (pinned by `packages/app/test/farm-pacing.test.ts`);
this is only the ramp. Over seven minutes of a new farm showing a full plot of seedlings that visibly do
not grow reads as a stall to the player, and it is why `scenes/chain.ts` needs a 12000-tick run and
`packages/app/test/content/farming-scenario.test.ts` an 8000-tick one.

Sow-before-water is load-bearing and must not simply be flipped: with per-stage watering, a plain water-first
farmer never expands past the handful of fields its can can keep up with (measured: a lone farmer settles at
~8 fields, and the plot never approaches the observed 24).

## Scope

- Check what the original does on a freshly built farm — does the farmer interleave sowing and watering, or
  plough the whole plot first? Observation of the running game is the only oracle here; no readable data
  carries the loop's ordering.
- If it interleaves, the likely shape is "water a field still at stage 1 before sowing another, but let
  established fields wait" — the farmer then waters each seedling it just planted (they are adjacent) without
  established fields starving expansion. Confirm that keeps the plot at ~24 and the pacing bands in
  `farm-pacing.test.ts` green.
- Re-tighten `RUN_TICKS` in `scenes/chain.ts` and `FARM_TICKS` in `farming-scenario.test.ts` if the ramp
  shortens.

## Verify

- `packages/app/test/farm-pacing.test.ts` still passes (throughput, flat plot cap, continuous ripening).
- A new assertion pinning first-grain latency for a lone farmer.
