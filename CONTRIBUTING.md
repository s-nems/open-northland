# Contributing to Open Northland

Code, bug reports, platform testing, and documentation fixes are welcome.

## Keep game data out of Git

Open Northland is an independent implementation. Do not include any of the following in a commit,
pull request, or issue attachment:

- files from a *Cultures* installation or the CulturesNation mod;
- generated files from `content/`;
- extracted text, audio, screenshots, or temporary decoder dumps;
- copied or translated code from another engine implementation.

Format and behavior work must be based on an owned game copy, readable configuration, byte-level
evidence, published format specifications, or observation of the running game. See
[`docs/LEGAL.md`](docs/LEGAL.md) and [`docs/SOURCES.md`](docs/SOURCES.md).

## Set up the repository

Use Node.js 20.19.x or 22.12 and newer.

```bash
npm ci
npm run build
npm test
```

The normal development setup does not need game files. You only need an owned game copy to generate
playable content or test the asset pipeline. Those steps are in
[`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md).

## Before opening a pull request

Read [`AGENTS.md`](AGENTS.md). It is written for both contributors and coding agents and contains the
rules that protect determinism, content boundaries, and performance.

Run the standard gates:

```bash
npm run check
npm run build
npm test
```

Also run the narrowest relevant tests while working. Pipeline and real-content changes have extra
local gates described in [`docs/TESTING.md`](docs/TESTING.md).

Keep these points in mind:

- A golden hash changes only when behavior changes intentionally. Explain the change in the commit.
- Visual and audio work needs human inspection. A passing test cannot approve pixels or sound.
- Keep changes focused and remove dead code you encounter in the part you edit.
- Add player-visible behavior to an acceptance scene when practical.

CI runs formatting and build checks on Linux. The test suite runs on Linux, macOS, and Windows to
catch platform-specific determinism failures.

## Commits and tickets

Use a short [Conventional Commit](https://www.conventionalcommits.org/) message with a capitalized,
imperative description and no scope, for example `fix: Clamp path cost at map edge`.

Open work lives in [`docs/tickets/`](docs/tickets/). Each file describes one task. Before starting a
ticket, verify that its observations still match the code. Delete the ticket in the commit that
finishes it, or rewrite it to describe only the remaining work.

## License

By contributing, you confirm that the work is yours and license it under GPL-3.0-or-later.
