# Avoid late-game vehicle clearance rebuild stalls

**Area:** sim · **Focus:** vehicles, footprint · **Priority:** P2

On the [late-game reference](../../perf/magiczny-las-late-game.md), `magiczny_las`, seed 7,
AI seats 0-6, tick 94298 spends 107.64 ms in `vehicleMovement`. A targeted CPU-profile repeat
from tick 90000, with 4200 warm-up ticks and 200 measured ticks, reproduces 105.68 ms in that
system at the same tick. The profiled repeat confirms the location; its timings are not the baseline.

Across that 200-tick profile, the vehicle-movement subtree contains 152.48 ms of samples:
`settleOutOfGap` accounts for 143.16 ms inclusive, `vehicleStandable` → `vehicleClearance` for
136.81 ms, and clearance `rebuild` for 103.34 ms. These are nested totals, not additive.
The expensive operation is rebuilding the clearance field, rather than the vehicle's route search.

`systems/footprint/vehicle-clearance.ts` already replays blocker changes locally. Its `catchUp`
falls back to `rebuild` after a membership-journal gap or a landscape-topology revision. A rebuild
constructs a `ClearanceField` over the full terrain and re-derives every blocker's recorded cells.
The map has 182400 half-cell nodes. A vehicle finishing a drive can trigger this through
`settleOutOfGap`, so infrequent clearance reads can concentrate previously deferred upkeep in one tick.
The profile establishes the rebuild cost; it does not distinguish which fallback triggered this one.

## Scope

- Instrument rebuild reasons, time since the preceding clearance read, journal gaps, changed blocker
  cells and scanned nodes in the benchmark caller or a diagnostic seam. Reproduce tick 94298 and
  identify its fallback before choosing the change.
- Preserve enough changed-blocker evidence to catch an existing clearance field up locally after
  sparse reads, or update it from the relevant changes before its journals lose their history.
  If landscape edits cause the fallback, feed their affected cells into local recomputation.
  Avoid a per-tick full blocker or terrain scan.
- Preserve clearance classes, blocker layering, gate swings, building upgrades and resource removal.
  A first field build for a fresh world remains a separate startup cost.
- Keep vehicle commands and group members starting in the same tick. Do not ration requests across
  ticks or change stopping, gap traversal or collision rules.

## Verify

- Repeat the plain map benchmark from tick 90000 with 4200 warm-up and 200 measured ticks,
  and profile that window separately. Report tick 94298, maximum vehicle-system time, rebuild
  reasons and scanned nodes before and after; retain the same final state hash.
- Exercise a long interval without clearance reads while blockers spawn, disappear or upgrade,
  then compare every clearance class with a fresh field. Cover a journal gap, landscape edits,
  wall gate changes, resource exhaustion and save restoration.
- Existing clearance and vehicle tests, cache verifier, `npm test`, `npm run check`, `npm run build`.
