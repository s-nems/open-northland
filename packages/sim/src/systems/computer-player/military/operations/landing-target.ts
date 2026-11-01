import { buildingHitpointsFor } from '@open-northland/data';
import { Building, diplomacyStance, Health, ownerOf } from '../../../../components/index.js';
import { contentIndex } from '../../../../core/content-index.js';
import type { Entity } from '../../../../ecs/world.js';
import { type HalfCellNode, nodeManhattan } from '../../../../nav/halfcell.js';
import type { NodeId } from '../../../../nav/terrain/index.js';
import { anchorNodeOf } from '../../../ai-shared/node-geometry.js';
import type { SystemContext } from '../../../context.js';
import {
  ARMOR_MATERIAL,
  buildingCombatClass,
  houseBow,
  shelterCapacityOf,
} from '../../../readviews/index.js';
import { interactionCell } from '../../../settlers/targets/index.js';
import { believedBuildings } from '../../knowledge/intel/index.js';
import type { OwnedHeadquarters } from '../../sea-route.js';
import { fighterPoints } from '../points.js';
import type { OperationEnv } from './lifecycle.js';
import { RAID_TOWER_CLEARANCE_NODES } from './raid-target.js';

// What a landing strikes once ashore and what it keeps clear of: the rival's towers and the buildings
// his people shelter in on alarm, which shoot every landed man in reach and fall only to a siege. Read
// from what the seat believes stands, so no fog leaks.

/** A bare man's armour blocks nothing. */
const NO_BLOCKING = 0;

/** One enemy building the seat believes stands, with where a band walks to strike it. */
interface BelievedTarget {
  readonly entity: Entity;
  readonly buildingType: number;
  readonly at: HalfCellNode;
  readonly approach: NodeId;
}

/** Whether a building of `buildingType` shoots a landing: a tower, or a type its owner's people shelter in
 *  and fire from on alarm. */
function shoots(ctx: SystemContext, buildingType: number): boolean {
  return (
    buildingCombatClass(ctx, buildingType) === 'tower' || shelterCapacityOf(ctx.content, buildingType) > 0
  );
}

/** The enemy buildings on `land` the seat believes stand and could fall: a seen one with hitpoints left, a
 *  remembered one out of sight of a type with hitpoints. Walls are no target. Costs the believed
 *  buildings. */
function believedTargets(env: OperationEnv, land: number): BelievedTarget[] {
  const { world, ctx, terrain, seat } = env;
  const enemy = (owner: number): boolean => owner !== seat && diplomacyStance(world, seat, owner) === 'enemy';
  const targets: BelievedTarget[] = [];
  const { seen, remembered } = believedBuildings(world, ctx, seat);
  for (const e of seen) {
    const building = world.get(e, Building);
    const owner = ownerOf(world, e);
    if (owner === undefined || !enemy(owner) || (world.tryGet(e, Health)?.hitpoints ?? 0) <= 0) continue;
    const at = anchorNodeOf(world, e);
    const approach = interactionCell(world, ctx, terrain, e);
    if (at !== null && terrain.componentOf(approach) === land)
      targets.push({ entity: e, buildingType: building.buildingType, at, approach });
  }
  for (const b of remembered) {
    if (!enemy(b.owner)) continue;
    const type = contentIndex(ctx.content).buildings.get(b.buildingType);
    if (type === undefined || buildingHitpointsFor(type, undefined) === undefined) continue;
    const approach = terrain.nodeAtClamped(b.hx, b.hy);
    if (terrain.componentOf(approach) === land)
      targets.push({ entity: b.entity, buildingType: b.buildingType, at: { hx: b.hx, hy: b.hy }, approach });
  }
  return targets.filter((t) => buildingCombatClass(ctx, t.buildingType) !== 'wall');
}

/** The spots on `land` the seat believes enemy fire covers: its towers and shelters ({@link shoots}). */
export function believedFireSources(env: OperationEnv, land: number): HalfCellNode[] {
  return believedTargets(env, land)
    .filter((t) => shoots(env.ctx, t.buildingType))
    .map((t) => t.at);
}

/** Whether `at` lies within {@link RAID_TOWER_CLEARANCE_NODES} of any of `sources`. */
export function underFire(sources: readonly HalfCellNode[], at: HalfCellNode): boolean {
  return sources.some((s) => nodeManhattan(s, at) <= RAID_TOWER_CLEARANCE_NODES);
}

/**
 * What landed men standing at `from` on `land` strike next: an enemy headquarters there first, wherever it
 * stands (it falls fast and is the war aim), else the enemy building nearest `from` that lies clear of every
 * believed tower's and shelter's reach ({@link underFire}), the lower id on a tie. Null once none is left:
 * the rest of the land is a siege, not a landing's work.
 */
export function landingObjective(
  env: OperationEnv,
  land: number,
  from: HalfCellNode,
): { readonly entity: Entity; readonly node: NodeId } | null {
  const { ctx } = env;
  const targets = believedTargets(env, land);
  const sources = targets.filter((t) => shoots(ctx, t.buildingType)).map((t) => t.at);
  let best: BelievedTarget | null = null;
  let bestRank = 0;
  let bestDistance = 0;
  for (const t of targets) {
    const hq = buildingCombatClass(ctx, t.buildingType) === 'hq';
    if (!hq && underFire(sources, t.at)) continue;
    const rank = hq ? 0 : 1;
    const distance = nodeManhattan(t.at, from);
    if (
      best === null ||
      rank < bestRank ||
      (rank === bestRank &&
        (distance < bestDistance || (distance === bestDistance && t.entity < best.entity)))
    ) {
      best = t;
      bestRank = rank;
      bestDistance = distance;
    }
  }
  return best === null ? null : { entity: best.entity, node: best.approach };
}

/**
 * The fire of `hq`'s owner's shelters the seat believes stand, in fighter points: each building of a type
 * that shelters people on alarm counts its whole room as archers of his house bow ({@link houseBow}), bare
 * men weighed by {@link fighterPoints}. Approximation: the room is taken as full and the archers as men who
 * can be cut down, where a shelter's people are reached only through its walls. Costs the owner's believed
 * buildings.
 */
export function believedShelterFire(env: OperationEnv, hq: OwnedHeadquarters): number {
  const { world, ctx, seat } = env;
  let room = 0;
  // A remembered building's tribe is the headquarters' (a seat's nation is no secret).
  let tribe = world.tryGet(hq.entity, Building)?.tribe ?? null;
  const { seen, remembered } = believedBuildings(world, ctx, seat, hq.owner);
  for (const e of seen) {
    const building = world.get(e, Building);
    if ((world.tryGet(e, Health)?.hitpoints ?? 0) <= 0) continue;
    room += shelterCapacityOf(ctx.content, building.buildingType);
    tribe ??= building.tribe;
  }
  for (const b of remembered) room += shelterCapacityOf(ctx.content, b.buildingType);
  const bow = tribe === null ? undefined : houseBow(ctx.content, tribe);
  if (room === 0 || bow === undefined) return 0;
  return room * fighterPoints(ctx.content, bow, ARMOR_MATERIAL.NONE, NO_BLOCKING);
}
