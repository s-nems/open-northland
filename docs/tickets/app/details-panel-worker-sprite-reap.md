# Reap the worker-overlay sprite map

**Area:** app · **Origin:** bug-hunt review, 2026-07-17 · **Priority:** P3

`WorkerSpriteOverlay.sprites` (`packages/app/src/hud/details-panel/worker-sprites.ts:180,269-292`)
is a `Map` keyed `${entityId}:${layerIndex}`. Entries are added when a worker is drawn and never
deleted while the panel lives — `hideRest()` only sets `visible = false`, and `dispose()` (which
does clear it, via `unit-controls/index.ts:377`) only runs on session teardown (itself not yet
wired end-to-end — `docs/tickets/app/game-session-teardown.md`). Because the key is entity-scoped,
every settler ever shown in any details panel retains 2–3 display objects (custom-shader
`PalettedSprite` meshes, or plain sprites) attached to the stage for the rest of the session, and
`hideRest()` — run every overlay update, i.e. per frame while a building is selected — degrades
into a scan over every sprite ever created. Hidden meshes don't draw, but Pixi still traverses
them and the memory/scan cost grows without bound on a long session. Contrast `SpritePool`, which
reaps departed entities.

## Scope

- Bound the map: either key sprites by slot (`${slotIndex}:${layerIndex}` — at most
  `MAX_WORKERS × layers` objects, retextured per draw the way `setFrame`/`texture` already work),
  or destroy-and-delete entries not drawn in the current update. Slot-keying is simpler and makes
  `hideRest()` O(MAX_WORKERS).
- Same treatment for `plainTextures` if it is also entity-keyed growth (verify).
- Keep the drawn result identical; this is lifecycle bookkeeping only.

Same file as `docs/tickets/app/details-panel-model-memo.md` and
`docs/tickets/app/details-panel-worker-scene-snapshot.md` — executing them together is reasonable.

## Verify

`npm test` (worker-sprites suite — add a test that showing N different workers then another
building leaves at most the bounded object count), `npm run check`, `npm run build`. Manual: click
through many buildings, confirm the panel still renders workers correctly.
