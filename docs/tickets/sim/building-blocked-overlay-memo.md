# Memoize the building walk-block overlay per world

**Area:** packages/sim · **Origin:** fix/eject-blocked-settlers, 2026-07-17 · **Priority:** P2

`buildingBlockedCells` (packages/sim/src/systems/footprint/blocked.ts) rebuilds from scratch on every
call: it scans the whole `Building` store and re-stamps each type's `footprint.blocked` cells into a
fresh `Set`. Its two wrappers (`dynamicBlockedCells`, `dynamicBlockOverlay`) therefore cost
O(buildings × footprint cells) per *call*, and several callers call it per command or per tick — the
PathfindingSystem's per-tick overlay, `reachableMoveGoal` once per move order (so a box-select of N
units rescans the store N times), and `evictSettlerFromBlockedSpawn` once per `spawnSettler`.

The resource half of the same overlay is already incrementally cached (`resource-blocked-cache.ts`,
maintained by the stamp/unstamp paths, verified via `world.registerCacheVerifier`). The building half
is the one that still rescans.

Measured (2026-07-17, this branch): an authored map load is one command burst, so the spawn push pays
the rebuild per human. On the worst real map's shape — 236 buildings + 784 humans, all humans on house
anchors, real content and real footprints — the burst tick costs ~110–170 ms with the push versus ~17 ms
without; essentially all of the delta is the repeated overlay build, not the ring search (only ~3% of
real authored humans are blocked at all, and the deepest ring search is 21 nodes). One-time on a loading
screen today, but it scales as humans × buildings, so a larger map pays proportionally more.

Worth knowing before optimizing this away by narrowing the caller instead: of the 1041 authored humans
standing on a body, only ~50 are genuinely wedged (`findPath` exempts a blocked START, so the rest can
already step off). The push still runs for all of them deliberately — it enforces the twin's rule that a
settler never *stands* inside a wall — so the fix is to make the overlay cheap, not to push fewer
settlers.

## Scope

Memoize `buildingBlockedCells` per `World`, keyed on terrain + content + a version of its inputs, so a
burst of callers between two building mutations shares one build. **The obvious key is wrong** — do not
key on `world.componentGeneration(Building)` alone:

- `componentGeneration` bumps only on component add/remove (`World.add`/`remove`), not on an in-place
  value write;
- a home tier upgrade swaps `Building.buildingType` **in place** (systems/economy/construction.ts), and
  `blocked` is the *current level's* walls — so the cell set genuinely changes with no generation bump.

That is exactly why `placementBlockerVersion` can key the placement grid safely and this cannot: its
comment records that `familyBody`/`reserved` are level-chain-constant, so an in-place level-up leaves
*those* sets unchanged. `blocked` does not have that property. So the version must also move on a
`buildingType` swap — e.g. bump a dedicated counter at the upgrade seam, or fold the level/type sum in.
Verify the choice against every in-place `Building` write, not just the upgrade path. There are only two:
the `buildingType` swap above, and the `built` progress flip — the latter is inert here, because the
walk-block applies from the placement tick (`blocked.ts`), so `built` never changes the cell set.

Also note the tempting cheap fix is wrong: the per-tick `blockedCells ??=` memo pattern used by
`systems/agents/destack.ts` and `systems/movement/routing.ts` cannot be reused in the command path, since
a `placeBuilding` later in the same tick's queue would leave it stale for a following `spawnSettler`.

Register the cache in `World.verifyCaches()` via `world.registerCacheVerifier` (re-derive and compare,
like `verifyResourceBlockedCache`) so the `cachesCoherent` invariant catches staleness, per
packages/sim/AGENTS.md.

## Verify

- `npm test` — goldens must NOT move: this is a pure memo of a derived, never-hashed overlay, so a moved
  golden means the key is missing a mutation seam.
- Add a test that a home tier upgrade (the in-place `buildingType` swap) invalidates the memo — the
  regression the naive key would cause. `packages/sim/test/movement/evict.test.ts` already builds a
  two-level home fixture that upgrades in place; reuse that shape.
- Re-measure the spawn burst described above and record the new figure.
