import { Building, Health, Livestock, Owner, ownerOf, Position, Settler } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { type BuildingCombatClass, buildingCombatClass } from '../../readviews/index.js';
import { interactionCell } from '../../settlers/targets/index.js';
import { canonicalById, entityNode, manhattan } from '../../spatial/nodes.js';
import { isBuilt } from '../shared.js';

/** The objective tiers, best first: the enemy's seat, then the towers shooting back, then the rest of
 *  its buildings, then its people. The building order is the CombatSystem's own siege priority
 *  ({@link buildingCombatClass}), so a wave marches on what a warrior in the field would pick. */
const SIEGE_TIERS: readonly BuildingCombatClass[] = ['hq', 'tower', 'other'];

/**
 * What the seat's army marches on: the nearest enemy headquarters to its muster point (user rule), with
 * the lower {@link SIEGE_TIERS} behind it so a wave never stalls for want of an HQ. Distance is Manhattan
 * over half-cell nodes from `rally`; a building is measured and reached by its interaction cell, since
 * its own node is unwalkable.
 *
 * A candidate must be another player's (`mayTarget`'s owner axis), stand on ground connected to the
 * rally, and hold a live `Health` pool - content that pins no `hitpoints` gives its buildings none, and
 * an `attackUnit` order aimed there is dropped, leaving the wave benched.
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

  // Sort the enemy's standing buildings by tier first: the door and distance work below is then paid
  // only for the best tier that has a reachable member, not for every building on the map.
  const byTier = new Map<BuildingCombatClass, Entity[]>();
  for (const e of canonicalById(world.query(Building, Owner))) {
    if (!isEnemy(world, e, player) || !isBuilt(world, e)) continue;
    const tier = buildingCombatClass(ctx, world.get(e, Building).buildingType);
    const bucket = byTier.get(tier);
    if (bucket === undefined) byTier.set(tier, [e]);
    else bucket.push(e);
  }
  for (const tier of SIEGE_TIERS) {
    const winner = nearestReachable(terrain, byTier.get(tier) ?? [], rally, home, (e) =>
      interactionCell(world, ctx, terrain, e),
    );
    if (winner !== null) return winner;
  }

  const people = canonicalById(world.query(Settler, Owner)).filter(
    // A claimed herd is loot, not a war aim.
    (e) => isEnemy(world, e, player) && !world.has(e, Livestock),
  );
  return nearestReachable(terrain, people, rally, home, (e) => entityNode(world, terrain, e));
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

/** Whether `e` belongs to another player and can be struck at all (see {@link campaignTarget}). */
function isEnemy(world: World, e: Entity, player: number): boolean {
  if (ownerOf(world, e) === player) return false;
  if (!world.has(e, Position)) return false;
  const health = world.tryGet(e, Health);
  return health !== undefined && health.hitpoints > 0;
}
