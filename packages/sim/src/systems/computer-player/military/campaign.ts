import { buildingHitpointsFor } from '@open-northland/data';
import {
  Building,
  fightsPlayer,
  Health,
  Owner,
  ownerOf,
  Person,
  Position,
} from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { type BuildingCombatClass, buildingCombatClass } from '../../readviews/index.js';
import { interactionCell } from '../../settlers/targets/index.js';
import { manhattan } from '../../spatial/metric.js';
import { entityNode } from '../../spatial/nodes.js';
import { playerSeesEntity } from '../../vision/gates.js';
import { believedBuildings } from '../knowledge/intel/index.js';

/** The objective tiers, best first. The building order is the CombatSystem's own siege priority
 *  ({@link buildingCombatClass}), so a wave marches on what a warrior in the field would pick; a wall,
 *  which no warrior picks, is no objective. */
const SIEGE_TIERS: readonly BuildingCombatClass[] = ['hq', 'tower', 'other'];

/** What a wave marches on, as the seat believes it: the entity names the objective for a retarget and may
 *  no longer exist when it is a remembered building; `owner` is the one the seat last saw. */
export interface CampaignObjective {
  readonly entity: Entity;
  readonly owner: number;
  /** Where the wave walks: a seen building's interaction cell, a remembered one's anchor node, a
   *  person's node. */
  readonly node: NodeId;
}

/** A candidate before its approach node is paid for: a seen entity is read live, a remembered building by
 *  its anchor. */
interface Candidate {
  readonly entity: Entity;
  readonly owner: number;
  readonly anchor: { readonly hx: number; readonly hy: number } | null;
}

/**
 * What the seat's army marches on: the nearest enemy headquarters to its muster point (authored), with
 * the lower {@link SIEGE_TIERS} behind it so a wave never stalls for want of an HQ. Distance is Manhattan
 * over half-cell nodes from `rally` to the candidate's approach node, the lowest id on a tie. A candidate
 * must belong to another player, stand on ground connected to the rally, and be able to fall: a seen one
 * holds a live `Health` pool, a remembered one is of a type with hitpoints, because a wave sent at a
 * hitpoint-less building could never resolve its objective. A construction site holds a pool from its
 * first hitpoint, so it is a candidate like any other building.
 *
 * The seat marches only on what it knows: the buildings it believes stand ({@link believedBuildings}, the
 * start layout included), else the enemy people it sees now. A remembered building that fell out of sight
 * stays the objective until the seat sees its spot.
 */
export function campaignObjective(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  rally: NodeId,
): CampaignObjective | null {
  const home = terrain.componentOf(rally);
  if (home < 0) return null; // an unwalkable rally connects to nothing - every label would mismatch

  // Bucket the enemy's standing buildings by tier first: the door and distance work below is then paid
  // only for the best tier that has a reachable member, not for every building on the map.
  const byTier = new Map<BuildingCombatClass, Candidate[]>();
  const add = (tier: BuildingCombatClass, candidate: Candidate): void => {
    const bucket = byTier.get(tier);
    if (bucket === undefined) byTier.set(tier, [candidate]);
    else bucket.push(candidate);
  };
  const { seen, remembered } = believedBuildings(world, ctx, player);
  for (const e of seen) {
    const owner = liveEnemyOwner(world, e, player);
    if (owner !== null)
      add(buildingCombatClass(ctx, world.get(e, Building).buildingType), { entity: e, owner, anchor: null });
  }
  for (const b of remembered) {
    if (b.owner === player || !fightsPlayer(world, player, b.owner)) continue;
    if (!typeCanFall(ctx, b.buildingType)) continue;
    add(buildingCombatClass(ctx, b.buildingType), { entity: b.entity, owner: b.owner, anchor: b });
  }
  const approachOf = ({ entity, anchor }: Candidate): NodeId =>
    anchor === null
      ? objectiveNode(world, ctx, terrain, entity)
      : terrain.nodeAtClamped(anchor.hx, anchor.hy);
  for (const tier of SIEGE_TIERS) {
    const winner = nearestReachable(terrain, byTier.get(tier) ?? [], rally, home, approachOf);
    if (winner !== null) return winner;
  }

  // The Person key is what keeps a claimed herd out: it is loot, not a war aim.
  const people: Candidate[] = [];
  for (const e of world.canonicalQuery(Person, Owner)) {
    const owner = liveEnemyOwner(world, e, player);
    if (owner !== null && playerSeesEntity(world, ctx.fog, player, e))
      people.push({ entity: e, owner, anchor: null });
  }
  return nearestReachable(terrain, people, rally, home, approachOf);
}

/** {@link campaignObjective}'s entity. */
export function campaignTarget(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  rally: NodeId,
): Entity | null {
  return campaignObjective(world, ctx, terrain, player, rally)?.entity ?? null;
}

/** Where a wave walks to reach a live objective: a building is measured and reached by its interaction
 *  cell (its own node is unwalkable), a person by the node he stands on. */
function objectiveNode(world: World, ctx: SystemContext, terrain: TerrainGraph, target: Entity): NodeId {
  return world.has(target, Building)
    ? interactionCell(world, ctx, terrain, target)
    : entityNode(world, terrain, target);
}

/** The candidate nearest `rally` whose approach node shares the `home` connectivity label, the lowest id
 *  on a tie, or null. */
function nearestReachable(
  terrain: TerrainGraph,
  candidates: readonly Candidate[],
  rally: NodeId,
  home: number,
  approachOf: (c: Candidate) => NodeId,
): CampaignObjective | null {
  let best: CampaignObjective | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const c of candidates) {
    const approach = approachOf(c);
    if (terrain.componentOf(approach) !== home) continue;
    const distance = manhattan(terrain, approach, rally);
    if (distance < bestDistance || (distance === bestDistance && best !== null && c.entity < best.entity)) {
      best = { entity: c.entity, owner: c.owner, node: approach };
      bestDistance = distance;
    }
  }
  return best;
}

/** The owner of `e` when this seat fights ({@link fightsPlayer}) and `e` can be struck at all - the
 *  same directed hostility `mayTarget` engages on, so a wave never marches on an objective the
 *  CombatSystem would refuse - else null. Reads `e` live, so only for an entity the seat sees. */
function liveEnemyOwner(world: World, e: Entity, player: number): number | null {
  const owner = ownerOf(world, e);
  if (owner === undefined || owner === player) return null;
  if (!fightsPlayer(world, player, owner)) return null;
  if (!world.has(e, Position)) return null;
  const health = world.tryGet(e, Health);
  return health !== undefined && health.hitpoints > 0 ? owner : null;
}

/** Whether a building of `buildingType` carries hitpoints, a static content fact a remembered building is
 *  judged by. */
function typeCanFall(ctx: SystemContext, buildingType: number): boolean {
  const type = contentIndex(ctx.content).buildings.get(buildingType);
  return type !== undefined && buildingHitpointsFor(type, undefined) !== undefined;
}
