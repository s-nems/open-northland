# Host the simulation and the lockstep driver in a dedicated worker

**Area:** app, sim, lockstep, desktop · **Focus:** view/runtime · **Priority:** P2
**Blocked by:** [00 Heavy-load reference](00-heavy-load-reference.md), [01 Session host seam](01-session-host-seam.md), [02 Snapshot delta and mirror](02-snapshot-delta-and-mirror.md)

A frame that carries a tick pays tick, snapshot and draw on the main thread inside one display
period. At speed x3 three of five frames at 60 Hz carry a tick, and those are the frames that miss
the budget. The display's period also caps how expensive a tick may ever get, and any main-thread
stall (a render spike, a DOM rebuild, a garbage collection) delays the tick and, in a relayed room,
the acknowledgement the relay waits for.

## Scope

- A worker host behind the interface of 01: it owns the `Simulation`, `LockstepDriver`,
  `FixedTimestep`, the command queue, the command log, the hash trace, the invariant checks and save
  export. Its loop is timer-driven at the tick rate times the session speed, independent of
  `requestAnimationFrame`.
- Per stepped tick the worker posts the delta of 02 and the tick's events, in order, including ticks
  the main thread never draws. The main-thread queue is bounded: deltas may coalesce when the main
  thread is behind, events never drop.
- The fog view crosses on a `generation` change as its masks; `FogView.stateAt` is an accessor over
  live fog state, so the main side rebuilds the accessor over the received masks. Probes and rare
  reads of 01 become requests answered asynchronously; the frame's synchronous reads are served from
  the mirror and the last fog view.
- The worker is constructible from content plus map and from a `SaveGame`, since a staged save load
  reboots the page and restores at boot. The content set and the decoded map reach it by transfer or a
  second load; the cost is measured and stated in boot time and memory.
- The worker module loads under Vite in the browser and under the desktop's `app://` scheme
  (`packages/desktop/src/protocol.ts`; `protocol-routing.ts` already records a Pixi worker URL quirk
  there).
- The `?debug=profile` per-system report is assembled in the worker and requested by the main thread;
  `window.__opennorthland` and `perf()` become asynchronous where they read the sim, and the Playwright
  probes that use them are updated in the same change.
- A thrown tick error surfaces on the main thread as it does inline; a stalled worker is reported
  within a bounded time instead of leaving a frozen world under a live UI.
- Single-player pause semantics are unchanged: the pauses the frame loop raises today (sub-mission
  sheets, a suspended view) reach the worker as clock messages.
- The inline host stays for vitest, headless scenarios and scenes. Both hosts run under test, the
  worker one under Node `worker_threads`, so the two loops cannot drift.
- Electron and the browser both use the worker host. `packages/app/AGENTS.md` is rewritten where it
  says the app runs the frame loop over the session driver and owns the live simulation: the worker
  host owns both, the app owns the mirror and the renderer.
- `docs/tickets/app/runtime-invariant-watch.md` retargets to the worker host in this ticket's commit.

## Verify

- Same seed and command stream produce byte-identical state hashes inline and worker-hosted, on the
  scenario suite and on the 00 checkpoint.
- A command enqueued on the main thread appears in the replay log at the tick the worker admitted
  it, and replaying the log reproduces the final hash.
- Live probe on the 00 session: frame p95 no longer moves with tick cost; the per-tick receive cost
  on the main thread is reported beside sim time.
- A staged save load restores through the worker; a thrown tick error reaches the main thread; a
  stalled worker is reported.
- The desktop build boots the worker under `app://`.
- Boot time and memory before and after, stated in the closing report.
- `npm test`, `npm run check`, `npm run build`, a headless scenario run.
