# Runtime architecture epic

Epic map, not a task. The tickets in this folder move the simulation off the display frame, give the
main thread a mirror of the world it can read cheaply, and make a relayed room run at the pace its
slowest member can sustain instead of stopping for it. Per-system optimisation of the sim or the
renderer is not part of this epic and continues independently; these tickets change boundaries and
policies so that optimisation has a ceiling worth reaching.

## Decisions the epic rests on

- Lockstep stays. Every client runs the same deterministic sim; the relay carries inputs and the
  clock, never state, so its image stays free of content.
- The sim stays single-threaded and synchronous, hosted in a dedicated Web Worker on every client,
  in Electron and in the browser alike. No parallel section inside a tick, ever.
- The main thread reads the world through a mirror fed by a per-tick delta of touched entities, and
  through indexes maintained on that mirror. Full snapshots never cross the thread boundary: on a
  developed map a full structured clone costs hundreds of milliseconds, a touched-entity delta a few.
- The renderer stays on the main thread and interpolates the mirror. Rendering in a worker does not
  reduce the cost of a frame and would split one Pixi scene between two threads.
- Transfer goes over `postMessage`. `SharedArrayBuffer` is not planned; it becomes its own ticket only
  if the delta's measured receive cost on the heavy-load reference forces it.
- A slow room member falls behind and catches up on its own inside a free band, past which the
  room slows to that member's sustainable speed and everyone sees who limits it. The relay stops
  holding the clock for a lagging member.
- The sync digest stays stamped per tick. The disputed-tick forensics of 10 and the per-tick
  acknowledgement that 07 extends rest on it; a cheaper digest splits its components, it does not
  widen its window.
- The desktop build is the primary target. Browser-only behaviour, such as a hidden tab, is verified
  and documented, not designed around.

## Order and dependencies

| Ticket | Outcome | Depends on |
| --- | --- | --- |
| [00 Heavy-load reference](00-heavy-load-reference.md) | The scenario, harness and measurements every other ticket verifies against | none |
| [05 Transport in the worker](05-transport-in-worker.md) | The relayed session boots through the worker, and the relay client with its digests and pacer runs there | 00 |
| [06 Speed shortfall in the menu](06-speed-shortfall-in-menu.md) | A sustained shortfall, dropped ticks or a held worker clock, shown in the system menu | 00 |
| [07 Client load telemetry](07-client-load-telemetry.md) | Each client reports tick cost and backlog to the relay on the protocol | 00 |
| [08 Room pace governor](08-room-pace-governor.md) | Free band, governed speed with a named limiter, kick vote; no clock hold for lag | 07 |
| [09 Zoom-out LOD](09-zoom-out-lod.md) | Frame cost bounded across the zoom range by named detail tiers | 00 |
| [10 Desync forensics](10-desync-forensics.md) | Both sides of a divergence capture the disputed tick per domain into the bundle | none |
| [11 Background tab ticking](11-background-tab-ticking.md) | Verify and document whether the worker host keeps ticking in a hidden tab | 05 |

The runtime reads the world through one host interface, `SessionHost` in `packages/app/src/session/`.
The `?map=` entry runs its `Simulation`, `LockstepDriver` over `LoopbackTransport` and fixed timestep
in a Web Worker (`session/worker/`), which posts per-tick deltas of the written components, fog masks
per generation and small facts on change; the main thread applies them to a `SnapshotMirror` and its
indexes, and interpolates by the tick arrival time. Probes and request-shaped reads answer Promises,
which the last-answer cache serves to synchronous HUD reads. Scenes, tests and the relayed entry
still run `inlineSessionHost` on the main thread, over the same mirror. 00 lands first. 05 moves the
relayed session into the worker and 06 surfaces the shortfall. 07 and 08 are the networking change and
can proceed in parallel. 09 to 11 close the epic. Contract edits land with the ticket that makes them
true: 05 rewrites the relayed-entry lines of `packages/app/AGENTS.md` and `packages/net-client/AGENTS.md`.

## Not in this epic

- Optimisation of individual sim systems or render layers. That work runs beside the epic and is
  measured on the 00 reference like everything else.
- Rendering in a worker (`OffscreenCanvas`).
- A server that runs the sim. Full state streaming is out on bandwidth alone. A relay-side sim as an
  always-synced member that judges digests and donates snapshots is a later option if 08 proves
  insufficient.
- A new save format. It enters only if 00 shows the resync snapshot too slow on a heavy map.

## Shared verification

Every ticket runs the gates in `docs/TESTING.md` and reports its numbers from the 00 reference. State
hashes and goldens change only where a ticket names the behaviour change; 05 and 06 name none.
