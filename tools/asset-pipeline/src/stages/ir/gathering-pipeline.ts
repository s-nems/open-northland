import type { GoodType, LandscapeGfx } from '@open-northland/data';
import { GatheringPipeline } from '@open-northland/data';

/**
 * Resolves the gathering join for every good carrying a `gathering` chain: its three
 * `landscapeTo{Harvest,Pickup,Store}` stages, each bound to the `[GfxLandscape]` records whose
 * `logicType` equals that stage's landscape type.
 */
export function buildGatheringPipeline(
  goods: readonly GoodType[],
  landscapeGfx: readonly LandscapeGfx[],
): GatheringPipeline[] {
  // logicType -> the ascending `LandscapeGfx.index` values that place it.
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
