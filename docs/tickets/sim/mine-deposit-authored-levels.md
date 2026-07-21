# Map authored deposit growth levels to starting yield (split MineDeposit.initial from remaining)

**Area:** sim + app · **Priority:** P2

Imported-map deposits ignore their authored growth `levels`: a deposit authored below full growth
(`lmlv`) draws its authored level statically but **spawns at FULL yield**, so its decal can JUMP to
the near-full frame at the first chip. Map spawn uses the gatherer catalog defaults instead of
mapping per-placement `objects.levels` → starting `remaining`.

The component split is already done: `MineDeposit` carries both `initial` and `remaining`
(`packages/sim/src/components/economy/resources.ts`), and the render level already derives from
`remaining/initial`. **Only the map-spawn half remains** — nothing reads `objects.levels`.

## Scope

- In map spawn — `spawnMapResources` (`packages/app/src/game/sandbox/map-spawn.ts`), which
  wraps `mapResourceSpawns` (`packages/app/src/content/map-resources.ts`) — map the authored
  `objects.levels` (schema `packages/data/src/schema/maps/terrain/layers.ts`) to the starting
  `remaining`, leaving `initial` at the authored full size.

## Verify

- Unit test: an authored half-grown deposit spawns at proportional yield and never jumps frames on
  first chip.
- `?map=` with a below-full deposit — **user's eyes** on the decal continuity.
