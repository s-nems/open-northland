# Fold the scattered `runIf(ir.json)` tests into the `test:content` suite — P3

**Needs user:** yes — the user explicitly kept the existing tests untouched when `test:content`
landed; confirm they want the relocation before moving files.

## Context

`npm run test:content` (docs/TESTING.md "Real-content test modes") runs `packages/app/test/content/`
— the explicit, hard-failing real-content gate. But ~10 older test files across
`packages/app/test/` also gate individual assertions on the generated `content/ir.json` via
`it.runIf(existsSync(IR_PATH))` (e.g. `real-content.test.ts`, `real-content-merge.test.ts`,
`viking-roster.test.ts`, `worker-roles.test.ts`, `map-resources.test.ts` — grep `runIf` to get the
live list). They run under plain `npm test` when content exists, but the explicit mode does not
include them, and each duplicates its own `IR_PATH` resolution instead of reading the suite's
`ON_CONTENT_DIR`-aware `helpers.ts`.

## Scope

- Move the content-gated test files (or split out their content-gated describes) into
  `packages/app/test/content/`, switching their IR loading to `helpers.ts` (`hasRealIr`,
  `loadContentUnderTest`) so `ON_CONTENT_DIR` (the `test:pipeline` seam) covers them too.
- Pure moves/reseams only — assertions stay byte-identical; files that mix content-gated and
  fixture-only describes keep the fixture-only part where it is.

## Verify

`npm test` (same pass/skip counts on a bare checkout), `npm run test:content` green with the moved
files included, `npm run check`.
