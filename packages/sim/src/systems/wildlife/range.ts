import { ANIMAL_FLAG, hasAnimalFlag, Settler, StayPoint, WildHabitat } from '../../components/index.js';
import type { Rng } from '../../core/rng.js';
import type { Entity, World } from '../../ecs/world.js';
import type { BlockOverlay } from '../../nav/block-overlay.js';
import {
  cellXOfNode,
  cellYOfNode,
  HEX_DIRECTIONS,
  hexRingHx,
  hexRingHy,
  hexRingLength,
  stepHex,
} from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph, Traversal } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import type { GrazingFields } from '../movement/grazing-fields.js';
import { herdParams, ignoresHousesAnimal } from '../readviews/index.js';
import { hexNodeDistance } from '../spatial/metric.js';
import { type BuildingSectors, HABITAT_SECTOR_SIZE } from './building-sectors.js';

/** Original behavior: a leader's work center creeps over grass only while within 30 map points of it,
 *  and is pulled 30 map points out from the leader toward its birth point otherwise. */
const WORK_CENTER_REACH = 30;
/** Original behavior: a graze leg starts up to 5 map points out from the work center, in one random
 *  direction, and aims at the first free point at least 5 map points beyond that. */
const NEXT_POINT_STEPS = 5;
const NEXT_POINT_MIN_DISTANCE = 5;
/** Original behavior: the farthest a graze leg's free point is searched for. */
const NEXT_POINT_SEARCH_RANGE = 40;
/** Original behavior: a stay point adds 100 food per grass point within 10 map points to what is left,
 *  and the total is at least 5000. */
const FOOD_SEARCH_RANGE = 10;
const FOOD_PER_GRASS_POINT = 100;
const FOOD_FLOOR = 5000;
/** Original behavior: a restless animal picks among the 8 nearest free points. */
const GO_AWAY_CHOICES = 8;
/** How far a moved birth point looks for open ground. Approximation: the original's search radius is not
 *  pinned; one sector covers the sector origin it starts from. */
const BIRTH_GROUND_SEARCH_RANGE = HABITAT_SECTOR_SIZE;
/** Original behavior: a birth point moved onto the map's rim is pushed half a sector inward. */
const BORDER_INSET = HABITAT_SECTOR_SIZE / 2;
/** Original behavior: the stay range of an animal flagged {@link ANIMAL_FLAG.NARROW_STAY_RANGE}. */
const NARROW_STAY_RANGE = 5;
/** The map rim, in cells and in map-point rows, that the original reads as border. */
const BORDER_CELLS = 2;
const BORDER_TOP_ROWS = 4;

/** The eight sector neighbours in the original's turning order: E, SE, S, SW, W, NW, N, NE. */
const SECTOR_NEIGHBOURS: readonly (readonly [number, number])[] = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];

/** Grass a grazing animal eats from. Original behavior: a point whose ground triangle is land, the one
 *  triangle class with `biocanplanton`. Approximation: here a node counts when its whole cell is land and
 *  no landscape object's margin covers it, the plantable ground crops are sown on. */
export function isGrass(terrain: TerrainGraph, node: NodeId): boolean {
  return terrain.isWalkable(node) && terrain.isPlantable(node);
}

/** The food the grass within 10 map points of `at` holds, 100 per grass point. */
function grassFoodAt(terrain: TerrainGraph, at: NodeId): number {
  const x = terrain.xOf(at);
  const y = terrain.yOf(at);
  let grass = 0;
  for (let r = 0; r <= FOOD_SEARCH_RANGE; r++) {
    for (let i = 0; i < hexRingLength(r); i++) {
      const hx = hexRingHx(x, y, r, i);
      const hy = hexRingHy(y, r, i);
      if (terrain.inBounds(hx, hy) && isGrass(terrain, terrain.nodeAt(hx, hy))) grass++;
    }
  }
  return grass * FOOD_PER_GRASS_POINT;
}

/** `e`'s stay range: its species' `maximumdistancetostaypoint`, or 5 when its flags narrow it. */
export function stayRangeOf(world: World, e: Entity, speciesRange: number): number {
  return hasAnimalFlag(world, e, ANIMAL_FLAG.NARROW_STAY_RANGE) ? NARROW_STAY_RANGE : speciesRange;
}

