# Map authored deposit growth levels to starting yield (split MineDeposit.initial from remaining)

**Area:** sim + app · **Origin:** gathering-economy plan reconciliation, 2026-07-12

Imported-map deposits ignore their authored growth `levels`: a deposit authored below full growth
(`lmlv`) draws its authored level statically but **spawns at FULL yield**, so its decal can JUMP to
the near-full frame at the first chip. Map spawn uses the gatherer catalog defaults instead of
mapping per-placement `objects.levels` → starting `remaining`.

## Scope

- Split `MineDeposit.initial` from `remaining` (`packages/sim/src/components/economy/resources.ts`) so the
  visual level derives from `remaining/initial` while `initial` stays the authored full size.
- In map spawn (`spawnMapResources` / `packages/app/src/content/map-resources.ts`), map the
  authored `levels` to the starting `remaining`.
- Component shape changes move goldens (`hashState` folds field names) — **a deliberate move;
  name it in the commit**, or add the field without renaming existing ones to keep the move
  minimal.

## Verify

- Unit test: an authored half-grown deposit spawns at proportional yield and never jumps frames on
  first chip.
- `?map=` with a below-full deposit — **user's eyes** on the decal continuity.
