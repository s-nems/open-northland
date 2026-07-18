# Architecture

## Goals, in priority order

1. **Faithful *feel*, fixable *rules*.** Reproduce the soul of Cultures — every settler is an
   individual executing **atomic actions** driven by needs, a deep goods economy, a data-driven
   progression/tech graph, and **N-tribe** conflict (the data defines viking/frank/saracen/
   byzantine/egypt + animals-as-tribes) — while being free to correct bugs and rebalance. The
   behavior model is detailed in docs/ECS.md; do not picture this as a conventional RTS.
2. **Deterministic simulation.** Same seed + same inputs ⇒ identical state. Enables headless
   tests, replays, and lockstep multiplayer.
3. **Agent-legible.** Small, typed, dependency-light code. Rules live in data. A model should be
   able to read a system and a content file and understand a mechanic end-to-end.
4. **Cross-platform from day one.** Browser-first (Mac/Win/Linux). Desktop distribution wraps the
   same build in Electron (`packages/desktop`) — chosen over Tauri because the shell embeds the
   Node asset pipeline as-is and a WebGL game needs one predictable Chromium instead of three OS
   webviews.

## Layered design

```
        ┌──────────────────────────────────────────────────────────────────────┐
        │  app  (Vite)                                                         │
        │  main loop · input · menus · save/load glue                          │
        └──────┬───────────────────────────┬───────────────────────────┬───────┘
               │ commands                  │ snapshots                 │ snapshots + events
               ▼                           ▼                           ▼
   ┌────────────────────────┐  ┌────────────────────────┐  ┌────────────────────────┐
   │  sim (headless, pure)  │  │  render  (PixiJS)      │  │  audio  (Web Audio)    │
   │  ECS · systems · RNG   │  │  isometric · sprites   │  │  positional SFX · beds │
   │  fixed-point · ticks   │  │  reads snapshots only  │  │  jingles · chatter     │
   └───────────┬────────────┘  └───────────┬────────────┘  └───────────┬────────────┘
               │ loads                     │ loads                     │ loads
               ▼                           ▼                           ▼
        ┌──────────────────────────────────────────────────────────────────────┐
        │  data   (zod schemas + IR loaders)                                   │
        │  the shared content model                                            │
        └──────────────────────────────────┬───────────────────────────────────┘
                                           │ produced by
                                           ▼
        ┌──────────────────────────────────────────────────────────────────────┐
        │  tools/asset-pipeline  (offline CLI)                                 │
        │  original .bmd/.pcx/.lib/.ini/.cif → content                         │
        └──────────────────────────────────────────────────────────────────────┘
```

### The one-way data flow at runtime

`app` advances the `sim` by feeding it **commands** (player orders, e.g. "place house here") on a
fixed tick. **Commands are the only way state mutates** and they are serializable — so a save is a
command log (replay) plus a snapshot (fast load). After each tick the sim exposes a stable
**snapshot read-view** (double-buffered or immutable) that `render` consumes and **interpolates**
between the last two ticks for smooth motion. `render` never mutates sim state and the sim never
imports render, and the renderer must never read live mid-mutation state — hence the explicit
snapshot contract that lives alongside `CommandSystem`. This strict boundary keeps the sim
deterministic and testable and lets us run it faster-than-realtime in tests (see docs/TESTING.md).

### Fixed timestep

The sim runs at a fixed rate (default **12 ticks/s**). The app uses an accumulator: render as fast
as the display allows, step the sim a whole number of ticks per frame, interpolate the remainder.
See `packages/sim/src/core/loop.ts`. Determinism requires that a tick's outcome depends only on prior
state + commands + RNG — never on wall-clock or frame rate.

## Why these technology choices

