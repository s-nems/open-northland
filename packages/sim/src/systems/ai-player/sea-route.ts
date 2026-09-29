import { Building, diplomacyStance, MAX_PLAYERS } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { HalfCellNode } from '../../nav/halfcell.js';
import { NO_COMPONENT, type TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { HEADQUARTERS_BUILDING_ID } from '../readviews/index.js';
import { interactionCell } from '../settlers/targets/index.js';
import { seatBaseOf } from './base.js';
import { anchorNodeOf } from './node-geometry.js';
import { ownedBuildings } from './seat-roster.js';

/** The enemy building a seat measures its front and its sea route by. */
export interface EnemyBuilding {
  readonly entity: Entity;
  readonly node: HalfCellNode;
  readonly headquarters: boolean;
}

const headquartersByRoster = new WeakMap<readonly Entity[], Entity | null>();

/**
 * The seat's lowest-id headquarters in any construction state, or null. Kept per {@link ownedBuildings}
 * roster copy, which is replaced whenever a building is added, removed or re-owned, so a seat's roster
 * is walked once per such change: a headquarters sits on no upgrade chain, so no type change in place
 * makes or unmakes one.
 */
export function seatHeadquartersOf(world: World, ctx: SystemContext, player: number): Entity | null {
  const roster = ownedBuildings(world, player);
  const held = headquartersByRoster.get(roster);
  if (held !== undefined) return held;
  const buildings = contentIndex(ctx.content).buildings;
  const found =
    roster.find((e) => buildings.get(world.get(e, Building).buildingType)?.id === HEADQUARTERS_BUILDING_ID) ??
    null;
  headquartersByRoster.set(roster, found);
  return found;
}

/** Manhattan distance between two lattice nodes. */
function manhattan(a: HalfCellNode, b: HalfCellNode): number {
  return Math.abs(a.hx - b.hx) + Math.abs(a.hy - b.hy);
}

/** The headquarters nearest `from` (Manhattan) of a player the seat holds as enemy, the lowest id on a
 *  tie, or null while none stands: one lookup per enemy seat. */
function nearestEnemyHeadquarters(
  world: World,
  ctx: SystemContext,
  player: number,
  from: HalfCellNode,
): EnemyBuilding | null {
  let best: EnemyBuilding | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let owner = 0; owner < MAX_PLAYERS; owner++) {
    if (owner === player || diplomacyStance(world, player, owner) !== 'enemy') continue;
    const hq = seatHeadquartersOf(world, ctx, owner);
    const node = hq === null ? null : anchorNodeOf(world, hq);
    if (hq === null || node === null) continue;
    const distance = manhattan(node, from);
    if (distance < bestDistance || (distance === bestDistance && best !== null && hq < best.entity)) {
      best = { entity: hq, node, headquarters: true };
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * The building nearest `from` (Manhattan) of a player the seat holds as enemy, headquarters ranked ahead
 * of everything else, or null while no enemy has a building. The lowest id wins a tie. The enemies'
 * other buildings are walked only while none of them has a headquarters.
 */
export function nearestEnemyBuilding(
  world: World,
  ctx: SystemContext,
  player: number,
  from: HalfCellNode,
): EnemyBuilding | null {
  const hq = nearestEnemyHeadquarters(world, ctx, player, from);
  if (hq !== null) return hq;
  let best: EnemyBuilding | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let owner = 0; owner < MAX_PLAYERS; owner++) {
    if (owner === player || diplomacyStance(world, player, owner) !== 'enemy') continue;
    for (const e of ownedBuildings(world, owner)) {
      const node = anchorNodeOf(world, e);
      if (node === null) continue;
      const distance = manhattan(node, from);
      // The seats' rosters are walked one after another, so the lowest id on a tie is kept explicitly.
      if (distance < bestDistance || (distance === bestDistance && best !== null && e < best.entity)) {
        best = { entity: e, node, headquarters: false };
        bestDistance = distance;
      }
    }
  }
  return best;
}

/** The two static land components ({@link TerrainGraph.componentOf}) a seat's sea route joins, each read
 *  at its headquarters' or base's interaction cell. */
export interface SeaRoute {
  readonly home: number;
  readonly enemy: number;
}

/**
 * The seat's route to the nearest enemy headquarters when only a ship makes it: its base's and that
 * headquarters' interaction cells lie on different land components, neither {@link NO_COMPONENT}. Null on
 * a shared continent, while no enemy headquarters stands, and for a seat with no base.
 */
export function seaRouteOf(world: World, ctx: SystemContext, player: number): SeaRoute | null {
  const terrain = ctx.terrain;
  if (terrain === undefined) return null;
  const base = seatBaseOf(world, ctx, player);
  const from = base === null ? null : anchorNodeOf(world, base);
  if (base === null || from === null) return null;
  const enemy = nearestEnemyHeadquarters(world, ctx, player, from);
  if (enemy === null) return null;
  const home = terrain.componentOf(interactionCell(world, ctx, terrain, base));
  const far = terrain.componentOf(interactionCell(world, ctx, terrain, enemy.entity));
  if (home === NO_COMPONENT || far === NO_COMPONENT || home === far) return null;
  return { home, enemy: far };
}

/** Whether the seat needs a ship to reach the nearest enemy headquarters ({@link seaRouteOf}). */
export function enemyOverSea(world: World, ctx: SystemContext, player: number): boolean {
  return seaRouteOf(world, ctx, player) !== null;
}

const coastsByTerrain = new WeakMap<TerrainGraph, ReadonlyMap<number, ReadonlySet<number>>>();

/** Per land component, the water bodies bordering it on the lattice's four axis neighbours. A pure
 *  function of the static labels, built by one pass over the map on first use and kept per terrain. */
export function coastsOf(terrain: TerrainGraph): ReadonlyMap<number, ReadonlySet<number>> {
  const held = coastsByTerrain.get(terrain);
  if (held !== undefined) return held;
  const coasts = new Map<number, Set<number>>();
  const touch = (water: number, x: number, y: number): void => {
    if (!terrain.inBounds(x, y)) return;
    const node = terrain.nodeAt(x, y);
    if (terrain.isWater(node)) return;
    const land = terrain.componentOf(node);
    if (land === NO_COMPONENT) return;
    let waters = coasts.get(land);
    if (waters === undefined) {
      waters = new Set();
      coasts.set(land, waters);
    }
    waters.add(water);
  };
  for (let y = 0; y < terrain.height; y++) {
    for (let x = 0; x < terrain.width; x++) {
      const node = terrain.nodeAt(x, y);
      if (!terrain.isWater(node)) continue;
      const water = terrain.componentOf(node);
      if (water === NO_COMPONENT) continue;
      touch(water, x - 1, y);
      touch(water, x + 1, y);
      touch(water, x, y - 1);
      touch(water, x, y + 1);
    }
  }
  coastsByTerrain.set(terrain, coasts);
  return coasts;
}
