import { Building, Position, Rider, Settler } from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { HalfCellNode } from '../../../nav/halfcell.js';
import { buildingTypeByContentId, tiersAtOrAbove } from '../../ai-shared/content-lookup.js';
import { colonyBuildingsOn, colonySettlersOn } from '../../ai-shared/home-roster.js';
import { anchorNodeOf } from '../../ai-shared/node-geometry.js';
import type { SystemContext } from '../../context.js';
import { isTraderJob } from '../../readviews/index.js';
import type { ColonyEnv, ColonyView } from './env.js';
import { COLONY_STORE_BUILDING_ID } from './store-type.js';

/** The people standing on the colony: its members on its land. A man listed for the ferry but still walking
 *  to the ship is not one yet, or a workshop on the far shore would post him; the trader only calls there. */
export function colonists(env: ColonyEnv): Entity[] {
  const { world, ctx, seat } = env;
  const { land } = env.colony;
  return colonySettlersOn(world, ctx, seat, land).filter(
    (e) =>
      !world.has(e, Rider) &&
      world.has(e, Position) &&
      standsOn(world, ctx, e, land) &&
      !isTraderJob(ctx.content, world.get(e, Settler).jobType),
  );
}

/** The store chain's tiers a colony raises, by type id. */
export function storeTiers(env: ColonyEnv): ReadonlySet<number> {
  const store = buildingTypeByContentId(env.ctx.content, COLONY_STORE_BUILDING_ID);
  return store === undefined ? new Set() : tiersAtOrAbove(contentIndex(env.ctx.content), store);
}

/** The colony's first store at any tier, standing, upgrading or a site. */
export function storeOf(env: ColonyEnv, buildings: readonly Entity[]): Entity | null {
  const tiers = storeTiers(env);
  return buildings.find((e) => tiers.has(env.world.get(e, Building).buildingType)) ?? null;
}

/** A real node on the colony's land its work starts from: its store once placed, else the shore. */
export function colonyOrigin(
  env: ColonyEnv,
  colony: ColonyView,
  buildings: readonly Entity[],
): HalfCellNode | null {
  const store = storeOf(env, buildings);
  const at = store === null ? null : anchorNodeOf(env.world, store);
  return at ?? (colony.shore === null ? null : { hx: colony.shore.hx, hy: colony.shore.hy });
}

/** The buildings the seat holds on this colony, ascending id. */
export function colonyBuildings(env: ColonyEnv): readonly Entity[] {
  return colonyBuildingsOn(env.world, env.ctx, env.seat, env.colony.land);
}

/** Whether `e` stands on `land`. */
export function standsOn(world: World, ctx: SystemContext, e: Entity, land: number): boolean {
  const terrain = ctx.terrain;
  const at = anchorNodeOf(world, e);
  return (
    terrain !== undefined &&
    at !== null &&
    terrain.inBounds(at.hx, at.hy) &&
    terrain.componentOf(terrain.nodeAt(at.hx, at.hy)) === land
  );
}
