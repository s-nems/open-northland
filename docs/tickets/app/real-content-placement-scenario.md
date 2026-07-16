# Real-content scenario for the COMMAND placement path — P3

## Context

The real-content suite (`packages/app/test/content/`, `npm run test:content` — docs/TESTING.md
"Real-content test modes") proves the gathering and field-farming loops over merged real content,
but both scenarios build their buildings/settlers component-directly, mirroring the sim fixture
e2e (`farming-scenario.test.ts` doc comment names this). The player's actual path — `placeBuilding`
command → footprint stamp → construction delivery/hammering → worker staffing — is not exercised
on real content anywhere headless, so a real-content regression in extracted footprints, placement
validation, or construction bills would pass the suite and surface only in the browser.

## Scope

One new scenario in `packages/app/test/content/` (same `hasRealIr`/`loadContentUnderTest` seams):
place a small real building via the `placeBuilding` command on a synthetic grass map, drive the
construction to completion the way the UI would (spawn a builder trade resolved from the content's
build-house atomic grant, supply the construction goods from a stocked store or directly), then
staff it and assert it produces. Resolve every id from the content (no pinned typeIds); assert
core invariants each tick and same-seed determinism, matching the existing scenarios' shape. If
completing construction headlessly needs a helper that scenes already have, reuse it — do not grow
a parallel harness.

## Verify

`npm run test:content` green (and skip-clean without content via `ON_CONTENT_DIR=/nonexistent`);
`npm test`, `npm run check`.