/**
 * Original behavior: a wild leader whose birth point stands in a sector holding another player's buildings
 * moves it to the sector around itself, or a neighbour of that sector, with the fewest such buildings; the
 * new point is that sector's corner, pushed inward off the map's rim and onto open ground. A species with
 * `ignorehouses` never moves. Every player counts, since no player owns wildlife.
 */
export function moveBirthPoint(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  sectors: BuildingSectors,
  blocked: BlockOverlay,
  e: Entity,
  here: NodeId,
): void {
  if (ignoresHousesAnimal(ctx.content, world.get(e, Settler).tribe)) return;
  const birth = world.get(e, WildHabitat).birth;
  const sectorOf = (v: number): number => Math.floor(v / HABITAT_SECTOR_SIZE);
  if (sectors.countAt(sectorOf(terrain.xOf(birth)), sectorOf(terrain.yOf(birth))) === 0) return;
  let bestX = sectorOf(terrain.xOf(here));
  let bestY = sectorOf(terrain.yOf(here));
  let least = sectors.countAt(bestX, bestY);
  const fromX = bestX;
  const fromY = bestY;
  for (const [dx, dy] of SECTOR_NEIGHBOURS) {
    const sx = fromX + dx;
    const sy = fromY + dy;
    if (sx < 0 || sy < 0 || sx >= sectors.columns || sy >= sectors.rows) continue;
    const count = sectors.countAt(sx, sy);
    if (count < least) {
      least = count;
      bestX = sx;
      bestY = sy;
    }
  }
  let x = bestX * HABITAT_SECTOR_SIZE;
  let y = bestY * HABITAT_SECTOR_SIZE;
  if (isBorderPoint(terrain, x, y)) {
    x += BORDER_INSET;
    y += BORDER_INSET;
  }
  const ground = openGroundNear(terrain, blocked, terrain.nodeAtClamped(x, y), 'land');
  if (ground !== null && ground !== birth) world.mut(e, WildHabitat).birth = ground;
}

/**
 * Original behavior, a leader's work center: one flagged {@link ANIMAL_FLAG.FIXED_WORK_CENTER} never moves.
 * Otherwise, far past its range (`maximumdistancetobirthpoint` plus the stay range from the birth point)
 * it is reset onto the ring half the birth range around the birth point, nearest the leader. Otherwise,
 * within 30 map points of the leader, it steps to a random neighbouring grass point that keeps inside the
 * birth range, within 30 of the leader, and farther than `maximumleaderdistance` plus the stay range from
 * any player's building. With no such point, or farther than 30 from the leader, it is put on the ring 30
 * around the leader nearest the birth point.
 */
export function moveWorkCenterPoint(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  sectors: BuildingSectors,
  e: Entity,
  here: NodeId,
): void {
  if (hasAnimalFlag(world, e, ANIMAL_FLAG.FIXED_WORK_CENTER)) return;
  const herd = herdParams(ctx.content, world.get(e, Settler).tribe);
  if (herd === null) return;
  const habitat = world.get(e, WildHabitat);
  const birthRange = herd.birthPointRange;
  const stayRange = stayRangeOf(world, e, herd.stayPointRange);
  if (hexNodeDistance(terrain, here, habitat.birth) >= birthRange + stayRange) {
    setWorkCenter(world, e, nearestRingPoint(terrain, here, habitat.birth, Math.floor(birthRange / 2)));
    return;
  }
  if (hexNodeDistance(terrain, here, habitat.workCenter) < WORK_CENTER_REACH) {
    const steps: NodeId[] = [];
    const from = { hx: terrain.xOf(habitat.workCenter), hy: terrain.yOf(habitat.workCenter) };
    for (let i = 0; i < HEX_DIRECTIONS.length; i++) {
      const direction = HEX_DIRECTIONS[i];
      if (direction === undefined) continue;
      const p = stepHex(from, direction);
      if (!terrain.inBounds(p.hx, p.hy)) continue;
      const node = terrain.nodeAt(p.hx, p.hy);
      if (!terrain.isWalkable(node)) continue;
      if (sectors.anyWithin(p.hx, p.hy, herd.leaderDistance + stayRange)) continue;
      if (hexNodeDistance(terrain, node, habitat.birth) >= birthRange) continue;
      if (hexNodeDistance(terrain, node, here) >= WORK_CENTER_REACH) continue;
      if (isGrass(terrain, node)) steps.push(node);
    }
    const pick = steps.length === 0 ? undefined : steps[ctx.rng.int(steps.length)];
    if (pick !== undefined) {
      setWorkCenter(world, e, pick);
      return;
    }
  }
  setWorkCenter(world, e, nearestRingPoint(terrain, habitat.birth, here, WORK_CENTER_REACH));
}

