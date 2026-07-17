# Feed the worker-overlay sprite scene a full snapshot

**Area:** app · **Origin:** bug-hunt review, 2026-07-17 · **Priority:** P3

`WorkerSpriteOverlay` builds its panel sprites from a snapshot narrowed to settlers only:
`packages/app/src/hud/details-panel/worker-sprites.ts:130-133` constructs
`{ ...snapshot, entities: workerEntities }` and hands it to `buildSpriteScene`. But
`collectSpriteScene` does cross-entity reads the narrowed list breaks:

- `enterableStoresOf` (`packages/render/src/data/scene/snapshot-index.ts:64-75`) scans the given
  snapshot for buildings — finds none, so `enterableStores` is always empty and the
  mid-store-exchange branch of the indoor check (`sprite-scene.ts:144-151`) can never fire. A
  worker inside a completed store appears in the *plain* build and gets the live animation clock
  (`worker-sprites.ts:154`), contradicting the file's own contract ("a worker absent from the plain
  build but present in the indoor one is inside → drawn frozen"). Only the `Resting` case still
  freezes.
- `targetPositionsOf` cannot resolve a mid-swing worker's target (the tree/enemy entity is not in
  the narrowed list), so `targetFacing` (`sprite-scene.ts:170-176`) is never computed and the
  worker falls back to its stale walk heading/default facing — against the stated "same frame,
  same facing (as the map)" goal.

Panel-only visuals: a store worker's row plays a live exchange/walk animation instead of the frozen
standing pose; a mid-chop woodcutter swings facing the default direction instead of toward its
work target.

## Scope

- Pass the full snapshot to the scene build and filter the *result* to the bound worker ids,
  instead of narrowing the input. This raises the per-call cost —
  `docs/tickets/app/hit-test-viewportless-scene-scans.md` already tracks this call site's
  double-pass cost; fix both together (one full-snapshot `collectSpriteScene` call, keep indoor
  settlers, filter to worker ids) rather than trading correctness against that ticket.
- Assert the contract in a test: a worker mid-store-exchange is drawn frozen; a worker with a
  work target faces it.

## Verify

`npm run build`, `npm test` (details-panel / worker-sprites suites), `npm run check`. Visual:
select a staffed store while a worker steps inside (e.g. `?scene=sandbox`) — frozen pose in the
panel; human sign-off.
