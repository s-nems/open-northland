# Architecture

Open Northland has a headless simulation, a browser renderer, and an offline content pipeline. The
boundaries are deliberate: game rules must be testable without a browser, and decoded game data stays
outside the repository; a release converts it once and ships it inside the build artifacts.

## Package flow

```text
CulturesNation mod
       |
       v
asset-pipeline -> generated content -> app / desktop
                                  commands |
                                           v
            data schemas/loaders ->       sim
                                                        |
                                      snapshots + events
                                                        v
                                                render / audio / HUD
```

- `packages/sim` owns mutable world state and game rules. It has no browser, file-system, or
  renderer dependency.
- `packages/data` owns the validated content schemas and loaders.
- `packages/render` turns simulation snapshots into a PixiJS scene. It does not mutate the sim.
- `packages/audio` chooses sounds from snapshots and events, then plays them through Web Audio.
- `packages/lockstep` describes a session as serializable data and drives one client of it: it
  decides when a tick may run and which command envelopes it carries. It depends on `sim` alone, so
  the same driver runs in a browser, in Electron, and in a headless Node client.
- `packages/net-protocol` is the lockstep wire protocol: message catalogue, limits, the parser for
  each direction, and the client-side transport that turns relay frames into the driver's input. It
  has no runtime dependency; the descriptor and the command payload cross it as opaque JSON that
  their owners validate.
- `packages/net-client` is one client of a relayed session: the lobby walk, the world port a host
  supplies, the relay socket with its reconnects, and the pacing that keeps a jitter buffer. The
  browser, Electron and the headless test client share it.
- `packages/net-server` is the relay a networked game runs through: rooms, seats, identities, the
  tick clock, and command frames. It holds no content and runs no simulation. The contract is
  `docs/NETWORK.md`.
- `packages/app` owns browser input, menus, HUD, the frame loop, and package wiring.
- `packages/desktop` serves the browser build and the converted content through Electron.
- `deploy/web` serves the same two trees through nginx; that image is the web app.
- `tools/asset-pipeline` converts the CulturesNation mod into the validated content tree.

The app owns runtime orchestration: it advances the sim and hands snapshots and events to the sinks.
Audio shares pure camera and projection helpers from `@open-northland/render/data`; it does not own a
renderer or mutate the sim.

## Runtime data flow

External intent enters the simulation as serializable command envelopes. An envelope names the
authority it acts under - a human seat, an AI seat, authored setup, or the admin channel - and a seat
envelope can only carry the commands that seat may issue. The HUD hands an envelope to the session
driver, which submits it to a transport; the transport decides which tick it applies at and where it
sits in that tick, and the driver runs a tick only once that tick's inputs are complete. `sim.step()`
admits each queued command its origin is entitled to, applies it, and runs the fixed system schedule.
A tick applies the world's own untargeted emissions first - an AI seat's commands, authored setup -
then the session's stamped input. Single-player runs the same driver over an in-process loopback
transport; a networked game runs it over `RelayTransport`, whose frames the relay assigned. Systems
mutate their own world during the tick. Authored world assembly uses
`sim.enqueueSetup(command)`; `parseCommandLog` is the validator an importer of untrusted replay or
diagnostics JSON has to run before that log drives a sim.

At the tick boundary, `sim.snapshot()` returns a detached plain-data view for rendering, audio, HUD,
and diagnostics. It is memoized while the world is unchanged. Consumers treat it as read-only, but
it is not recursively frozen at runtime.

One-shot simulation events share the same boundary. Presentation code may react to an event, but it
must not reach back into live component stores.

```text
input -> enqueue envelopes -> authorize + step systems -> snapshot + events -> render/audio/HUD
```

This keeps tests and replays independent of frame rate and prevents the renderer from observing a
partly updated tick.

## Time and determinism

The simulation runs at 12 ticks per second by default. The app accumulates elapsed display time,
runs whole simulation ticks, and interpolates presentation between tick states.

A tick may depend only on previous simulation state, queued commands, immutable content, map input,
and the seeded RNG. Simulation state uses fixed-point integers. Wall-clock time, DOM state, file I/O,
and renderer state never enter the result.

The full contract is in [`../packages/sim/AGENTS.md`](../packages/sim/AGENTS.md).

## Content boundary

The pipeline writes one validated rules document at `content/ir.json`, plus decoded maps, atlases,
GUI files, audio, and the `maps-index.json`/`bobs-index.json` listings, laid out exactly as the app
fetches them, so every host serves the tree as static files. A release runs the pipeline once over
the pinned CulturesNation archive and packs the tree into the desktop installers and the web image;
nothing is converted on a player's machine. Runtime packages validate what they load through
`packages/data`; the sim never parses original `.ini`, `.cif`, or binary files.

Synthetic fallback content under `packages/app/src/` keeps normal tests and development scenes
usable without copyrighted data. See [`DATA-FORMAT.md`](DATA-FORMAT.md).

## Saves and multiplayer

A save is the sim's exported state plus the untargeted commands still queued; `exportSaveGame` and
`restoreSimulation` round-trip to an identical hash. A networked session is server-paced lockstep
over the relay: every client runs the full sim, the relay owns the clock and the order of commands,
and the same save format is the resync primitive. The wire contract is `docs/NETWORK.md`.
