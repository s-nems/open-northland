# Give FogView a copied raw-bytes lane (worker-ready seam + O(map) raster relief)

**Area:** packages/sim (seam) + packages/render + packages/app/minimap · **Origin:** engine + code
review of feat/fog-of-war, 2026-07-12 · **Priority:** P2

Two findings share one fix:

1. `Simulation.fogView().stateAt` closes over the LIVE `FogState` — safe today (single thread,
   generation-keyed), but it is a live-sim read from render, and the planned sim-in-a-Web-Worker
   step ([sim-web-worker](../app/sim-web-worker.md)) cannot ship a closure across the thread
   boundary.
2. The minimap fog raster (`hud/minimap/index.ts` `drawFog`) and the fog wash both walk cells through
   the per-cell closure chain (`stateAt` → `effectiveFogState` → bounds check → `Map.get`). The
   minimap loop is O(map cells) per fog generation — negligible at 256² (~65k calls / 250 ms), a
   multi-ms main-thread spike at 1024².

## Scope

- Extend `FogView` with a per-generation COPIED `readonly Uint8Array` of the viewer's effective cell
  states (or raw states + a "RECON remaps UNEXPLORED→EXPLORED" flag), produced once per mask rebuild —
  plain transferable data, no closure.
- Point the grid consumers (minimap `drawFog`, `gpu/overlays/fog-layer.ts` band raster) at row-wise typed-array
  reads; keep `stateAt` for point queries (sprite cull, picking).
- While in the minimap file: move the state→alpha rasterization into the pure `model.ts` half
  (headless-testable — the one fog surface without a unit test today; code review finding).

## Verify

`npm test` + new minimap-raster unit test; `npm run check`, `npm run build`; browser: fog wash and
minimap identical before/after on `?map=specjalna_mosty_na_rzece&fog=reveal|recon` (pixel-compare a
still frame), perf overlay shows no regression.
