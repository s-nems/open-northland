# Fold SelectionLayer's twin per-frame entity scans into one pass

**Area:** render · **Origin:** /refactor-cleanup on packages/render, 2026-07-14 · **Priority:** P3

Sibling of [sprite-pool-per-frame-scans](sprite-pool-per-frame-scans.md) (that one is the pool;
this one is the selection rings).

`gpu/overlays/selection-layer.ts` `SelectionLayer.draw` calls `reconcile` twice — once for the green
selection rings, once for the amber work-flag rings — and each `reconcile` does a full linear scan of
`frame.snapshot.entities` whenever its id set is non-empty (`for (const ent of frame.snapshot.entities)
{ if (!ids.has(ent.id)) continue; … }`). So selecting a gatherer (both `selected` and `flagged`
non-empty) scans every entity on the map **twice per frame** to place ~1–2 rings.

The snapshot's `entities` are canonical and ascending by id (the sim's `entity-dump` binary-searches
them), so the ideal is O(selection): iterate the small id set and look each entity up (a shared
`entityById(snapshot, id)` binary search), instead of iterating all entities. A cheaper interim fix is
to fold the two passes into a single scan that tags each entity by which set(s) it matched.

`AGENTS.md` accepts an O(entities) cull as the current design and names a spatial index as the future
seam — this is the same theme, so a shared id-lookup seam on the sim snapshot would serve both this
and the pool scans.

## Scope

Either (a) fold `draw`'s two `reconcile` calls into one entity scan that dispatches to whichever
ring pool(s) the entity belongs to (keeping the per-pool color/width/`ringSpec` logic), or (b) add a
sim-snapshot id→entity lookup (leaning on the sorted-by-id invariant) and iterate `selected`/`flagged`
directly. `selection-layer.test.ts` covers the behaviour — keep it green; behaviour-preserving.

## Verify

`npm run build`, `npm test` (selection-layer + world-renderer suites), `npm run check`. Confirm the
per-frame entity scan count drops from 2×|entities| to one pass (or O(selection)) with a gatherer
selected.
