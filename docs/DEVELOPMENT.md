# Development reference

This page collects commands and local-only tools. The design rules live in [`AGENTS.md`](../AGENTS.md)
and the test strategy in [`TESTING.md`](TESTING.md).

## Common commands

```bash
npm ci                  # install the locked dependency set
npm run dev             # browser development server
npm run desktop         # Electron development build
npm run build           # typecheck and build the browser app
npm test                # normal Vitest suite
npm test -- scenario    # tests matching a name
npm run test:watch      # watch mode
npm run check           # Biome formatting and lint checks
npm run check:fix       # apply safe formatting and lint fixes
npm run check:docs      # validate documentation links and ticket metadata
```

Use `npm install` only when dependencies or the lockfile need to change.

## Local game content

Generate content from your own game installation:

```bash
npm run pipeline -- --game "../Cultures 8th Wonder" --out content
```

The pipeline detects `DataCnmd/` inside the game directory. Pass `--mod-root <dir>` when the
CulturesNation mod is unpacked elsewhere. The generated `content/` tree is ignored by Git.

Local content gates:

```bash
npm run test:content
npm run test:pipeline
```

`test:content` checks consumers against an existing `content/` directory. `test:pipeline` performs a
fresh conversion into a temporary directory and validates the result. It uses
`CULTURES_GAME_DIR` and, when needed, `CULTURES_MOD_ROOT`.

## Browser entries

`npm run dev` opens the main menu. Direct entries are useful during focused work:

| URL query | Purpose |
| --- | --- |
| `?scene=<id>` | registered deterministic acceptance scene |
| `?map=<id>` | decoded map |
| `?anim` | character animation gallery |
| `?icons` | decoded sprite-frame gallery |
| `?sounds` | sound-binding gallery |
| `?shot` | single-frame screenshot entry used by the harness |

Common modifiers include `lang=<pol|eng|ger|rus>`, `fog=<...>`, `player=<...>`, `ai=<...>`,
`sound=off`, and `postfx=off`. The main menu exposes normal settings, so direct query parameters are
mainly for reproducible diagnostics.

Debug modes:

- `debug=diag` records replay and state-hash diagnostics;
- `debug=perf` adds browser performance marks;
- `debug=trace` records a trace that can be exported for offline profiling.

## Screenshots and performance

Create a deterministic screenshot:

```bash
npm run shot -- --seed 7 --ticks 20 --out shot.png
```

Useful options are `--map <id>`, `--atlas [real]`, `--terrain`, `--zoom <n>`, and `--no-hud`.
Screenshots still need human review.

Run the synthetic simulation benchmark with `npm run bench:sim`. Its main controls are
`ON_BENCH_SETTLEMENTS`, `ON_BENCH_FIGHTERS`, `ON_BENCH_TICKS`, `ON_BENCH_WARMUP`, and
`ON_BENCH_JSON`.

The real-content long runs are `npm run soak:gatherers` and `npm run soak:bakery`. They are diagnostic
tools, not CI gates. Gatherer controls include `ON_SOAK_TICKS`, `ON_SOAK_MAP`,
`ON_SOAK_SAMPLE_EVERY`, and `ON_SOAK_STALL_TICKS`.

## Desktop packaging

```bash
npm run desktop
npm run desktop:dist
```

The packaged app stores generated content in the user's application-data directory. It never writes
playable content into the repository or application bundle.
