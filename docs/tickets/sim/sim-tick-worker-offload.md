# Decouple frame rate from tick cost with a worker-hosted sim

**Area:** sim, app · **Focus:** runtime loop · **Priority:** P2 · **Complexity:** very high
**Blocked by:** [sim-host-seam](../app/sim-host-seam.md)

A frame that carries a sim tick pays tick + snapshot + draw on the render thread; at tick ~23k of
the magiczny_las 6-AI session that is 16-20 ms against an 8.3 ms budget at 120 Hz, and at speed x3
(36 ticks/s) every third frame carries a tick. Cutting individual systems shrinks the spike but the
structure stays: the display's frame budget caps how expensive a tick may ever get. Hosting the sim
loop in a worker removes the cap and gives the tick the whole 27.8 ms tick period at x3; the render
thread consumes the latest snapshot and interpolates, and a slow tick costs delivered sim speed, which
`FixedTimestep` already bounds by dropping backlog and `FrameStats` already reports.

Unverified premise: `takeSnapshot` is incremental per entity, but `postMessage` deep-copies the whole
snapshot every tick on both threads. The structured-clone test proves the shape survives, not that
the copy fits the frame. If the clone costs several ms on a developed map, the boundary replaces the
spike with a smaller per-tick one instead of removing it.

## Scope

Stage 1, measure before designing:

- On the magiczny_las 6-AI session around tick 23k record per tick: `structuredClone` of
  `sim.snapshot()` on the main thread, a worker `postMessage` round trip of the same snapshot, and
  the cost of a frame that carries no tick (`FrameStats` already separates sim and snapshot time).
- The plain snapshot per tick is acceptable only when clone plus deserialization fits inside the
  non-tick frame's headroom at 120 Hz. Otherwise the transfer becomes a delta of touched entities
  applied to a main-thread mirror. Rewrite this ticket with the numbers and the chosen shape before
  stage 2.

Stage 2, worker host behind the host seam:

- The worker owns the canonical loop, timestep, command log, hash trace, and save export. The main
  thread only enqueues and consumes, and never assigns ticks.
- The command protocol is the local transport of a lockstep protocol: an envelope carries its target
  tick, the worker advances a tick only when its input set for that tick is complete (locally, the
  local queue), and the worker stamps the admission tick into the replay log.
- Every stepped tick's events reach the main thread in order, including ticks whose snapshot the main
  thread never drew.
- Fog view travels on a fog generation change, not per tick.
- Every transferred entity is a fresh object, so consumers that skip unchanged entities by object
  identity (the render spatial index) key on id plus a change marker instead, or the rebuild is
  measured and accepted.
- A thrown tick error surfaces on the main thread as it does inline; a stalled worker is detected and
  reported within a bounded time rather than leaving a frozen world under a live UI.
- The sim pauses while the document is hidden, as it does today under `requestAnimationFrame`.
- A sustained shortfall below the requested speed multiplier reaches the player through the HUD, not
  only the debug overlay, since the stutter that signalled it before is gone.
- The single-thread host stays for vitest, headless scenarios, and scene entries. Both hosts run under
  test (Node `worker_threads` for the worker) so the two loops cannot drift.
- The worker needs the content set and the map; account for their transfer or second load in boot
  time and memory.
- Non-goals: no network transport, no `SharedArrayBuffer` lanes (a separate ticket if stage 1 forces
  it), no change to the save format.

## Verify

- Same seed and command stream produce byte-identical state hashes worker-hosted and inline.
- A command enqueued on the main thread appears in the replay log at the tick the worker admitted it,
  and replaying the log reproduces the final hash.
- Live probe on the magiczny_las session: frame p95 no longer moves with tick cost, the main-thread
  per-tick transfer cost is reported next to sim time and stays within the stage 1 budget, and
  delivered speed degrades gracefully and is visible.
- A thrown tick error reaches the main thread; a stalled worker is reported.
- `npm test`, `npm run check`, `npm run build`, plus a headless scenario run.
