# Architecture

Open Northland has a headless simulation, a browser renderer, and an offline content pipeline. The
boundaries are deliberate: game rules must be testable without a browser, and generated game data
must remain outside the repository.

## Package flow

```text
owned game files
       |
       v
asset-pipeline -> generated content -> content-resolver -> app / desktop
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
- `packages/app` owns browser input, menus, HUD, the fixed-timestep loop, and package wiring.
- `packages/content-resolver` maps content URLs to the generated directory for both web and desktop
  hosts.
- `packages/desktop` serves the browser build through Electron and runs first-use content setup.
- `tools/asset-pipeline` converts an owned game installation into local, validated content.

The app owns runtime orchestration: it advances the sim and hands snapshots and events to the sinks.
Audio shares pure camera and projection helpers from `@open-northland/render/data`; it does not own a
renderer or mutate the sim.

## Runtime data flow

External intent enters the simulation as serializable command envelopes. An envelope names the
authority it acts under - a human seat, an AI seat, authored setup, or the admin channel - and a seat
envelope can only carry the commands that seat may issue. The app calls `sim.enqueue(envelope)`, then
`sim.step()` admits each queued command its origin is entitled to, applies it, and runs the fixed
system schedule. Systems mutate their own world during the tick. Authored world assembly uses
`sim.enqueueSetup(command)`, and an imported log passes `parseCommandLog` before it drives a sim.

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
GUI files, and audio. Runtime packages load these through `packages/data` and
`packages/content-resolver`; the sim never parses original `.ini`, `.cif`, or binary files.

Synthetic fallback content under `packages/app/src/` keeps normal tests and development scenes
usable without copyrighted data. See [`DATA-FORMAT.md`](DATA-FORMAT.md).

## Saves and multiplayer

Persisted save/load and multiplayer are not implemented yet. The existing command log, deterministic
step, state hash, and snapshot boundary are useful foundations, but they do not define a finished
save format or network protocol.

A future save will need enough state for a fast load plus versioned input metadata. A future lockstep
mode will need command exchange and divergence detection. Both features must preserve the current
determinism rules rather than assuming replay alone solves persistence or synchronization.
