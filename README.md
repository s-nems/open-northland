<h1 align="center">
  <img src="docs/images/logo.webp" alt="Open Northland" width="520">
</h1>

[![CI](https://github.com/s-nems/open-northland/actions/workflows/ci.yml/badge.svg)](https://github.com/s-nems/open-northland/actions/workflows/ci.yml)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)

Open Northland is an independent, cross-platform engine for the Viking-era *Cultures* strategy
games. It combines a deterministic TypeScript simulation, a PixiJS renderer, and an offline asset
pipeline.

The repository does not include game files or decoded assets. To play with the original maps,
graphics, and audio, provide your own copy of *Cultures - 8th Wonder of the World* and generate a
local `content/` directory.

![A settlement rendered by Open Northland using locally decoded game data](docs/images/settlement.webp)

## Status

Open Northland is pre-alpha. The current build has a playable settlement economy, building,
gathering, production, progression, combat, fog, population systems, and a basic computer player.
It can load decoded maps and render terrain, buildings, settlers, effects, and the HUD.

Campaign scripting, save games, multiplayer, and desktop distribution still need work. The open
work is tracked in [`docs/tickets/`](docs/tickets/).

## Requirements

- Node.js 20.19.x or 22.12 and newer
- A legally obtained copy of *Cultures - 8th Wonder of the World* for playable content

## Build and test

```bash
npm ci
npm run build
npm test
npm run check
```

The source, tests, and synthetic scenes work without the original game. `npm run build` typechecks
the workspaces and creates the browser bundle in `packages/app/dist/`.

## Generate local content

```bash
npm run pipeline -- --game "../Cultures 8th Wonder" --out content
npm run dev
```

The pipeline also needs the free [CulturesNation](https://culturesnation.pl/) mod. It detects a
`DataCnmd/` folder inside the game directory. If the mod is elsewhere, add `--mod-root <dir>`.

Generated content is ignored by Git. Do not commit or redistribute it.

The development server opens on the main menu. Useful direct entries are:

- `?scene=sandbox` for the main acceptance scene
- `?map=<id>` for a decoded map
- `?anim` for character animations
- `?icons` for decoded sprite frames
- `?sounds` for the sound gallery

See [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) for commands, diagnostics, and local content tests.

## Repository layout

```text
packages/
  app/               Browser shell, input, menus, HUD, and scenes
  audio/             Sound selection and Web Audio playback
  content-resolver/  Shared routing for generated content
  data/              Validated schemas and content loaders
  desktop/           Electron shell and first-run content setup
  render/            PixiJS isometric renderer
  sim/               Deterministic simulation
tools/
  asset-pipeline/    Converts an owned game installation into local content
content/             Generated locally and ignored by Git
docs/                Design notes, format research, and open tickets
```

Start with the [documentation index](docs/README.md) for the design and data flow.

## Contributing

Contributions are welcome. Read [`CONTRIBUTING.md`](CONTRIBUTING.md) before opening a pull request.
Coding agents must also read [`AGENTS.md`](AGENTS.md).

## License and trademarks

Open Northland is licensed under GPL-3.0-or-later. See [`LICENSE`](LICENSE).

This is an independent community project. It is not affiliated with or endorsed by Funatics
Software, Daedalic Entertainment, or another rights holder of the *Cultures* series. Game names are
used only to describe compatibility. The full notice is in [`docs/LEGAL.md`](docs/LEGAL.md).
