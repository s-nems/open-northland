# Vinland

An open-source, cross-platform engine and rebuild of **Cultures – 8th Wonder of the World**
(successor lineage: Cultures 2 / *Northland* / *Die Sage der Wikinger*), with cleaned-up,
re-tunable mechanics.

> **Working title.** "Vinland" = the Norse name for the lands they explored and settled
> westward/northward — a nod to *Wyprawa na Północ*. Rename freely.

## What this is (and isn't)

- **Is:** a fresh, deterministic settler/colony simulation written in TypeScript, plus an
  isometric renderer, plus an offline pipeline that converts the *original* game's data into a
  modern, readable intermediate format.
- **Is not:** a binary-faithful re-implementation. Where the original is buggy or unbalanced,
  we fix it. The companion `../OpenVikings_reversing` project *is* binary-faithful and we use it
  as **format documentation**, not as a code dependency.

## Legal

This repository contains **no original game assets** and no copyrighted content from Funatics /
Daedalic. To play, you point the asset pipeline at your own legally-owned copy of the game
(`../Cultures 8th Wonder`). Same model as OpenRA / OpenTTD / OpenVikings. See [`docs/SOURCES.md`](docs/SOURCES.md).

## Repository layout

```
vinland/
├── packages/
│   ├── sim/      # deterministic simulation core (ECS). No rendering, no DOM. The heart.
│   ├── data/     # intermediate-format schemas (zod) + loaders. Shared content model.
│   ├── render/   # PixiJS isometric renderer. Reads sim snapshots, draws.
│   └── app/      # game shell: wires sim+render+input, menus, main loop (Vite).
├── tools/
│   └── asset-pipeline/  # offline CLI: original .bmd/.pcx/.lib/.ini/.cif -> content/ (PNG+JSON)
├── content/     # GENERATED intermediate assets (gitignored — derived from your game copy)
└── docs/        # architecture, ECS, data format, roadmap, sources
```

Why the split: the **sim** package has zero rendering dependencies so it runs headless under
`vitest`. That makes mechanics agent-verifiable without a screen — see [`docs/ECS.md`](docs/ECS.md).

## Quickstart

```bash
npm install                 # one-time, installs all workspaces
npm run build               # typecheck/build all packages
npm test                    # headless sim tests (determinism golden tests)

# Convert your owned game data into the intermediate format:
npm run pipeline -- --game "../Cultures 8th Wonder" --mod DataCnmd --out content

npm run dev                 # launch the app (Vite) in a browser
```

Desktop builds (Mac/Windows/Linux) come later via Tauri — the app is browser-first so it is
cross-platform from day one.

## Status

Foundation / scaffolding. See [`docs/ROADMAP.md`](docs/ROADMAP.md) for the phased plan and the
current vertical-slice target.

## For agents

Read [`CLAUDE.md`](CLAUDE.md) before working here. It covers conventions, the determinism rules,
and where the reference projects live.
