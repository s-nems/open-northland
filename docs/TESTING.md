# Testing

Use the lowest test layer that proves the behavior. Normal development should stay independent of the
mod archive; real-content and pipeline tests are separate local gates.

## Standard gates

```bash
npm run check
npm run build
npm test
```

`npm test` runs the `app` and `core` Vitest projects: simulation hygiene, deterministic state hashes,
integration tests, and headless acceptance scenes. A third project, `content`, holds
`packages/app/test/content`; only `npm run test:content` selects it, so a checkout with generated
content still gets the same fast default suite. CI runs `npm test` on Ubuntu; a Windows run is
available through the CI workflow's manual dispatch checkbox. Formatting and production build checks
run once on Ubuntu.

No project isolates modules: the files a worker runs share one module registry, so a test must not
depend on being the first to import one. Name module-level fixtures uniquely and restore whatever the
test patches. To replace a module the subject imports, either spy on the imported namespace, or call
`vi.resetModules()` and import the subject dynamically: `vi.mock` alone cannot re-apply to a module an
earlier file already loaded.

During iteration, run only the affected tests:

```bash
npx vitest run --project core packages/sim/test/core/hygiene.test.ts
npx vitest run --project app packages/app/test/scenes
```

Replace the paths with the affected tests; include dependent packages when their contracts change.
`--project core` and `--project app` exclude real-content tests. For a selection spanning both,
use `--project='!content'`. A path filters files; `-t 'test name'` filters test titles.
Vitest selects the workspace packages' `source` exports, so package edits are tested immediately.
Focused runs and watch mode transpile TypeScript; they do not typecheck it or replace completion gates.
Production builds and plain Node tools still use `dist/`; run `npx tsc --build` before a Node tool
when its package sources changed.

`npm test -- scenario` also filters files, but first runs every script test and the full production
and test typecheck. Use it for completion, not on every edit. `npm run test:watch -- <path>` watches
the selected tests and their source dependencies without a separate compiler process.

For completion, `npm run build` already includes the typecheck. To run the standard gates without
repeating it through `npm test`:

```bash
npm run check
npm run build
npm run test:scripts
npx vitest run --project='!content'
```

This is equivalent to the standard gates above; keep the standalone `npm test` entry for CI and
fresh test runs. Run `npm run check:assets` and `npm run check:docs` before committing repository
changes. Do not run multiple full suites or a benchmark alongside a build on the same machine.
The root Vitest configuration caps its worker pool at four; simultaneous runners still multiply it.

## Test layers

1. Unit tests cover pure helpers, decoders, schemas, and individual rules.
2. Integration tests run a small set of systems or a command path through a real `Simulation`.
3. Headless scenarios prove a player-visible chain over several ticks.
4. Browser scenes let a human inspect rendering, animation, input, and sound.

Do not use a browser scene to replace a cheap state assertion. Do not claim visual or audio
correctness from a headless test.

## Tests not worth writing

- Calling a pure function twice with the same argument is not a determinism test: the hygiene scan
  owns ambient nondeterminism and the fuzz suite owns run-to-run equality. Reserve
  `expect(run()).toBe(run())` for two independently built simulations.
- A test whose only assertion is that its own fixture is non-degenerate is not a test. Assert the
  premise inside the first test that depends on it.
- Do not assert one accessor against another that reads the same field. Pin both against a named
  value from the fixture.
- A test that needs the decoded map corpus joins the file that already parses it. Without isolation
  only same-file memoization is guaranteed to be reused, so do not lift the parse into a helper.
- Do not step a restored simulation alongside the live one for a whole scenario. Compare once, at the
  checkpoint the restore is about.
- A scale ladder is one contract, not one per rung. Keep the smallest case that reaches the branch.
- To prove a write happened, read the value back. A spy's call count cannot tell a correct write from
  a wrong one.

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

It needs generated content (the browser entries halt without it) and the Playwright browsers of the
repository's Playwright version: `npm ci` installs none of them, so run `npx playwright install chromium webkit firefox` once; Electron comes with the
desktop package. Electron and Chromium are gates, so a mismatch fails the run. WebKit and Firefox
are informative: their verdict is printed, never asserted, and a divergence there is filed as a sim
ticket naming the first diverging tick. An unknown or empty `ON_ENGINES` selection fails the run
instead of passing with nothing compared.

The workloads are the `sandbox` scene over its acceptance run, hashed every 20 ticks, and 2000 ticks
of `magiczny_las` with six AI seats, hashed every 100 because a full hash of that world is slow. A
divergence names the first compared tick that differs. `ON_CONTENT_DIR` is refused: the app serves
the checkout's `content/` only.

## Desktop boot and persistence

`npm run test:desktop` builds the app and shell, then launches Electron on `app://` with an isolated
temporary profile. It checks menu map previews, both sprite URL spellings, and save → relaunch → load
with the same tick and state hash. It needs converted content including `magiczny_las`, opens a real
window, and runs locally rather than in CI. `ON_CONTENT_DIR` selects the content tree.

This exercises the built shell; installer resource inclusion and visual/audio quality still need
platform and human checks. Run it after desktop boot/protocol changes or changes to save/load wiring.

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

`ON_RELAY_PARITY=off` skips `relay-map-parity.test.ts`, which is more than half of the suite's
runtime. The release content job sets it; a local `npm run test:content` always runs the file, so a
change to the relay or the lockstep seams still needs one.

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

`npm run bench:profile` profiles the same real-map world function by function (V8's sampler), and
prints the per-system table for the same ticks beside it. `ON_BENCH_CHECKPOINT` plus `ON_BENCH_SKIP`
let both real-map benchmarks start from a saved late-game state instead of rebuilding the settlement.

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
