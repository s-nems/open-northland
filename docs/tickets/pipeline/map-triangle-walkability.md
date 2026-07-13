# Derive imported-map water/walkability from the lmpa/lmpb triangle-pattern lanes

**Area:** pipeline + data (+ sim nav) · **Origin:** docs cleanup / SOURCES "Remaining" sweep,
2026-07-13

Imported maps get their sim grid — and therefore their walkability — from the **`lmlt`
landscape-OBJECT lane** only: `mapDatToTerrain` (`tools/asset-pipeline/src/stages/maps/terrain.ts`)
runs `lmltToTerrainMap(unpackMapLayer(lmlt), size)` and emits `{ width, height, typeIds }`, which
the sim's `buildTerrainGraph` (`packages/sim/src/nav/terrain/map.ts`) turns into a `TerrainGraph`
whose per-node `walkable` flag (`nav/terrain/graph.ts`) is decided by that landscape typeId. But
`lmlt` types are mostly OBJECTS (void/tree/rock/wheat/…, per `decoders/ini/terrain.ts`), not the
ground's water/land classification — so sea, mountain, and blocked ground are only non-walkable
insofar as an object happens to sit on them. The authoritative water/walkability classification is
in a **different, currently-unconsumed lane**.

**Source basis (OpenVikings + extracted data):** the `map.dat` **`lmpa`/`lmpb`** lanes (u8, per
cell, one per triangle A/B) are the per-triangle **logic pattern type** — ids into
`trianglepatterntypes.cif` (10 records: water/land/blocked/mountain/sand/beach/desertstone/moor/
snow/plaster). Those records are **already extracted to IR** as `TrianglePatternType`
(`packages/data/src/schema/landscape/terrain.ts`, via `stages/ir.ts`) carrying `isWater` /
`humanCanWalkOn` / `houseCanBeBuildOn`. The lanes themselves are already decoded to bytes
(`decoders/mapdat/layers.ts` unpacks `lmpa`/`lmpb` as `X8el` packed layers) — they are read but
never consumed. This is the "Remaining: `lmpa`/`lmpb` → sim water/walkability" item named in
`docs/SOURCES.md`.

## Scope

- **Investigate-first:** on a few real maps (e.g. a coastal one like `specjalna_mosty_na_rzece`),
  confirm the `lmpa`/`lmpb` → `trianglepatterntypes` → `isWater`/`humanCanWalkOn` join reproduces
  the map's actual sea/blocked shape, and measure how far today's `lmlt`-only walkability diverges
  from it (does the sim currently let settlers walk on open water?). If the divergence is
  negligible on real maps, document it as a named approximation and close.
- **If real:** add a per-cell water/walkable channel to the map terrain IR
  (`packages/data/src/schema/maps/terrain/`), decode it in `mapDatToTerrain` from `lmpa`/`lmpb`
  reduced to per-cell (dominant/either-triangle rule — pick one and name it), and have the sim
  consume it in `buildTerrainGraph` so an imported map's water/mountain cells are non-walkable
  independent of what object sits there. Keep the `lmlt` object typeIds for object collision.

## Verify

- Pipeline: a decode unit test on a synthetic `lmpa`/`lmpb` fixture; a real pipeline run against the
  owned game copy.
- Sim: `npm test` — a settler cannot path across an imported map's open-water cell (nav test); any
  sim golden that moves is an intentional walkability change → name it.
- `?map=<coastal>` — the sea reads as blocked; settlers hug the shore — **user's eyes**.
