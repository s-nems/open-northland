# Testing

Use the lowest test layer that proves the behavior. Normal development should stay independent of an
owned game installation; real-content and pipeline tests are separate local gates.

## Standard gates

```bash
npm run check
npm run build
npm test
```

`npm test` runs the normal Vitest projects, including simulation hygiene, deterministic state hashes,
integration tests, and headless acceptance scenes. CI runs this suite on Linux, macOS, and Windows.
Formatting and production build checks run once on Linux.

During development, narrow the test command by name:

```bash
npm test -- scenario
npm run test:watch
```

## Test layers

1. Unit tests cover pure helpers, decoders, schemas, and individual rules.
2. Integration tests run a small set of systems or a command path through a real `Simulation`.
3. Headless scenarios prove a player-visible chain over several ticks.
4. Browser scenes let a human inspect rendering, animation, input, and sound.

Do not use a browser scene to replace a cheap state assertion. Do not claim visual or audio
correctness from a headless test.

## Scenario harness

The simulation harness queues commands, advances ticks, and checks the resulting world:

```ts
const result = scenario(content)
  .command({ kind: 'placeBuilding', buildingType: 1, x: 4, y: 6, tribe: VIKING, owner: 0 })
  .run(20)
  .expect('building was placed', (sim) => {
    // Return the smallest state assertion that proves the behavior.
    return hasExpectedBuilding(sim);
  });

result.assertOk();
```

Use the actual public command path when the test is about player input. Direct component setup is
appropriate for a narrow system fixture or pre-tick scene setup.

## Determinism and goldens

The same seed and inputs must produce the same state hash. Relevant tests also compare repeated runs,
replays, and atomic-action traces.

A golden is a tripwire, not a snapshot to refresh automatically. When it changes:

1. confirm the behavior change was intended;
2. inspect the smaller trace or state difference that explains it;
3. update the expected value in the same commit;
4. name the behavior change in the commit message or ticket.

A golden change during a claimed refactor means the refactor changed behavior.

The sim hygiene test rejects browser and I/O imports, nondeterministic globals, and other boundary
violations in `packages/sim/src`.

## Acceptance scenes

Registered scenes use the same setup for a headless test and a browser run. Add one for a
player-visible mechanic when it provides useful final acceptance. The process is documented in
[`SCENES.md`](SCENES.md).

## Real-content test modes

These commands need local game data and do not run in CI:

```bash
npm run test:content
npm run test:pipeline
```

`test:content` validates code paths that consume an existing generated content set. Use it for
loaders, id joins, overlay behavior, or scenarios based on real extracted rows.

`test:pipeline` performs a fresh conversion into a temporary directory and runs the real-content
checks against that result. Use it for source parsing, schemas, decoders, map conversion, and output
layout changes. It reads `CULTURES_GAME_DIR` and optional `CULTURES_MOD_ROOT`.

Tests must skip cleanly when local content is deliberately unavailable. Synthetic fixtures remain the
committed regression tests.

## Visual and audio checks

Use the deterministic screenshot harness for a stable scene input:

```bash
npm run shot -- --seed 7 --ticks 20 --out shot.png
```

Options include `--map <id>`, `--atlas [real]`, `--terrain`, `--zoom <n>`, and `--no-hud`.

The PNG is not an automatic pass. GPU output is not treated as byte-stable across machines, and a
human still needs to judge composition, animation, clipping, and fidelity. Sound changes likewise
need listening in a browser or desktop build.

## Benchmarks and long runs

`npm run bench:sim` reports per-system and whole-tick timing for a synthetic RTS-scale world. It also
checks that repeated benchmark runs end at the same hash. Absolute timing is machine-dependent, so
compare runs on the same machine and look at scaling as population changes.

`npm run soak:gatherers`, `npm run soak:bakery`, and `npm run soak:late-goods` run long real-content
economy diagnostics. They can find late stalls but are not regression gates by themselves. Reduce a
discovered failure to a focused test once its cause is understood.

See [`DEVELOPMENT.md`](DEVELOPMENT.md) for benchmark and soak controls.

## Choosing the required checks

- Documentation-only work: `npm run check:docs`, `npm run check`, and any relevant link or example
  inspection.
- Normal code: standard gates.
- Sim behavior: standard gates plus a focused determinism or scenario test.
- Pipeline or schema: standard gates plus `npm run test:pipeline`.
- Real-content consumers: standard gates plus `npm run test:content` when local content exists.
- Visual or audio work: matching automated checks plus a stated human review step.
