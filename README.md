<h1 align="center">
  <img src="docs/images/logo.webp" alt="Open Northland" width="520">
</h1>

[![CI](https://github.com/s-nems/open-northland/actions/workflows/ci.yml/badge.svg)](https://github.com/s-nems/open-northland/actions/workflows/ci.yml)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPLv3-blue.svg)](LICENSE)

Open Northland is an independent, cross-platform engine for *Cultures - 8th Wonder of the World*, a
Viking-era strategy game. It combines a deterministic TypeScript simulation, a PixiJS renderer, and
an offline asset pipeline.

The repository does not include game files or decoded assets. The maps, graphics, and audio come
from the free [CulturesNation](https://culturesnation.pl) community mod, which carries the game data
and is converted locally into a `content/` directory. The original game's own campaigns and tutorials
live in its packed archives and are not converted.

To test it out, try:
- [Browser-based build](https://game.opennorthland.org) (as a quick-access demo)
- [Desktop application builds](https://github.com/s-nems/open-northland/tags) (preferred distribution)

![A settlement rendered by Open Northland using locally decoded game data](docs/images/settlement.webp)

## Status

Open Northland is pre-alpha. The current build has a playable settlement economy, building,
gathering, production, progression, combat, fog, population systems, and a basic computer player.
It can load decoded maps and render terrain, buildings, settlers, effects, and the HUD.

Campaign scripting, save games, and multiplayer are not complete. Desktop development builds exist,
but stable signed releases do not. Current actionable work lives in [`docs/tickets/`](docs/tickets/).

## Requirements

- Node.js `^20.19.0` or `>=22.12.0`
- The free CulturesNation mod for playable content: `CnMod 1.3.2.zip` (about 570 MB) is the current
  verified input. Unpack it yourself and point `npm run pipeline` at it.

## Build and test

```bash
npm ci
npm run build
npm test
npm run check
```

The source, tests, and headless scene checks work without the original game. `npm run build`
typechecks the workspaces and creates the browser bundle in `packages/app/dist/`. The playable
browser entries need generated content (next section); without it they show a notice explaining how
to generate it.

## Generate local content

```bash
npm run pipeline -- --mod-root "../CNMod-1.3.2" --out content
npm run dev
```

`--mod-root` is the unpacked mod archive, the directory that holds `DataCnmd/`; a game folder with
the mod installed inside it works too. `--mod-version <label>` stamps the release so multiplayer
lobbies can compare it. A newer mod release must be verified before replacing the 1.3.2 baseline.

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
  desktop/           Electron shell serving the app and the converted content
  render/            PixiJS isometric renderer
  sim/               Deterministic simulation
tools/
  asset-pipeline/    Converts the CulturesNation mod into local content
content/             Generated locally and ignored by Git
docs/                Design notes, format research, and open tickets
```

Start with the [documentation index](docs/README.md) for the design and data flow.

## Contributing

Contributions are welcome. Read [`CONTRIBUTING.md`](CONTRIBUTING.md) before opening a pull request.
Coding agents must also read [`AGENTS.md`](AGENTS.md).

## License and trademarks

Open Northland is licensed under AGPL-3.0-or-later. See [`LICENSE`](LICENSE).

This is an independent community project. It is not affiliated with or endorsed by Funatics
Software, Daedalic Entertainment, or another rights holder of the *Cultures* series. Game names are
used only to describe compatibility. The full notice is in [`docs/LEGAL.md`](docs/LEGAL.md).
