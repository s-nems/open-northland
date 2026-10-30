import type { ContentSet } from '@open-northland/data';
import {
  Building,
  diplomacyStance,
  Health,
  MAX_PLAYERS,
  mapBriefOf,
  type OperationTarget,
  Person,
  Position,
  Settler,
} from '../../../../components/index.js';
import { contentIndex } from '../../../../core/content-index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import { type HalfCellNode, nodeManhattan, nodeOfPosition } from '../../../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../../../nav/terrain/index.js';
import { TOWER_POST_STRENGTH } from '../../../ai-shared/military/census.js';
import { anchorNodeOf } from '../../../ai-shared/node-geometry.js';
import { ownedSettlers } from '../../../ai-shared/seat-roster.js';
import type { SystemContext } from '../../../context.js';
import { jobGatherGoods } from '../../../economy/gather-goods.js';
import { ownedFightersOf } from '../../../movement/collision/owned-fighters.js';
import { combatClassOfType } from '../../../readviews/buildings.js';
import { buildingCombatClass, isFighterJob } from '../../../readviews/index.js';
import { playerSeesNode } from '../../../vision/gates.js';
import { believedBuildings, rememberedBuildings } from '../../knowledge/intel/index.js';
import { isLiveFighter, unitPoints } from '../points.js';

// Where a raid strikes and how it gets there: what the seat sees or remembers of the enemy's economy,
// scored against what it believes defends it. Every figure is authored; the source basis is the owner's
// ruling that a raid hits gatherers at the edge of a base, from the side, away from towers and armies.

/** What a gatherer the seat sees is worth to a raid, in fighter points (authored): about four short
 *  swordsmen, so a lone tower's believed garrison outweighs it. */
export const RAID_GATHERER_VALUE = 100;
/** What a remembered economy building is worth, its gatherers unseen (authored): below a seen gatherer. */
export const RAID_ECONOMY_BUILDING_VALUE = 60;
/** What a tower counts as on top of its believed garrison (authored): more than any target is worth, so a
 *  target in a tower's reach never wins. */
export const RAID_TOWER_DEFENCE = 1000;
/** How far a tower reaches over a raid, in half-cell nodes (authored): a catapult's longest reach and a
 *  few ranks behind it, so a band stops that far short of a tower. */
export const RAID_TOWER_CLEARANCE_NODES = 30;
/** How near a target or the band an enemy fighter counts as defending it, in half-cell nodes (authored:
 *  about a soldier's sight). */
export const RAID_DEFENCE_RADIUS_NODES = 20;
/** Half-cell nodes of trip that cost one point of a target's score (authored): a 200-node trip costs half
 *  a gatherer. */
export const RAID_NODES_PER_POINT = 4;
/** How far off the straight line from home to the enemy base the band swings (authored). */
export const RAID_FLANK_NODES = 30;

/** A believed enemy tower and the points its posts were last seen holding. */
interface TowerBelief {
  readonly at: HalfCellNode;
  readonly postedPoints: number;
}

/** A visible enemy fighter's spot and points. */
interface FighterSighting {
  readonly at: HalfCellNode;
  readonly points: number;
}

/** What the seat believes guards one enemy's ground. */
export interface EnemyDefence {
  readonly towers: readonly TowerBelief[];
  readonly fighters: readonly FighterSighting[];
}

export interface RaidPick {
  readonly target: OperationTarget;
  readonly score: number;
}

/** The enemy towers `seat` believes stand, of `owner`, with the posts it last saw on them: a seen one with
 *  hitpoints left, a remembered one out of sight as last seen. Costs the owner's believed buildings. */
export function believedTowers(world: World, ctx: SystemContext, seat: number, owner: number): TowerBelief[] {
  const postedByBuilding = new Map<Entity, number>();
  for (const b of rememberedBuildings(world, seat)) postedByBuilding.set(b.entity, b.postedPoints);
  const towers: TowerBelief[] = [];
  const { seen, remembered } = believedBuildings(world, ctx, seat, owner);
  for (const e of seen) {
    if (buildingCombatClass(ctx, world.get(e, Building).buildingType) !== 'tower') continue;
    if ((world.tryGet(e, Health)?.hitpoints ?? 0) <= 0) continue;
    const at = anchorNodeOf(world, e);
    if (at !== null) towers.push({ at, postedPoints: postedByBuilding.get(e) ?? 0 });
  }
  for (const b of remembered) {
    if (buildingCombatClass(ctx, b.buildingType) === 'tower')
      towers.push({ at: { hx: b.hx, hy: b.hy }, postedPoints: b.postedPoints });
  }
  return towers;
}

