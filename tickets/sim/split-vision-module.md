# Split systems/vision.ts into a vision/ feature folder

**Area:** packages/sim · **Origin:** code review of feat/fog-of-war, 2026-07-12

`packages/sim/src/systems/vision.ts` is ~400 lines and mixes three concerns: the `FogState` world
resource (masks + visible-bounds cache + verifier), the read gates (`playerSeesNode`/
`playerSeesEntity`/`effectiveFogState`/`cellOfNode`), and the `visionSystem` + `stampVision` rebuild.
That is past the repo's ~300-line split threshold (AGENTS.md "Group by feature, not flat").

## Scope

Pure file move — no behavior change, goldens must stay byte-identical:

- `systems/vision/state.ts` — `FogState`, `FOG_STATE`, `verifyVisibleBounds`.
- `systems/vision/gates.ts` — the combat/read gates + `cellOfNode` + `effectiveFogState`.
- `systems/vision/system.ts` — `visionSystem`, `stampVision`, radii + cadence constants.
- `systems/vision/index.ts` barrel re-exporting the current public surface, so every existing import
  path through `systems/index.js` keeps working unchanged.

## Verify

`npm test` (zero golden movement — this is a refactor), `npm run check`, `npm run build`.
