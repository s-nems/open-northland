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

/**
 * The building nearest `from` (Manhattan) of a player the seat holds as enemy, headquarters ranked ahead
 * of everything else, or null while no enemy has a building. The lowest id wins a tie. Read off the enemy
 * seats' building rosters, so the walk is over their buildings, not every seat's.
 */
export function nearestEnemyBuilding(
  world: World,
  ctx: SystemContext,
  player: number,
  from: HalfCellNode,
): EnemyBuilding | null {
  const index = contentIndex(ctx.content);
  let best: EnemyBuilding | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let owner = 0; owner < MAX_PLAYERS; owner++) {
    if (owner === player || diplomacyStance(world, player, owner) !== 'enemy') continue;
    for (const e of ownedBuildings(world, owner)) {
      const node = anchorNodeOf(world, e);
      if (node === null) continue;
      const hq = index.buildings.get(world.get(e, Building).buildingType)?.id === HEADQUARTERS_BUILDING_ID;
      if (best?.headquarters === true && !hq) continue;
      const distance = Math.abs(node.hx - from.hx) + Math.abs(node.hy - from.hy);
      // The seats' rosters are walked one after another, so the lowest id on a tie is kept explicitly.
      const closer =
        distance < bestDistance || (distance === bestDistance && best !== null && e < best.entity);
      if ((hq && best?.headquarters !== true) || closer) {
        best = { entity: e, node, headquarters: hq };
        bestDistance = distance;
      }
    }
  }
  return best;
}

/** The two static land components ({@link TerrainGraph.componentOf}) a seat's sea route joins. */
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
  const enemy = nearestEnemyBuilding(world, ctx, player, from);
  if (enemy === null || !enemy.headquarters) return null;
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
