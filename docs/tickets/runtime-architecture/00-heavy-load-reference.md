# Build the heavy-load reference scenario and its measurement harness

**Area:** tooling, app, sim, net-server · **Focus:** bench, diag, conflict · **Priority:** P2

The heaviest economy the project measures is the checkpointed 13-seat run on `magiczny_las_12_players`
with progression and needs on (`docs/DEVELOPMENT.md`, "Measuring performance"): at ticks 40k to 60k
it holds about 1000 settlers and 230 buildings at a tick median of 19 to 24 ms, with the planner near
half of the tick and combat near a quarter without a war. Players will load a relayed room harder
still: armies of hundreds per side in contact. The one war probe so far (every seat pair set to enemy
from the 40k checkpoint, 600 ticks, about 330 fleeing civilians and 50 fighters) moved combat from
3.6 to 3.9 ms and pathfinding p95 from 2.1 to 2.9 ms, so hundreds per side remain unmeasured and
which term dominates at army scale (target picks, the collider pass, pathfinding under mass orders,
projectiles, the conflict-adjacent scans) is unknown. Every ticket in this epic would otherwise verify
itself against a case lighter than the one it exists for. The frame statistics also keep one
distribution for all frames, so a frame that carried a tick cannot be told from one that did not,
which is the split that shows whether the sim or the draw is over budget.

## Scope

- One recipe that reaches the peak: the checkpointed 13-seat economy run above as the base, then a
  deterministic mass battle of two or more seats with hundreds of fighters per side ordered into
  contact from a late checkpoint. Written as bench knobs beside the existing `ON_BENCH_*` ones so a
  checkpoint stores the peak and later runs restore it. Record the settler, soldier and building
  counts at the checkpoint.
- The bench report on that checkpoint names per-system share and growth against army size (for
  example 100, 400 and 1000 fighters) through the existing report machinery. Bounding tickets follow
  from the ranking; this ticket optimises nothing.
- A headless multi-client run through the in-memory relay harness under
  `packages/net-server/test/support/`: N real clients stepping the real sim from the checkpoint, per
  client tick cost and acknowledged-tick lag reported per window, one client optionally slowed by a
  factor to model a weak machine.
- `FrameStats` and the perf overlay split frame CPU into frames with `steps > 0` and `steps = 0`,
  with p50, p95 and p99 for each.
- On the checkpoint: the resync snapshot's encoded size and its encode, transfer and decode time, as
  the relay's catch-up store would carry it.
- The recipe and the report format in `docs/DEVELOPMENT.md`, beside the existing bench entries.

No target budget is set. The reference is the yardstick; the goal is the smoothest achievable.

## Verify

- Two runs of the recipe from the same checkpoint agree on the state hash and within a stated
  tolerance on the per-window tick medians.
- The report names the top combat-scale terms with shares and growth factors.
- The multi-client run reports per-client cost and lag, and the slowed client shows the lag.
- The overlay shows the two frame classes on a live session.
- `npm test`, `npm run check`, `npm run build`.
