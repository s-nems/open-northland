import type { ContentSet } from '@open-northland/data';
import {
  Building,
  diplomacyStance,
  Garrison,
  Health,
  isScriptedEconomySeat,
  MAX_PLAYERS,
  Militia,
  mapBriefOf,
  type OperationTarget,
  Owner,
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
/** The side of one square of the raid route search, in half-cell nodes (authored): a quarter of a tower's
 *  reach, fine enough to find the gaps between towers, coarse enough to search a whole map per raid. */
export const RAID_ROUTE_CELL_NODES = 8;
/** How near the target owner's start the route search makes every step dearer, in half-cell nodes
 *  (authored): the core of a base, so a band without towers in its way still comes in from the side. */
export const RAID_BASE_BERTH_NODES = 40;
/** How many times a step inside {@link RAID_BASE_BERTH_NODES} costs (authored). */
export const RAID_BASE_BERTH_COST = 3;
/** Route search step costs: a straight and a diagonal step between squares, near 1 : sqrt 2. */
const STRAIGHT_STEP = 2;
const DIAGONAL_STEP = 3;

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

/** The towers `seat` believes every enemy of it holds. Costs the enemies' believed buildings. */
export function believedEnemyTowers(world: World, ctx: SystemContext, seat: number): TowerBelief[] {
  const towers: TowerBelief[] = [];
  for (let owner = 0; owner < MAX_PLAYERS; owner++) {
    if (owner !== seat && diplomacyStance(world, seat, owner) === 'enemy')
      towers.push(...believedTowers(world, ctx, seat, owner));
  }
  return towers;
}

/** `owner`'s fighters and militiamen `seat` sees now and their points, leaving out the men posted in a
 *  tower (the tower belief weighs them): an armed civilian shoots a band as surely as a soldier. Costs the
 *  owner's fighters and every seat's militia. */
export function visibleFighters(
  world: World,
  ctx: SystemContext,
  seat: number,
  owner: number,
): FighterSighting[] {
  const seen: FighterSighting[] = [];
  for (const e of ownedFightersOf(world, ctx.content, owner)) {
    if (!isLiveFighter(world, e) || world.has(e, Garrison)) continue;
    const at = nodeOfEntity(world, e);
    if (at === null || !playerSeesNode(ctx.fog, seat, at.hx, at.hy)) continue;
    seen.push({ at, points: unitPoints(world, ctx, e) });
  }
  for (const e of world.query(Militia)) {
    if (world.tryGet(e, Owner)?.player !== owner || !isLiveFighter(world, e)) continue;
    const at = nodeOfEntity(world, e);
    if (at !== null && playerSeesNode(ctx.fog, seat, at.hx, at.hy))
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
 * The best raid target for `seat` from `home`: of an enemy player seat (no map-scripted one), a gatherer it
 * sees, or an enemy economy building it
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
    // Owner ruling: a raid hurts a player's production, never a map-scripted seat's camps.
    if (isScriptedEconomySeat(world, owner)) continue;
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

/** A live person whose trade takes goods off the map and who is no fighter, nor a civilian armed as militia. */
export function isGatherer(world: World, ctx: SystemContext, e: Entity): boolean {
  if (!world.has(e, Person) || world.has(e, Militia) || (world.tryGet(e, Health)?.hitpoints ?? 0) <= 0)
    return false;
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
 * The waypoints a band from `home` walks before it strikes `target`, clear of every believed tower's
 * reach: a cheapest route over squares of {@link RAID_ROUTE_CELL_NODES} on `home`'s land, a square closed
 * when no node of it is walkable or its node lies in a tower's reach, steps dearer within
 * {@link RAID_BASE_BERTH_NODES} of the target owner's start so the band comes in from the side; then pulled
 * tight to the squares where it must turn. Empty when the way is straight; null when every way crosses a
 * tower's reach. Approximation: the walk between waypoints is the pathfinder's own and may cut a corner
 * of a reach the waypoints keep clear of.
 */
export function flankRoute(
  world: World,
  terrain: TerrainGraph,
  home: NodeId,
  target: OperationTarget,
  towers: readonly TowerBelief[],
): HalfCellNode[] | null {
  const land = terrain.componentOf(home);
  const box = terrain.componentBounds(land);
  const grid = routeGrid(terrain, land, box, towers);
  const from = nodeOfId(terrain, home);
  const to = { hx: target.hx, hy: target.hy };
  const start = grid.squareOf(from);
  const goal = grid.squareOf(to);
  grid.open(start, from);
  grid.open(goal, to);
  const base = baseOf(world, target.owner);
  const path = cheapestSquares(grid, start, goal, (square) => {
    const at = grid.nodes[square];
    return base !== null && at !== undefined && nodeManhattan(at, base) <= RAID_BASE_BERTH_NODES
      ? RAID_BASE_BERTH_COST
      : 1;
  });
  if (path === null) return null;
  const waypoints: HalfCellNode[] = [];
  let anchor = 0;
  while (anchor < path.length - 1) {
    let reach = anchor + 1;
    for (let next = path.length - 1; next > reach; next--) {
      if (grid.clearLine(path[anchor] ?? start, path[next] ?? goal)) {
        reach = next;
        break;
      }
    }
    if (reach < path.length - 1) {
      const at = grid.nodes[path[reach] ?? goal];
      if (at !== undefined) waypoints.push(at);
    }
    anchor = reach;
  }
  return waypoints;
}

/** The route search's squares over one land: each open square's node, row-major, undefined when closed. */
interface RouteGrid {
  readonly columns: number;
  readonly rows: number;
  readonly nodes: (HalfCellNode | undefined)[];
  squareOf(at: HalfCellNode): number;
  /** Opens `square` at `at`: the home and the target are open whatever covers them. */
  open(square: number, at: HalfCellNode): void;
  /** Whether every square on the straight line between `a` and `b` is open. */
  clearLine(a: number, b: number): boolean;
}

function routeGrid(
  terrain: TerrainGraph,
  land: number,
  box: { minX: number; minY: number; maxX: number; maxY: number },
  towers: readonly TowerBelief[],
): RouteGrid {
  const side = RAID_ROUTE_CELL_NODES;
  const columns = Math.floor((box.maxX - box.minX) / side) + 1;
  const rows = Math.floor((box.maxY - box.minY) / side) + 1;
  const nodes: (HalfCellNode | undefined)[] = new Array(columns * rows);
  const half = side >> 1;
  const quarter = side >> 2;
  const probes = [
    [half, half],
    [quarter, quarter],
    [side - quarter, quarter],
    [quarter, side - quarter],
    [side - quarter, side - quarter],
  ] as const;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      for (const [dx, dy] of probes) {
        const node = terrain.nodeAtClamped(box.minX + column * side + dx, box.minY + row * side + dy);
        if (!terrain.isWalkable(node) || terrain.componentOf(node) !== land) continue;
        const at = nodeOfId(terrain, node);
        if (!towerInReach(towers, at)) nodes[row * columns + column] = at;
        break;
      }
    }
  }
  const clamp = (value: number, last: number) => Math.min(Math.max(value, 0), last);
  return {
    columns,
    rows,
    nodes,
    squareOf: (at) =>
      clamp(Math.floor((at.hy - box.minY) / side), rows - 1) * columns +
      clamp(Math.floor((at.hx - box.minX) / side), columns - 1),
    open: (square, at) => {
      nodes[square] = at;
    },
    clearLine: (a, b) => {
      const ax = a % columns;
      const ay = Math.floor(a / columns);
      const dx = (b % columns) - ax;
      const dy = Math.floor(b / columns) - ay;
      const steps = Math.max(Math.abs(dx), Math.abs(dy));
      for (let k = 1; k < steps; k++) {
        const x = ax + Math.floor((2 * dx * k + steps) / (2 * steps));
        const y = ay + Math.floor((2 * dy * k + steps) / (2 * steps));
        if (nodes[y * columns + x] === undefined) return false;
      }
      return true;
    },
  };
}

const NEIGHBOURS = [
  [1, 0, STRAIGHT_STEP],
  [-1, 0, STRAIGHT_STEP],
  [0, 1, STRAIGHT_STEP],
  [0, -1, STRAIGHT_STEP],
  [1, 1, DIAGONAL_STEP],
  [-1, 1, DIAGONAL_STEP],
  [1, -1, DIAGONAL_STEP],
  [-1, -1, DIAGONAL_STEP],
] as const;

/** The cheapest chain of open squares from `start` to `goal`, both included, stepping onto a square at its
 *  step cost times `weight(square)`; null when none joins them. Buckets by cost, each in push order, so
 *  the result never depends on more than the grid. */
function cheapestSquares(
  grid: RouteGrid,
  start: number,
  goal: number,
  weight: (square: number) => number,
): number[] | null {
  const { columns, rows, nodes } = grid;
  const cost = new Int32Array(columns * rows).fill(-1);
  const cameFrom = new Int32Array(columns * rows).fill(-1);
  const buckets: number[][] = [[start]];
  cost[start] = 0;
  for (let at = 0; at < buckets.length; at++) {
    for (const square of buckets[at] ?? []) {
      if (cost[square] !== at) continue;
      if (square === goal) {
        const path = [goal];
        for (let back = cameFrom[goal] ?? -1; back !== -1; back = cameFrom[back] ?? -1) path.push(back);
        return path.reverse();
      }
      const x = square % columns;
      const y = Math.floor(square / columns);
      for (const [dx, dy, step] of NEIGHBOURS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= columns || ny >= rows) continue;
        const next = ny * columns + nx;
        if (nodes[next] === undefined) continue;
        const total = at + step * weight(next);
        const known = cost[next] ?? -1;
        if (known !== -1 && known <= total) continue;
        cost[next] = total;
        cameFrom[next] = square;
        const bucket = buckets[total];
        if (bucket === undefined) buckets[total] = [next];
        else bucket.push(next);
      }
    }
  }
  return null;
}

/** Whether the rest of a raid's way, its waypoints from `leg` on and its target, lies in a believed tower's
 *  reach. */
export function routeUnderTower(
  towers: readonly TowerBelief[],
  waypoints: readonly HalfCellNode[],
  leg: number,
  target: HalfCellNode,
): boolean {
  return towerInReach(towers, target) || waypoints.slice(leg).some((at) => towerInReach(towers, at));
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
