# Testing

Use the lowest test layer that proves the behavior. Normal development should stay independent of the
mod archive; real-content and pipeline tests are separate local gates.

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
replays, and atomic-action traces. `hashState()` walks every component of every entity, so it is the
golden and the rare cross-check; `Simulation.setSyncDigest` turns on the per-tick alternative, which
folds only what a tick changed and names the domain two runs parted in. The fuzz suite additionally
round-trips a save (export, restore, hash and byte compare) at every checkpoint, so new mutable sim
state that misses a save section fails there in the commit that adds it.

A golden is a tripwire, not a snapshot to refresh automatically. When it changes:

1. confirm the behavior change was intended;
2. inspect the smaller trace or state difference that explains it;
3. update the expected value in the same commit;
4. name the behavior change in the commit message or ticket.

A golden change during a claimed refactor means the refactor changed behavior.

The committed save fixture (`packages/sim/test/fixtures/save.golden`) follows the same rule;
`UPDATE_SAVE_FIXTURE=1 npx vitest run packages/sim/test/save/fixture.test.ts` rewrites it once the
change is confirmed intentional. A save-layout change also bumps `SAVE_FORMAT_VERSION` in the same
commit; older layouts are not migrated, so nothing else is kept.

The sim hygiene test rejects browser and I/O imports, nondeterministic globals, and other boundary
violations in `packages/sim/src`.

## Cross-engine determinism

Every determinism proof above runs in one Node process. Lockstep multiplayer needs the same state
from every JavaScript engine that ships the game, so this mode boots the app in each engine, pauses
the session, steps the sim through the same `window.__opennorthland` handle the performance probes
use, and compares the state-hash sequence with a Node run of the same world:

```bash
npm run test:engines                              # Electron, Chromium, WebKit, Firefox
ON_ENGINES=electron,chromium npm run test:engines # a subset
```

It needs generated content (the browser entries halt without it), a built workspace (the runner
builds it), and the Playwright browsers of the repository's Playwright version: `npm ci` installs
none of them, so run `npx playwright install chromium webkit firefox` once; Electron comes with the
desktop package. Electron and Chromium are gates, so a mismatch fails the run. WebKit and Firefox
are informative: their verdict is printed, never asserted, and a divergence there is filed as a sim
ticket naming the first diverging tick. An unknown or empty `ON_ENGINES` selection fails the run
instead of passing with nothing compared.

The workloads are the `sandbox` scene over its acceptance run, hashed every 20 ticks, and 2000 ticks
of `magiczny_las` with six AI seats, hashed every 100 because a full hash of that world is slow. A
divergence names the first compared tick that differs. `ON_CONTENT_DIR` is refused: the app serves
the checkout's `content/` only.

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
loaders, id joins, overlay behavior, or scenarios based on real extracted rows. The relayed-session
runs in it play a few hundred ticks by default; `ON_RELAY_TICKS=10000` lengthens them for a
change to the relay or the lockstep seams.

`test:pipeline` performs a fresh conversion into a temporary directory and runs the real-content
checks against that result. Use it for source parsing, schemas, decoders, map conversion, and output
layout changes. It reads the unpacked mod at `CULTURES_MOD_ROOT`, `../CNMod-1.3.2` by default.

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

`npm run bench:sim` reports per-system and whole-tick timing for a synthetic RTS-scale world. Its
world has independent knobs and no generated content, so it runs on any checkout. It also checks that
repeated benchmark runs end at the same hash.

`npm run bench:map` reports the same per-system timing for a real decoded map with AI seats, cut into
windows so a system whose cost grows as the settlement develops is visible as a curve rather than
hidden in one average. It needs generated content and fails loudly without it, because a benchmark
that measures nothing must not read as a clean run.

Both reports record the machine they were taken on and judge it. A contended box, a machine whose own
speed drifted mid-run, or a window spiking far above its median leads the report with an untrustworthy
banner. Treat those numbers as void rather than as a result.

`npm run bench:compare` turns two reports into a per-system delta table with a noise band. Every run
keeps its report under `bench-out/`, so with no arguments it compares the two most recent runs of the
same world; two paths name them explicitly. It refuses to compare different worlds or run lengths, and
reports a changed state hash as a behavior change rather than a speed one.

Absolute timing is machine-dependent, so compare runs on the same machine.

See [`DEVELOPMENT.md`](DEVELOPMENT.md) for benchmark controls.

## Choosing the required checks

- Documentation-only work: `npm run check:docs`, `npm run check`, and any relevant link or example
  inspection.
- Normal code: standard gates.
- Sim behavior: standard gates plus a focused determinism or scenario test.
- Pipeline or schema: standard gates plus `npm run test:pipeline`.
- Real-content consumers: standard gates plus `npm run test:content` when local content exists.
- Sort comparators, the local float allowance, or the state hash: standard gates plus
  `npm run test:engines` when local content and the Playwright browsers exist.
- Visual or audio work: matching automated checks plus a stated human review step.
