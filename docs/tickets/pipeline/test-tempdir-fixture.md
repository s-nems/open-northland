# Extract a shared `useTempDir` test fixture

`tools/asset-pipeline/test` — ~13 stage specs hand-roll the same per-test temp-directory lifecycle:
`beforeEach(async () => { out = await mkdtemp(join(tmpdir(), 'opennorthland-<name>-')) })` plus
`afterEach(async () => { await rm(out, { recursive: true, force: true }) })`, with the imports
(`mkdtemp`/`tmpdir`/`rm`) repeated each time. Files: `bmd-stage`, `bmd-bindings`, `fonts`, `gui`,
`ir`, `lib-stage`, `maps`, `maps-convert`, `maps-meta`, `maps-case-path`, `pcx-stage`,
`player-colors`, `args`.

The data fixtures are already centralized under `test/fixtures/{bmd,pcx,palette,cif,mapdat}.ts`; the
tmp lifecycle is the missing one.

## Scope

1. Add `test/fixtures/tmp.ts` exporting `useTempDir(prefix: string): { readonly path: string }` that
   wires `beforeEach` (mkdtemp) + `afterEach` (rm) and returns a ref whose `.path` is set per test.
2. Migrate each spec: replace the local `let out`/`root` + the two hooks + the fs imports with
   `const tmp = useTempDir('opennorthland-<name>-')`, and rename that spec's temp-dir references to
   `tmp.path`. **Care:** `out` is a common token — rename only the temp-dir variable, not unrelated
   uses (`args.out`, `stdout`, etc.). Do it one spec per commit so each is mechanically verifiable.

## Why deferred from the data+pipeline refactor

The dedup itself is trivial, but the migration touches ~13 files and hundreds of temp-dir references;
it deserves its own focused pass rather than riding the end of a large refactor where a stray rename
could slip through.

## Verify

`npm test` per migrated spec (the temp-dir behavior is identical — a fresh dir per test, removed
after). `npm run check`.

## Source basis

Test hygiene only; no production or fixture-data change.
