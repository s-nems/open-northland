import { Building, Stockpile, UnderConstruction } from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { constructionBillOf, seatStockOf, upgradeTierOf } from '../../stores/index.js';

/**
 * Whether the seat can start upgrading `candidate` without starving the site. An upgrade sends the crew
 * out, so a bill good that only the candidate or another site could make (the pottery's own bricks, or
 * the bricks a mason hut needs while the pottery is upgrading) must already be in stock, beyond what the
 * seat's other sites still lack of it. A good no owned building makes is gathered, and never holds an
 * upgrade back.
 */
export function upgradeBillCovered(
  world: World,
  ctx: SystemContext,
  player: number,
  owned: readonly Entity[],
  candidate: Entity,
): boolean {
  const index = contentIndex(ctx.content);
  const type = index.buildings.get(world.get(candidate, Building).buildingType);
  const target = type === undefined ? undefined : upgradeTierOf(type, ctx);
  if (target === undefined) return true;
  const stock = seatStockOf(world, player);
  const owed = sitesShortfalls(world, ctx, owned);
  for (const line of target.construction) {
    if (!producedOnlyByIdleBuildings(world, ctx, owned, candidate, line.goodType)) continue;
    const committed = owed.get(line.goodType) ?? 0;
    if (!stock.exceeds(line.goodType, committed + line.amount - 1)) return false;
  }
  return true;
}

/** Whether the seat owns a producer of `goodType` and every one is `candidate` or a site. */
function producedOnlyByIdleBuildings(
  world: World,
  ctx: SystemContext,
  owned: readonly Entity[],
  candidate: Entity,
  goodType: number,
): boolean {
  const index = contentIndex(ctx.content);
  let producers = 0;
  for (const e of owned) {
    const type = index.buildings.get(world.get(e, Building).buildingType);
    if (type === undefined || !type.recipes.some((r) => r.outputs.some((o) => o.goodType === goodType)))
      continue;
    if (e !== candidate && !world.has(e, UnderConstruction)) return false;
    producers++;
  }
  return producers > 0;
}

/** How much of each good the seat's construction sites still lack, by good type. */
export function sitesShortfalls(
  world: World,
  ctx: SystemContext,
  owned: readonly Entity[],
): Map<number, number> {
  const shortfalls = new Map<number, number>();
  for (const e of owned) {
    if (!world.has(e, UnderConstruction)) continue;
    const held = world.tryGet(e, Stockpile)?.amounts;
    for (const line of constructionBillOf(world, ctx, e)) {
      const lacking = Math.max(0, line.amount - (held?.get(line.goodType) ?? 0));
      shortfalls.set(line.goodType, (shortfalls.get(line.goodType) ?? 0) + lacking);
    }
  }
  return shortfalls;
}
