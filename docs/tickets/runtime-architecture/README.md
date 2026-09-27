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
- A relayed room runs at the pace its slowest member sustains: past two seconds of frames behind the
  relay governs the clock to that member's sustainable speed and everyone sees who limits it, as
  Spring, Age of Empires and Supreme Commander pace by the slowest machine. No free band: a
  competitive room cannot have a member seconds behind. The relay never holds the clock for a slow
  member; the kick vote stays.
- The sync digest stays stamped per tick. The disputed-tick forensics of 10 and the per-tick
  acknowledgement's load report rest on it; a cheaper digest splits its components, it does not
  widen its window.
- The desktop build is the primary target. Browser-only behaviour, such as a hidden tab, is verified
  and documented, not designed around.

## Order and dependencies

| Ticket | Outcome | Depends on |
| --- | --- | --- |
| [00 Heavy-load reference](00-heavy-load-reference.md) | The scenario, harness and measurements every other ticket verifies against | none |

The runtime reads the world through one host interface, `SessionHost` in `packages/app/src/session/`.
The `?map=` entry runs its `Simulation`, `LockstepDriver` over `LoopbackTransport` and fixed timestep
in a Web Worker (`session/worker/`), which posts per-tick deltas of the written components, fog masks
per generation and small facts on change; the main thread applies them to a `SnapshotMirror` and its
indexes, and interpolates by the tick arrival time. Probes and request-shaped reads answer Promises,
which the last-answer cache serves to synchronous HUD reads. The relayed entry's `RelayClient`, relay
link and world run in a network worker (`entries/relay/net-worker.ts`) that never holds its clock:
it keeps stepping and acknowledging, and sheds the transient events of ticks the main thread has not
taken. Scenes and tests run `inlineSessionHost` on the main thread, over the same mirror. The system
menu shows delivered against requested speed while two consecutive one-second windows deliver under
nine tenths of the requested ticks. A relayed room governed for a slow member runs every client at
the governed speed and names the limiter in the waiting panel. On a desync verdict both the diverged
and the reference member keep the disputed tick's digest fold inputs in their diagnostics bundle, and
`npm run diag -- diff` names the first entity and component that differ. A hidden browser tab's
behaviour is measured and stated in `docs/NETWORK.md` "Background windows". Zoom-out detail tiers left
the epic for the render backlog (`docs/tickets/render/zoom-out-detail-tiers.md`): they do not depend on
the sim rework. 00 closes the epic. Contract edits land with the ticket that makes them true.

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
hashes and goldens change only where a ticket names the behaviour change.
The browser and desktop measurements of the whole epic (frame p95, per-tick receive cost beside sim
time, boot and memory, in the local and the relayed session) are taken once, at the epic's end, on the
00 reference against `main` before the epic; no ticket takes them on its own.
