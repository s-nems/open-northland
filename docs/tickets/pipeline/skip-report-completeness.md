# Make a partial conversion distinguishable from a complete one

**Area:** pipeline · **Priority:** P2

Every extraction stage degrades by logging and continuing, which is the right policy for a batch tool
over a possibly-partial install. The run's own output does not record that it happened.

`runPipeline` returns `void`, so a conversion that skipped fonts, cursors, and maps ends exactly like
a clean run. Nothing that later loads the content can tell the two apart.

The same missing seam makes the stage tests brittle: seventeen sites across ten test files spy on
`console.warn` and assert on English prose, so rewording a warning breaks tests that are not about
wording.

`errorMessage` (`src/errors.ts`) owns the "describe a caught value" half of this. What has no owner is
the record that a skip happened.

## Scope

Give the stages a structured skip reporter, return the collected report from `runPipeline`, and have
the CLI exit non-zero on a partial conversion so a release build cannot ship one. Keep the console
output for CLI users and migrate stages incrementally. Replace the console spies with assertions on
the returned report.

`packages/app/src/diag/log.ts` is the app-side precedent, but a tool must not depend on
`packages/app`: take the pattern, not the module.

## Verify

Stage tests assert on the returned report instead of console text, with a case for a run that skipped
an input and one for a clean run. `npm test`, `npm run check`, `npm run build`, and
`npm run test:pipeline`, where the regenerated content must stay byte-identical.
