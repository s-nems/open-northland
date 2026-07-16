# Add a CLI that replays a diagnostics bundle and reports state health

**Area:** tooling + sim · **Origin:** diagnostics follow-up 2026-07-16 · **Priority:** P2

A tester's diagnostics bundle (seed + command log + world id + hashes) is a full session repro, but
the dev-side procedure currently lives only as a test pattern (`packages/app/test/diag-bundle.test.ts`:
rebuild the world with the same builder, drop pending setup enqueues, `stepReplaying` to the
recorded tick). Operationalize it: one command a dev points at a downloaded bundle.

## Scope

1. `npm run replay -- <bundle.json>` (a node script over `dist/`, like the planned bench harness):
   - parse + validate the bundle (`kind`/`version`),
   - rebuild the world: scene bundles via the registered scene builder; map bundles via the decoded
     map (`content/maps/<worldId>.json` from the local checkout — the bundle never carries map bytes),
   - drop the rebuilt sim's pending setup commands, `stepReplaying` to `game.tick`,
   - report: final hash vs the bundle's `finalHash`, first divergence against `game.hashes` when
     present (`HashTrace.divergedFrom` semantics), and `checkInvariants` at the final tick.
2. On divergence, print the tick and suggest the `localizeDivergence`/`scrubWindow` follow-up; a
   full interactive inspector is out of scope.
3. Exit non-zero on hash mismatch or invariant violations, so the command doubles as a repro check
   in CI-adjacent workflows.

## Verify

- Unit/integration test: generate a bundle headlessly (scene sim), run the CLI's core function,
  expect a clean match; corrupt one command and expect a reported divergence.
- `npm test`, `npm run check`, `npm run build`.
- Manual: download a real bundle from a `?scene=` run in the browser and replay it with the CLI.
