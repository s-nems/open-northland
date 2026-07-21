# Reject incompatible IR versions at the loader boundary

**Area:** data + app + desktop · **Priority:** P2

`ContentSet.manifest.version` accepts any positive integer, while `docs/DATA-FORMAT.md` promises a
hard version gate. Desktop checks the separate pipeline manifest, but browser loads and direct callers
can still parse stale `ir.json` until a later field fails or, worse, happens to validate.

## Scope

- Compare `manifest.version` with the current `IR_VERSION` in the shared content parser and return a
  readable expected/actual mismatch.
- Keep pipeline-manifest freshness checks; they solve a different problem.
- Update committed fallback content and test builders to use the shared current version constant rather
  than copied numbers.

## Verify

Tests cover current, older, and newer versions at direct, browser, and desktop loader seams. Run
`npm test`, `npm run check`, `npm run build`, and `npm run test:content` when local content is present.
