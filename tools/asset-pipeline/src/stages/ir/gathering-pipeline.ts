import type { GoodType, LandscapeGfx } from '@open-northland/data';
import { GatheringPipeline } from '@open-northland/data';

/**
 * Resolves the {@link GatheringPipeline} join for every map-gathered good: `goodType` → its three
 * `landscapeTo{Harvest,Pickup,Store}` stage ids → the {@link LandscapeGfx} records that place each
 * stage. The stage→gfx leg joins by `LandscapeGfx.logicType == the stage's landscape type` (the
 * `[GfxLandscape]` cross-ref to the `[landscapetype]` table — the houses analog is `[GfxHouse]
 * LogicType`). Materialized once here so a later gathering system reads the stages + their placeable
 * gfx directly instead of re-scanning the 866-record gfx table each time.
 *
 * One record per good carrying a `gathering` chain (the ~11 raw goods); produced/in-house goods are
 * skipped. A lane the good omits (honey has no `harvest`) is left absent. A stage whose landscape
 * type has no placeable gfx record yields an empty `gfxIndices` — faithful data (some store lanes are
 * pure-logic "dropped good" markers), surfaced at build time rather than silently dropped.
 */
export function buildGatheringPipeline(
  goods: readonly GoodType[],
  landscapeGfx: readonly LandscapeGfx[],
): GatheringPipeline[] {
  // logicType -> the gfx records (by positional index, ascending) that place it, built once.
  const gfxByLogicType = new Map<number, number[]>();
  for (const g of landscapeGfx) {
    const list = gfxByLogicType.get(g.logicType);
    if (list) list.push(g.index);
    else gfxByLogicType.set(g.logicType, [g.index]);
  }
  const stage = (
    landscapeType: number | undefined,
  ): { landscapeType: number; gfxIndices: number[] } | undefined =>
    landscapeType === undefined
      ? undefined
      : { landscapeType, gfxIndices: gfxByLogicType.get(landscapeType) ?? [] };
  const pipeline: GatheringPipeline[] = [];
  for (const good of goods) {
    if (good.gathering === undefined) continue;
    const harvest = stage(good.gathering.harvest);
    const pickup = stage(good.gathering.pickup);
    const store = stage(good.gathering.store);
    pipeline.push(
      GatheringPipeline.parse({
        goodType: good.typeId,
        goodId: good.id,
        harvestAtomic: good.atomics.harvest,
        bioLandscape: good.gathering.bioLandscape,
        ...(harvest ? { harvest } : {}),
        ...(pickup ? { pickup } : {}),
        ...(store ? { store } : {}),
      }),
    );
  }
  return pipeline;
}
