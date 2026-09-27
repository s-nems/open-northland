# Keep a failed tick's partial writes and a stale alpha out of the drawn state

**Area:** app · **Focus:** session/worker · **Priority:** P3

Two edges of the worker session let the main thread draw a state no whole tick produced:

- A tick that throws: `WorkerSession.fail` (`session/worker/serve.ts`) calls `outbox.flushAll()`, and
  a pending batch takes its delta when it is posted (`takeBatch` calls `deltas.next()`), after the
  throw. `Simulation.step` has already advanced `currentTick`, so the half-applied failing tick reaches
  the mirror, and the crash capture and diagnostics bundle describe it as a completed tick.
- A batch that arrives while paused: `RenderAlpha.arrived` (`session/worker/render-alpha.ts`) sets the
  held fraction to 0, so after a single step or a pause every interpolating kind (projectiles, fades,
  collapse) draws at the previous tick's anchor while the mirror holds the new tick. The inline driver
  keeps its held fraction.

## Scope

- On failure, post the ticks before the failing one with deltas taken before it (or take none after a
  throw) and name the failing tick separately in `tickError`.
- A paused arrival shows the tick it carries: the held fraction ends at the arrived tick, matching the
  inline host.

## Verify

- A worker-session unit test with a system that writes then throws: the mirror's last tick is the one
  before the failure and holds none of its writes.
- A render-alpha unit test: pause, deliver one stepped tick, and the alpha places interpolated kinds at
  that tick.
- `npm test`, `npm run check`.
