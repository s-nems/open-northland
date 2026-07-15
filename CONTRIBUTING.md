# Contributing to OpenNorthland

Thanks for your interest! Contributions of all kinds are welcome: code, bug reports, testing on
platforms we don't cover (especially Windows), and documentation fixes.

## Ground rules (legal — read this first)

OpenNorthland is an independent implementation. Its repository must stay free of copyrighted
game material, so **never** include in a PR, issue, or commit:

- **Original game assets** — no `.bmd`, `.cif`, `.pcx`, `.lib`, `.sgt`, `.dls`, `.fnt`, `.hlt`,
  sounds, or any file from a *Cultures* installation.
- **Decoded content** — anything generated under `content/` is derived from copyrighted data and is
  gitignored on purpose. Each player generates it locally from their own copy.
- **Third-party engine code** — do not copy or translate another implementation's source or
  architecture. Format work must be supported by the owned data files, published specifications,
  or observed game behavior.

PRs containing any of the above will be closed. The authoritative legal statement lives in
[`docs/LEGAL.md`](docs/LEGAL.md).

## Getting set up

Follow [Build and test](README.md#build-and-test) in the README. In short: Node ≥ 20.19,
`npm install`, and you can build, test, and develop the engine **without owning the game** — the
sim runs headless against synthetic fixtures. You only need your own copy of
*Cultures – 8th Wonder of the World* to generate playable content.

## Before you open a PR

1. Read [`AGENTS.md`](AGENTS.md) — it is the project contract (architecture rules, determinism
   rules, code style). The two rules newcomers trip over most:
   - **`packages/sim` is deterministic and pure**: no `Math.random`, `Date.now`, DOM, I/O, or
     float state. A hygiene test enforces this.
   - **Content is data, not code**: game rules and balance live in the validated IR under
     `content/`, not as hardcoded special cases.
2. Run the gates locally — CI runs the same ones on Linux, macOS, and Windows:

   ```bash
   npm run check   # Biome lint + format
   npm run build   # typecheck + production app bundle
   npm test        # Vitest, including determinism golden tests
   ```

3. **Golden hashes only move for intentional behavior changes.** If a golden test fails during a
   refactor, the refactor changed behavior — investigate, don't update the hash.
4. Keep new code in the style of the file around it.

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/), short imperative description,
capitalized, no scope: `feat: Add carrier idle animation`, `fix: Clamp path cost at map edge`.

## Where work is tracked

Open work lives in [`docs/tickets/`](docs/tickets/) — one self-contained task per file. Picking a
ticket is a great way to find a first contribution; feel free to open an issue to claim one or to
propose something new before investing significant time.

## AI agents

If you work with a coding agent, point it at [`AGENTS.md`](AGENTS.md) first (Claude Code, Codex CLI,
Cursor, and Gemini CLI pick it up automatically in this repo).

## License

OpenNorthland is licensed under **GPL-3.0-or-later**. By submitting a contribution you agree that it
is your own work and that you license it under the same terms.