function setWorkCenter(world: World, e: Entity, node: NodeId | null): void {
  if (node !== null && world.get(e, WildHabitat).workCenter !== node)
    world.mut(e, WildHabitat).workCenter = node;
}

/**
 * Original behavior: the point on the ring `radius` map points around `centre`, walkable, off the map's rim
 * and on `from`'s island, nearest `from`; past the first such point only grass may replace it.
 */
function nearestRingPoint(
  terrain: TerrainGraph,
  from: NodeId,
  centre: NodeId,
  radius: number,
): NodeId | null {
  const island = terrain.componentOf(from);
  let best: NodeId | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  const x = terrain.xOf(centre);
  const y = terrain.yOf(centre);
  for (let i = 0; i < hexRingLength(radius); i++) {
    const hx = hexRingHx(x, y, radius, i);
    const hy = hexRingHy(y, radius, i);
    if (!terrain.inBounds(hx, hy) || isBorderPoint(terrain, hx, hy)) continue;
    const node = terrain.nodeAt(hx, hy);
    if (!terrain.isWalkable(node) || terrain.componentOf(node) !== island) continue;
    if (best !== null && !isGrass(terrain, node)) continue;
    const distance = hexNodeDistance(terrain, node, from);
    if (distance < bestDistance) {
      best = node;
      bestDistance = distance;
    }
  }
  return best;
}

/** Original behavior: the map's rim, two cells in from either side or the bottom and four map-point rows
 *  from the top. */
function isBorderPoint(terrain: TerrainGraph, x: number, y: number): boolean {
  const cx = cellXOfNode(x, y);
  const cy = cellYOfNode(y);
  return (
    cx < BORDER_CELLS ||
    cx >= terrain.cellColumns - BORDER_CELLS ||
    y < BORDER_TOP_ROWS ||
    cy >= terrain.cellRows - BORDER_CELLS
  );
}

/** The nearest node to `start`, in ring order, a mover of `traversal` may stand on and no building blocks. */
function openGroundNear(
  terrain: TerrainGraph,
  blocked: BlockOverlay,
  start: NodeId,
  traversal: Traversal,
): NodeId | null {
  const x = terrain.xOf(start);
  const y = terrain.yOf(start);
  for (let r = 0; r <= BIRTH_GROUND_SEARCH_RANGE; r++) {
    for (let i = 0; i < hexRingLength(r); i++) {
      const hx = hexRingHx(x, y, r, i);
      const hy = hexRingHy(y, r, i);
      if (!terrain.inBounds(hx, hy)) continue;
      const node = terrain.nodeAt(hx, hy);
      if (terrain.traversable(node, traversal) && !blocked.has(node)) return node;
    }
  }
  return null;
}

/** What a walk target must be: standable ground on the walker's island, unblocked, and with no animal
 *  standing on it. */
export interface WalkGround {
  readonly terrain: TerrainGraph;
  readonly fields: GrazingFields;
  readonly blocked: BlockOverlay;
}

function freePoint(ground: WalkGround, node: NodeId, island: number, traversal: Traversal): boolean {
  const { terrain } = ground;
  if (!terrain.traversable(node, traversal) || terrain.componentOf(node) !== island) return false;
  return ground.fields.keeperAt(node) === undefined && !ground.blocked.has(node);
}

