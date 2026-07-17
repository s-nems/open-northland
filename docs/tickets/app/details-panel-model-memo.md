# Memoize the details-panel model build per snapshot

**Area:** app · **Origin:** bug-hunt review, 2026-07-17 · **Priority:** P3
(perf — no behavior change)

`updateModel` (`packages/app/src/hud/details-panel/panel.ts:224-243`, called from `tick()` every
RAF frame via `view/runtime/frame-loop.ts`) always runs `buildUnitPanelModel` and then
`JSON.stringify(model)` **before** any early-out — `VALUE_REBUILD_MIN_MS` only throttles the Pixi
re-bake, never the model build. The build is not panel-sized: `buildUnitPanelModel`
(`model/index.ts`) does a full classify pass plus an `entityById` linear scan, and the building
path adds `boundCountsByJob` (`model/building.ts`), `familiesByHome` (`game/snapshot.ts`) for
homes, and `fieldCounts` for farms — several O(entities) scans per frame while a building is
selected on a battle-scale map, ~5× redundant against the tick rate and 100% redundant while
paused (same snapshot object every frame). `refreshWorkers` → `WorkerSpriteOverlay.update` adds
another full-entity pass per frame (`worker-sprites.ts` `boundWorkers`).

The codebase's own pattern is snapshot-identity memoization: `view/projections/
snapshot-projections.ts` `memoBySnapshot`, and frame-loop's `hudFor`/`doorBadgesFor` ("memoized per
tick, not per RAF"). The render-side twin of this ticket is
`docs/tickets/render/hud-generation-memo.md` (`buildHud`); this one is the app-side details panel.

## Scope

- Memoize the model build (and the worker-overlay update) on snapshot identity + the selection
  inputs (`selectedIds` revision, screen size), so an unchanged snapshot skips both the build and
  the stringify. `force` and selection changes bust the memo.
- Keep behavior identical: same model, never stale across a real input change (a paused game that
  issues a command mid-pause still ticks a new snapshot — verify that assumption at the frame-loop
  seam).

## Verify

`npm run build`, `npm test` (details-panel suites — add a memo hit/miss test), `npm run check`.
Manual: select a home/farm/store, pause — values still correct on unpause; live values still
refresh at the 4 Hz rebuild cadence.