| Choice | Reason | Rejected alternative |
|---|---|---|
| **TypeScript** | Types are the single biggest lever for agent-assisted refactoring; strict mode catches whole error classes. | Plain JS (no types), Java (heavier tooling, less LLM-ergonomic) |
| **Browser-first + Vite** | Cross-platform for free; instant Mac support; HMR dev loop. | Native-only (SDL/.NET) — Mac friction, slower iteration |
| **PixiJS** (render only) | WebGL batched sprites handle thousands of animated settlers; we keep full control of the game layer. | Phaser (imposes its own game model we don't want) |
| **Custom tiny ECS** | Full control of iteration order (determinism) and maximum legibility. | bitecs (terse, hard to read), miniplex (less control over ordering) |
| **zod schemas** | One source of truth → runtime validation *and* inferred TS types for content. | Hand-written types + separate validators (drift) |
| **Fixed-point sim math** | Guarantees identical results across platforms for lockstep/replay. | Floats in sim (nondeterminism risk across CPUs/builds) |
| **npm workspaces** | Zero extra global install; works out of the box with Node. | pnpm/yarn (extra setup friction for an agent) |

## Package responsibilities

- **`sim`** — owns world state and the rules engine. Knows nothing about pixels or files. Exposes:
  create world from a loaded content set + map + seed; `step(commands)`; read snapshot. All game
  domains (terrain, needs, jobs, production, transport, construction, reproduction, combat, AI,
  pathfinding) are **systems** here. See `docs/ECS.md`.
- **`data`** — defines the **intermediate representation (IR)**: zod schemas for every content type
  and the sprite/animation/map manifests, plus typed loaders. Imported by both `sim` (rules) and
  `render` (which sprite for which entity). See `docs/DATA-FORMAT.md`.
- **`render`** — turns a sim snapshot into an isometric scene: terrain tiles, sorted sprite draw,
  animation playback, camera, picking. Pure consumer.
- **`audio`** — plays the decoded original sounds from the same read-only snapshot + one-shot sim
  events `render` consumes (never reaching into sim state): positional on-screen action SFX,
  ambient terrain beds, life-event jingles, and settler voice chatter. Split like `render`: a pure
  decision layer (`src/data/`, event mapping under `src/data/director/`) and an impure Web Audio
  sink (`src/web/`, engine under `src/web/engine/`).
- **`app`** — the shell. Owns the main loop, translates input into sim commands, draws menus/HUD,
  wires save/load. The only package that depends on everything.
- **`content-resolver`** — the one table mapping the app's content URLs (`/maps`, `/bobs`, `/ir.json`,
  the `/maps-index` + `/bobs-index` payloads, …) onto the generated `content/` tree, with traversal
  and extension guards. Node-side, consumed by the Vite dev middleware and the desktop shell so the
  two hosts cannot drift.
- **`desktop`** — the Electron shell for players: serves the built `app` + `content-resolver` over its
  `app://` protocol, and on first run converts the user's owned game copy with the asset pipeline
  (forked as a `utilityProcess`) into a per-user data root. electron-builder packages it as Windows
  NSIS/portable, macOS dmg, Linux AppImage. See `packages/desktop/AGENTS.md`.
- **`tools/asset-pipeline`** — offline, run by a human/agent against an owned game copy. Decodes
  original formats (including encrypted `.cif`) into `content/`. Decoders are covered by synthetic
  fixtures and structural checks; visual output is compared with the running original when needed.
  Format notes live under `docs/formats/`.

## Save / load & multiplayer (forward-looking, not yet built)

Because the sim is deterministic and command-driven, a save is `{ seed, contentVersion, map,
commandLog }` for replay **plus a state snapshot for fast load** (replaying hours of ticks is
unviable). Multiplayer is lockstep: exchange commands, everyone runs the same deterministic sim.
We don't build the disk format yet, but the load-bearing invariants — commands-only mutation, a
serializable command schema, and the snapshot read-view — are **already established**, not
deferred. Every sim decision must preserve the property that makes save/MP cheap. Don't add
nondeterminism "just for now."
