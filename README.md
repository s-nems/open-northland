# Vinland

**Vinland** is an open-source, cross-platform reimplementation of the settler/colony game
**Cultures – 8th Wonder of the World** (successor lineage: *Cultures 2 / Northland / Die Sage der
Wikinger*). It is a fresh engine — a deterministic simulation, an isometric renderer, and an offline
pipeline that converts your own copy of the original game's data into a modern, readable format —
not a binary-faithful clone. Where the original is buggy or unbalanced, Vinland is free to fix it.

> **You need to own the original game.** Vinland ships **no game assets**. To play, you point the
> asset pipeline at your own legally-owned copy of *Cultures – 8th Wonder of the World*. This is the
> same model used by [OpenMW](https://openmw.org/), [OpenRA](https://www.openra.net/) and
> [devilutionX](https://github.com/diasurgical/devilutionX). See [Legal](#legal).

> **Working title.** "Vinland" is the Norse name for the lands settled westward — a nod to
> *Wyprawa na Północ*. The name is provisional and can change.

## What it is (and isn't)

- **Is:** a fresh, deterministic colony simulation in TypeScript; an isometric PixiJS renderer; and
  an offline pipeline that decodes the original's `.cif` / `.bmd` / `.pcx` / `.lib` / `.ini` files
  into a versioned, diffable intermediate format (JSON + texture atlases).
- **Is not:** a binary-faithful re-implementation. The companion
  [`OpenVikings_reversing`](https://github.com/Ravo92/OpenVikings_reversing) project *is*
  binary-faithful; we consult it as **file-format documentation**, never as a code dependency and
  never by porting its architecture. It is **optional** — you do not need it to build, test, or play
  Vinland; it's only a reference for contributors working on the asset pipeline.

## Status

Single-tribe economy running end-to-end. The deterministic sim core, the asset pipeline (including
`.cif` decode), and a self-sustaining one-tribe settlement — settlers executing atomic actions, a
goods economy, a progression/tech graph, and population growth — all run headless and deterministic.
The current target is **Phase 4: N-tribe conflict and content breadth**; combat, the five playable
tribes, and animals-as-tribes already have their substance landed. Several render/pixel checks stay
human-gated (an agent can't self-judge pixels). See [`docs/ROADMAP.md`](docs/ROADMAP.md) for the
phased plan and current target.

## Getting started

**Requirements:** [Node.js](https://nodejs.org/) ≥ 20, and — to actually generate content or play —
your own legally-owned copy of *Cultures – 8th Wonder of the World* (the readable
`culturesnation` mod data is preferred where available; see
[`docs/DATA-FORMAT.md`](docs/DATA-FORMAT.md)).

```bash
npm install                 # one-time, installs all workspaces
npm run build               # typecheck/build all packages
npm test                    # headless sim tests (determinism golden tests)
npm run check               # Biome lint + format check (what CI runs)
```

You can build, test and develop the engine **without** the game — the sim runs headless against a
synthetic fixture. To turn real game data into playable content, point the pipeline at your copy:

```bash
# Decode YOUR owned game data into the intermediate format under content/ (gitignored):
npm run pipeline -- --game "../Cultures 8th Wonder" --mod DataCnmd --out content

npm run dev                 # launch the app (Vite) in a browser
```

Useful URL flags on the dev app: `?scene=all-buildings` runs an acceptance scene with its checklist
overlay, and **`?anim`** opens the character **animation gallery**. Bare `?anim` (no params) lands on the
**full-roster montage** — every viking look walking on one screen. Add `?char=<id>` to drill into one body's
animations (civilian / **warrior** with its broadsword / sword / bow / spear / bare-handed set / woman /
children / baby), and `?char=<id>&view=heads` for that body's **heads/looks montage** (the same walk once per
head, so you see every face/hat). A direction selector validates the locomotion set in all 8 facings;
single-direction animations (eat/sleep/wait, attacks) play their full loop. Needs decoded `content/`.

`--game` is the path to your game-install folder; the example assumes you placed it **next to this
repo** (`../Cultures 8th Wonder`), but any absolute or relative path works. `--mod DataCnmd` selects
the readable `culturesnation` mod data that ships with the game — it's preferred because its rules
are plain `.ini` rather than encrypted `.cif` (see [`docs/DATA-FORMAT.md`](docs/DATA-FORMAT.md)).

Desktop builds (macOS / Windows / Linux) come later via Tauri; the app is browser-first so it is
cross-platform from day one.

## Repository layout

```
vinland/
├── packages/
│   ├── sim/      # deterministic simulation core (ECS). No rendering, no DOM. The heart.
│   ├── data/     # intermediate-format schemas (zod) + loaders. Shared content model.
│   ├── render/   # PixiJS isometric renderer. Reads sim snapshots, draws.
│   └── app/      # game shell: wires sim+render+input, menus, main loop (Vite).
├── tools/
│   └── asset-pipeline/  # offline CLI: original .cif/.bmd/.pcx/.lib/.ini -> content/ (PNG+JSON)
├── content/     # GENERATED intermediate assets (gitignored — derived from YOUR game copy)
└── docs/        # architecture, ECS, data format, roadmap, sources
```

Why the split: the **sim** package has zero rendering dependencies, so it runs headless under
`vitest`. That makes mechanics verifiable without a screen, and keeps the simulation deterministic
and lockstep-friendly. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and
[`docs/ECS.md`](docs/ECS.md).

## Documentation

[`docs/README.md`](docs/README.md) indexes everything and gives the reading order. The essentials:

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — the big picture and package boundaries
- [`docs/ECS.md`](docs/ECS.md) — the entity-component-system and atomic-action planner
- [`docs/DATA-FORMAT.md`](docs/DATA-FORMAT.md) — the intermediate content format (IR)
- [`docs/TESTING.md`](docs/TESTING.md) — the determinism / self-validation test pyramid
- [`docs/SCENES.md`](docs/SCENES.md) — acceptance scenes (watch a mechanic, sign off)
- [`docs/FIDELITY.md`](docs/FIDELITY.md) — is the rebuild *faithful*, not just self-consistent?
- [`docs/SOURCES.md`](docs/SOURCES.md) — original file formats and the (canonical) legal posture
- [`docs/PRIOR-ART.md`](docs/PRIOR-ART.md) — practices from other engine reimplementations: adopted / deferred / consciously different
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — the phased plan and current target

## Contributing

Contributions are welcome. Keep new code in the style of the file around it, keep the `sim` package
deterministic and pure, and run `npm run check && npm test` before opening a PR. Agents working in
this repo should read [`AGENTS.md`](AGENTS.md) first — it is the contract for conventions, the
determinism rules, and the legal guardrails.

## Legal

> The authoritative statement of the project's legal posture is
> [`docs/SOURCES.md`](docs/SOURCES.md) (**Legal line**); this section restates it for readers.

**License.** Vinland is free software, released under the **GNU General Public License v3.0 (or
later)** (`GPL-3.0-or-later`). See [`LICENSE`](LICENSE). Vinland is distributed in the hope that it will be useful, but
**without any warranty**; see the license for details.

**No game content.** This repository contains **no original game assets** and no copyrighted content
from the *Cultures* series. It ships engine source code only. The generated `content/` directory
(decoded sprites, rules, maps) is produced locally from **your own legally-owned copy** of the game
and is never committed.

**Trademarks.** *Cultures – 8th Wonder of the World*, *Cultures*, and related names and logos are
trademarks or registered trademarks of their respective owners (Funatics Software GmbH and/or its
licensors). They are used here only descriptively, to state what Vinland is compatible with.

**Disclaimer.** Vinland is an independent, fan-made project. It is **not affiliated with, authorized
by, endorsed by, or in any way associated with** Funatics Software GmbH or any other rights holder
of the *Cultures* series. All trademarks and copyrights remain the property of their respective
owners.