/** `owner`'s fighters `seat` sees now and their points. Costs the owner's fighters. */
export function visibleFighters(
  world: World,
  ctx: SystemContext,
  seat: number,
  owner: number,
): FighterSighting[] {
  const seen: FighterSighting[] = [];
  for (const e of ownedFightersOf(world, ctx.content, owner)) {
    if (!isLiveFighter(world, e)) continue;
    const at = nodeOfEntity(world, e);
    if (at === null || !playerSeesNode(ctx.fog, seat, at.hx, at.hy)) continue;
    seen.push({ at, points: unitPoints(world, ctx, e) });
  }
  return seen;
}

/** The points `defence` holds over `at`: every tower in reach at {@link RAID_TOWER_DEFENCE} plus its
 *  garrison weighed {@link TOWER_POST_STRENGTH} times, and every fighter within
 *  {@link RAID_DEFENCE_RADIUS_NODES}. */
export function defenceAt(defence: EnemyDefence, at: HalfCellNode): number {
  let points = 0;
  for (const tower of defence.towers) {
    if (nodeManhattan(tower.at, at) <= RAID_TOWER_CLEARANCE_NODES)
      points += RAID_TOWER_DEFENCE + tower.postedPoints * TOWER_POST_STRENGTH;
  }
  return points + fighterPointsNear(defence.fighters, at);
}

export function fighterPointsNear(fighters: readonly FighterSighting[], at: HalfCellNode): number {
  let points = 0;
  for (const f of fighters) if (nodeManhattan(f.at, at) <= RAID_DEFENCE_RADIUS_NODES) points += f.points;
  return points;
}

export function towerInReach(towers: readonly TowerBelief[], at: HalfCellNode): boolean {
  return towers.some((tower) => nodeManhattan(tower.at, at) <= RAID_TOWER_CLEARANCE_NODES);
}

/**
 * The best raid target for `seat` from `home`: an enemy gatherer it sees, or an enemy economy building it
 * believes stands (`knowledge/intel`), on `home`'s land, scored value minus believed defence minus trip
 * length; the highest positive score, ties to the lower entity id. Null when nothing scores above zero.
 * Costs the enemies' people, fighters and believed buildings.
 */
export function pickRaidTarget(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  seat: number,
  home: NodeId,
): RaidPick | null {
  const from = nodeOfId(terrain, home);
  const land = terrain.componentOf(home);
  let best: RaidPick | null = null;
  const consider = (
    entity: Entity,
    owner: number,
    at: HalfCellNode,
    value: number,
    defence: EnemyDefence,
  ) => {
    if (terrain.componentOf(terrain.nodeAtClamped(at.hx, at.hy)) !== land) return;
    const score = value - defenceAt(defence, at) - Math.floor(nodeManhattan(from, at) / RAID_NODES_PER_POINT);
    if (score <= 0) return;
    if (best === null || score > best.score || (score === best.score && entity < (best.target.entity ?? 0)))
      best = { target: { hx: at.hx, hy: at.hy, entity, owner }, score };
  };
  for (let owner = 0; owner < MAX_PLAYERS; owner++) {
    if (owner === seat || diplomacyStance(world, seat, owner) !== 'enemy') continue;
    const defence = {
      towers: believedTowers(world, ctx, seat, owner),
      fighters: visibleFighters(world, ctx, seat, owner),
    };
    for (const e of visibleGatherers(world, ctx, seat, owner)) {
      const at = nodeOfEntity(world, e);
      if (at !== null) consider(e, owner, at, RAID_GATHERER_VALUE, defence);
    }
    const { seen, remembered } = believedBuildings(world, ctx, seat, owner);
    for (const e of seen) {
      if (!isEconomyBuilding(ctx, world.get(e, Building).buildingType)) continue;
      const at = anchorNodeOf(world, e);
      if (at !== null) consider(e, owner, at, RAID_ECONOMY_BUILDING_VALUE, defence);
    }
    for (const b of remembered) {
      if (isEconomyBuilding(ctx, b.buildingType))
        consider(b.entity, owner, { hx: b.hx, hy: b.hy }, RAID_ECONOMY_BUILDING_VALUE, defence);
    }
  }
  return best;
}

