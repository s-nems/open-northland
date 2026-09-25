import {
  Building,
  CurrentAtomic,
  HUNTER_WORK_FLAG_RADIUS,
  JobAssignment,
  Position,
  Settler,
  StayPoint,
} from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { nodeOfPosition } from '../../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import { HUNT_CHASE_SLACK_NODES } from '../../conflict/hunting/index.js';
import { huntingGroundHoldsCarcass } from '../../conflict/hunting/kill-claim.js';
import { isHuntTarget } from '../../conflict/targeting.js';
import type { SystemContext } from '../../context.js';
import { needSubjectOf, settlerMeetsNeed } from '../../progression/index.js';
import { hunterJobType, isHunterJob } from '../../readviews/index.js';
import { manhattan } from '../../spatial/metric.js';
import { entityNode } from '../../spatial/nodes.js';
import { buildingTypeByContentId, tiersAtOrAbove } from '../content-lookup.js';
import { OPENING_HUNT_UNTIL_TICKS } from '../game-phase.js';
import { isBuilt, ownedBuildings, ownedSettlers } from '../seat-roster.js';
import type { SpareForce } from './pool.js';

/**
 * The tier whose completion ends the opening hunt: a chosen milestone late in the build order, which
 * keeps the hunt running while nearby game lasts. No readable source says when the original's opening
 * hunt ends (approximation).
 */
export const OPENING_HUNT_UNTIL_BUILDING_ID = 'work_bakery_01';

/**
 * The opening hunter: one man employed at the seat's base on its hunter slot, handed back to the civilian
 * pool once {@link OPENING_HUNT_UNTIL_TICKS} passes or {@link OPENING_HUNT_UNTIL_BUILDING_ID} stands built,
 * and earlier once he idles with no game left on the base's hunting ground (authored). Employed rather than
 * flag-bound because the post gives him the base as his hunting ground and banks his kills as food.
 * Content missing the hunter trade or the base's hunter seat hires nobody.
 */
export function allocateOpeningHunter(
  world: World,
  ctx: SystemContext,
  player: number,
  base: Entity,
  force: SpareForce,
  builderJob: number | null,
): PlayerCommand[] {
  const hunterJob = hunterJobType(ctx.content);
  if (hunterJob === null) return [];
  if (!offersHunterSeat(world, ctx, base, hunterJob)) return [];
  const posted = huntersAt(world, ctx, player, base);
  if (openingHuntOver(world, ctx, player)) return retireHunters(world, posted, builderJob);
  if (posted.length > 0) {
    const idle = posted.some((e) => !world.has(e, CurrentAtomic));
    if (idle && !huntWorkLeft(world, ctx, base, hunterJob, posted, HUNT_CHASE_SLACK_NODES)) {
      return retireHunters(world, posted, builderJob);
    }
    return [];
  }
  if (!huntWorkLeft(world, ctx, base, hunterJob, posted, 0)) return [];
  // Only the per-settler half of the command's own gate is left to ask of a candidate: `posted` above
  // is already this building's whole hunter headcount, since a workplace employs its owner's men alone.
  const spare = force.take((e) => settlerMeetsNeed(world, ctx, needSubjectOf(world, e), 'job', hunterJob));
  if (spare === null) return [];
  return [{ kind: 'assignWorker', entity: spare, building: base, jobPriority: [hunterJob] }];
}

function huntersAt(world: World, ctx: SystemContext, player: number, base: Entity): Entity[] {
  return ownedSettlers(world, player).filter(
    (e) =>
      world.tryGet(e, JobAssignment)?.workplace === base &&
      isHunterJob(ctx.content, world.get(e, Settler).jobType),
  );
}

/** Whether the base's building type declares a `hunterJob` worker slot at all. */
function offersHunterSeat(world: World, ctx: SystemContext, base: Entity, hunterJob: number): boolean {
  const type = contentIndex(ctx.content).buildings.get(world.get(base, Building).buildingType);
  return type?.workers.some((w) => w.jobType === hunterJob && w.count > 0) ?? false;
}

/** Whether the opening hunt is over by the clock, or by the milestone: a built building at the named tier
 *  or above on its upgrade chain. True on content lacking the tier. */
function openingHuntOver(world: World, ctx: SystemContext, player: number): boolean {
  if (ctx.tick >= OPENING_HUNT_UNTIL_TICKS) return true;
  const target = buildingTypeByContentId(ctx.content, OPENING_HUNT_UNTIL_BUILDING_ID);
  if (target === undefined) return true;
  const tiers = tiersAtOrAbove(contentIndex(ctx.content), target);
  return ownedBuildings(world, player).some(
    (e) => isBuilt(world, e) && tiers.has(world.get(e, Building).buildingType),
  );
}

/**
 * Whether the base's hunting ground, widened by `slack` nodes, still holds live game a hunter could walk
 * to or an unbanked carcass of a posted hunter's. The hire asks the bare ground and the retirement the
 * chase leash, so game grazing on the edge does not flip the post each decision. Mapless: always true.
 */
function huntWorkLeft(
  world: World,
  ctx: SystemContext,
  base: Entity,
  hunterJob: number,
  posted: readonly Entity[],
  slack: number,
): boolean {
  const terrain = ctx.terrain;
  if (terrain === undefined || !world.has(base, Position)) return true;
  const ground = baseHuntingGround(world, terrain, base);
  if (posted.some((h) => huntingGroundHoldsCarcass(world, ctx, terrain, h, hunterJob, ground))) return true;
  const reach = ground.radius + slack;
  const home = terrain.componentOf(ground.anchorCell);
  // Wildlife is the StayPoint carrier set, far smaller than the settler store.
  for (const t of world.query(StayPoint, Settler, Position)) {
    if (!isHuntTarget(world, ctx, t, hunterJob)) continue;
    const at = entityNode(world, terrain, t);
    if (manhattan(terrain, ground.anchorCell, at) > reach) continue;
    if (home < 0 || terrain.componentOf(at) === home) return true;
  }
  return false;
}

/** The ground the base's employed hunters hunt: the {@link HUNTER_WORK_FLAG_RADIUS} circle round it. */
function baseHuntingGround(
  world: World,
  terrain: TerrainGraph,
  base: Entity,
): { anchorCell: NodeId; radius: number } {
  const p = world.get(base, Position);
  const n = nodeOfPosition(p.x, p.y);
  return { anchorCell: terrain.nodeAtClamped(n.hx, n.hy), radius: HUNTER_WORK_FLAG_RADIUS };
}

/** Hand the opening hunters back to the pool as builders, leaving a man mid-action alone. */
function retireHunters(world: World, posted: readonly Entity[], builderJob: number | null): PlayerCommand[] {
  if (builderJob === null) return [];
  return posted
    .filter((e) => !world.has(e, CurrentAtomic))
    .map((e) => ({ kind: 'setJob', entity: e, jobType: builderJob }));
}
