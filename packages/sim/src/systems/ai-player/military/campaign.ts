import {
  Building,
  diplomacyStance,
  Health,
  Owner,
  ownerOf,
  Person,
  Position,
} from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { type BuildingCombatClass, buildingCombatClass } from '../../readviews/index.js';
import { interactionCell } from '../../settlers/targets/index.js';
import { manhattan } from '../../spatial/metric.js';
import { entityNode } from '../../spatial/nodes.js';

/** The objective tiers, best first. The building order is the CombatSystem's own siege priority
 *  ({@link buildingCombatClass}), so a wave marches on what a warrior in the field would pick. */
const SIEGE_TIERS: readonly BuildingCombatClass[] = ['hq', 'tower', 'other'];

/**
 * What the seat's army marches on: the nearest enemy headquarters to its muster point (authored), with
 * the lower {@link SIEGE_TIERS} behind it so a wave never stalls for want of an HQ. Distance is Manhattan
 * over half-cell nodes from `rally` to the candidate's approach node. A candidate must belong to another
 * player, stand on ground connected to the rally, and hold a live `Health` pool, because a wave sent at a
 * hitpoint-less building could never resolve its objective. A construction site holds a pool from its
 * first hitpoint, so it is a candidate like any other building.
 */
export function campaignTarget(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  rally: NodeId,
): Entity | null {
  const home = terrain.componentOf(rally);
  if (home < 0) return null; // an unwalkable rally connects to nothing - every label would mismatch

  // Bucket the enemy's standing buildings by tier first: the door and distance work below is then paid
  // only for the best tier that has a reachable member, not for every building on the map.
  const byTier = new Map<BuildingCombatClass, Entity[]>();
  for (const e of world.canonicalQuery(Building, Owner)) {
    if (!isEnemy(world, e, player)) continue;
    const tier = buildingCombatClass(ctx, world.get(e, Building).buildingType);
    const bucket = byTier.get(tier);
    if (bucket === undefined) byTier.set(tier, [e]);
    else bucket.push(e);
  }
  const approachOf = (e: Entity): NodeId => objectiveNode(world, ctx, terrain, e);
  for (const tier of SIEGE_TIERS) {
    const winner = nearestReachable(terrain, byTier.get(tier) ?? [], rally, home, approachOf);
    if (winner !== null) return winner;
  }

  // The Person key is what keeps a claimed herd out: it is loot, not a war aim.
  const people = world.canonicalQuery(Person, Owner).filter((e) => isEnemy(world, e, player));
  return nearestReachable(terrain, people, rally, home, approachOf);
}

/** Where a wave walks to reach an objective: a building is measured and reached by its interaction cell
 *  (its own node is unwalkable), a person by the node he stands on. */
export function objectiveNode(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  target: Entity,
): NodeId {
  return world.has(target, Building)
    ? interactionCell(world, ctx, terrain, target)
    : entityNode(world, terrain, target);
}

/** The candidate nearest `rally` whose approach node shares the `home` connectivity label, or null.
 *  Candidates arrive ascending-id, so the strict `<` keeps the lowest id among equal distances. */
function nearestReachable(
  terrain: TerrainGraph,
  candidates: readonly Entity[],
  rally: NodeId,
  home: number,
  approachOf: (e: Entity) => NodeId,
): Entity | null {
  let best: Entity | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const e of candidates) {
    const approach = approachOf(e);
    if (terrain.componentOf(approach) !== home) continue;
    const distance = manhattan(terrain, approach, rally);
    if (distance < bestDistance) {
      best = e;
      bestDistance = distance;
    }
  }
  return best;
}

/** Whether `e` belongs to a player this seat holds an `enemy` stance toward and can be struck at all -
 *  the same directed hostility `mayTarget` engages on, so a wave never marches on an objective the
 *  CombatSystem would refuse. */
function isEnemy(world: World, e: Entity, player: number): boolean {
  const owner = ownerOf(world, e);
  if (owner === undefined || owner === player) return false;
  if (diplomacyStance(world, player, owner) !== 'enemy') return false;
  if (!world.has(e, Position)) return false;
  const health = world.tryGet(e, Health);
  return health !== undefined && health.hitpoints > 0;
}
