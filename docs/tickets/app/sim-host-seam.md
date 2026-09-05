# Read the live sim through one host seam in the runtime loop

**Area:** app · **Focus:** view/runtime · **Priority:** P3

The runtime loop and its consumers reach into the live `Simulation` directly instead of through the
snapshot. Outside scene and sandbox setup, the live reads are: `fogView` and `constructionPlots` in
`frame-loop.ts`; `placementProbe`, `signpostProbe`, and their blocker versions in `placement-gates.ts`
and `placement-overlay.ts`; `diplomacyStance` and `hasMetPlayer` in `diplomacy-rows.ts` and
`game-view.ts`; `equipPickList` in `game-view.ts`; `assistantGrants` and `assistantCounters` in their
view modules; `needsEnabled` and `fogMode` in `debug-mounts.ts`; `hashState`, `commands.log`, and
`setInstrument` under `diag/`; and `exportSaveGame` reading the world in `save-load/controller.ts`.
Sixteen non-scene modules import the `Simulation` type.

Consequence: the sim cannot leave the render thread (see
[sim-tick-worker-offload](../sim/sim-tick-worker-offload.md)), a future lockstep client has no single
place to replace the local loop with a network-driven one, and each new consumer that reads live state
instead of the snapshot widens this list unnoticed.

## Scope

- Define one host interface the runtime consumes: the per-tick snapshot and events, fog view keyed by
  fog generation, construction plots, placement and signpost probes with their blocker versions,
  diplomacy reads, rule flags, assistant grants and counters, command enqueue, the diag seams (state
  hash, command log, system instrument), and save export.
- Reads that happen per frame stay synchronous and must be answerable from a snapshot or a
  version-keyed mirror. Rare reads (equip pick list, save export, diagnostics bundle) become
  request-shaped so a worker host can later answer them without changing callers.
- One inline implementation wrapping `Simulation`; no worker and no behavior change in this ticket.
- Enforce the boundary through types: `startFrameLoop`, unit controls, the minimap, the diag bundle,
  and the save controller receive the host interface, and `Simulation` is constructed and typed only in
  entries, scenes, and sandbox setup.
- Non-goals: scene and sandbox setup keep direct `sim.world` access; no change to the snapshot shape.

## Verify

- Type check proves the boundary: no runtime module outside entries, scenes, and sandbox imports
  `Simulation`.
- Scene hashes, goldens, and a headless scenario run are identical before and after.
- `npm test`, `npm run check`, and `npm run build`.