/**
 * Original behavior, a leader's next graze point: from its work center it steps up to 5 map points in one
 * random direction while the ground holds, then takes the first free point at least 5 map points beyond,
 * searching out to 40 in ring order. Null when none is free.
 */
export function nextGrazePoint(
  ground: WalkGround,
  rng: Rng,
  workCenter: NodeId,
  here: NodeId,
  traversal: Traversal,
): NodeId | null {
  const { terrain } = ground;
  const direction = HEX_DIRECTIONS[rng.int(HEX_DIRECTIONS.length)] ?? 'east';
  let origin = { hx: terrain.xOf(workCenter), hy: terrain.yOf(workCenter) };
  for (let i = 0; i < NEXT_POINT_STEPS; i++) {
    const p = stepHex(origin, direction);
    if (!terrain.inBounds(p.hx, p.hy) || !terrain.traversable(terrain.nodeAt(p.hx, p.hy), traversal)) break;
    origin = p;
  }
  const island = terrain.componentOf(here);
  for (let r = NEXT_POINT_MIN_DISTANCE; r <= NEXT_POINT_SEARCH_RANGE; r++) {
    for (let i = 0; i < hexRingLength(r); i++) {
      const hx = hexRingHx(origin.hx, origin.hy, r, i);
      const hy = hexRingHy(origin.hy, r, i);
      if (!terrain.inBounds(hx, hy)) continue;
      const node = terrain.nodeAt(hx, hy);
      if (freePoint(ground, node, island, traversal)) return node;
    }
  }
  return null;
}

/** Original behavior: a hungry animal off grass walks to the nearest free grass point within
 *  `maximumleaderdistance`. Null when none is. */
export function grassNear(
  ground: WalkGround,
  here: NodeId,
  range: number,
  traversal: Traversal,
): NodeId | null {
  const { terrain } = ground;
  const island = terrain.componentOf(here);
  const x = terrain.xOf(here);
  const y = terrain.yOf(here);
  for (let r = 1; r <= range; r++) {
    for (let i = 0; i < hexRingLength(r); i++) {
      const hx = hexRingHx(x, y, r, i);
      const hy = hexRingHy(y, r, i);
      if (!terrain.inBounds(hx, hy)) continue;
      const node = terrain.nodeAt(hx, hy);
      if (isGrass(terrain, node) && freePoint(ground, node, island, traversal)) return node;
    }
  }
  return null;
}

/**
 * Original behavior: a restless animal walks to one of the 8 nearest free points, at random. Here "free"
 * also keeps the stander spacing, so the pick never lands in another animal's field or its own.
 */
export function goAwayPoint(ground: WalkGround, rng: Rng, here: NodeId, traversal: Traversal): NodeId | null {
  const { terrain } = ground;
  const island = terrain.componentOf(here);
  const choices: NodeId[] = [];
  const x = terrain.xOf(here);
  const y = terrain.yOf(here);
  for (let r = 1; r <= NEXT_POINT_SEARCH_RANGE && choices.length < GO_AWAY_CHOICES; r++) {
    for (let i = 0; i < hexRingLength(r); i++) {
      const hx = hexRingHx(x, y, r, i);
      const hy = hexRingHy(y, r, i);
      if (!terrain.inBounds(hx, hy)) continue;
      const node = terrain.nodeAt(hx, hy);
      if (!freePoint(ground, node, island, traversal) || ground.fields.keeperNear(node) !== undefined)
        continue;
      choices.push(node);
      if (choices.length === GO_AWAY_CHOICES) break;
    }
  }
  return choices.length === 0 ? null : (choices[rng.int(choices.length)] ?? null);
}

/** A leader's stay point after it reaches a graze point: where it stands, its food topped up from the
 *  grass around it. */
export function settleStayPoint(world: World, terrain: TerrainGraph, e: Entity, here: NodeId): void {
  if (world.get(e, StayPoint).cell !== here) world.mut(e, StayPoint).cell = here;
  const habitat = world.mut(e, WildHabitat);
  habitat.food = Math.max(FOOD_FLOOR, habitat.food + grassFoodAt(terrain, here));
}