/** `owner`'s gatherers `seat` sees now, ascending id. Costs the owner's people. */
export function visibleGatherers(world: World, ctx: SystemContext, seat: number, owner: number): Entity[] {
  const seen: Entity[] = [];
  for (const e of ownedSettlers(world, owner)) {
    if (!isGatherer(world, ctx, e)) continue;
    const at = nodeOfEntity(world, e);
    if (at !== null && playerSeesNode(ctx.fog, seat, at.hx, at.hy)) seen.push(e);
  }
  return seen;
}

/** A live person whose trade takes goods off the map and who is no fighter. */
export function isGatherer(world: World, ctx: SystemContext, e: Entity): boolean {
  if (!world.has(e, Person) || (world.tryGet(e, Health)?.hitpoints ?? 0) <= 0) return false;
  const jobType = world.tryGet(e, Settler)?.jobType;
  if (jobType === undefined || jobType === null || isFighterJob(ctx.content, jobType)) return false;
  return jobGatherGoods(ctx, jobType).length > 0;
}

const economyTypesByContent = new WeakMap<ContentSet, ReadonlySet<number>>();

/** Whether `buildingType` employs a gatherer and is neither headquarters nor a tower or wall. */
export function isEconomyBuilding(ctx: SystemContext, buildingType: number): boolean {
  let types = economyTypesByContent.get(ctx.content);
  if (types === undefined) {
    const found = new Set<number>();
    for (const type of contentIndex(ctx.content).buildings.values()) {
      if (combatClassOfType(type) !== 'other') continue;
      if (type.workers.some((w) => jobGatherGoods(ctx, w.jobType).length > 0)) found.add(type.typeId);
    }
    types = found;
    economyTypesByContent.set(ctx.content, types);
  }
  return types.has(buildingType);
}

/**
 * The flank waypoint a band from `home` walks before it strikes `target`: the midpoint of the trip pushed
 * {@link RAID_FLANK_NODES} sideways off the line from `home` to the target owner's base (its start anchor
 * in the map brief), toward the side the target lies on, the other side when that one is unwalkable, off
 * the home land or in a believed tower's reach, then half the swing. Empty when no swing qualifies: the
 * band goes straight in. Approximation: the walk between waypoints is the pathfinder's own and may pass a
 * tower the waypoint avoids.
 */
export function flankRoute(
  world: World,
  terrain: TerrainGraph,
  home: NodeId,
  target: OperationTarget,
  towers: readonly TowerBelief[],
): HalfCellNode[] {
  const from = nodeOfId(terrain, home);
  const to = { hx: target.hx, hy: target.hy };
  const base = baseOf(world, target.owner) ?? to;
  const dx = base.hx - from.hx;
  const dy = base.hy - from.hy;
  const span = Math.max(Math.abs(dx), Math.abs(dy));
  if (span === 0) return [];
  const cross = dx * (to.hy - from.hy) - dy * (to.hx - from.hx);
  const side = cross < 0 ? -1 : 1;
  const mid = { hx: (from.hx + to.hx) >> 1, hy: (from.hy + to.hy) >> 1 };
  const land = terrain.componentOf(home);
  for (const swing of [RAID_FLANK_NODES, RAID_FLANK_NODES >> 1]) {
    for (const sign of [side, -side]) {
      const at = {
        hx: mid.hx - Math.trunc((sign * dy * swing) / span),
        hy: mid.hy + Math.trunc((sign * dx * swing) / span),
      };
      const node = terrain.nodeAtClamped(at.hx, at.hy);
      if (!terrain.isWalkable(node) || terrain.componentOf(node) !== land) continue;
      const snapped = nodeOfId(terrain, node);
      if (!towerInReach(towers, snapped)) return [snapped];
    }
  }
  return [];
}

function baseOf(world: World, owner: number | null): HalfCellNode | null {
  if (owner === null) return null;
  const start = mapBriefOf(world)?.seats.find((s) => s.player === owner);
  return start === undefined ? null : { hx: start.hx, hy: start.hy };
}

export function nodeOfEntity(world: World, e: Entity): HalfCellNode | null {
  const pos = world.tryGet(e, Position);
  return pos === undefined ? null : nodeOfPosition(pos.x, pos.y);
}

function nodeOfId(terrain: TerrainGraph, node: NodeId): HalfCellNode {
  const { x, y } = terrain.coordsOf(node);
  return { hx: x, hy: y };
}
