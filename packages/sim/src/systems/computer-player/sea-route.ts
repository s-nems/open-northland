import { Building, type DiplomacyState, diplomacyStance, MAX_PLAYERS } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import { type HalfCellNode, nodeManhattan } from '../../nav/halfcell.js';
import { NO_COMPONENT, type TerrainGraph } from '../../nav/terrain/index.js';
import { anchorNodeOf } from '../ai-shared/node-geometry.js';
import { ownedBuildings } from '../ai-shared/seat-roster.js';
import type { SystemContext } from '../context.js';
import { HEADQUARTERS_BUILDING_ID } from '../readviews/index.js';
import { interactionCell } from '../settlers/targets/index.js';
import { fogHides } from '../vision/gates.js';
import { seatBaseOf } from './base.js';
import { believedBuildings } from './knowledge/intel/index.js';

/** Another seat's building a seat measures its front or its sea route by. */
export interface OpposingBuilding {
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
function seatHeadquartersOf(world: World, ctx: SystemContext, player: number): Entity | null {
  const roster = ownedBuildings(world, player);
  const held = headquartersByRoster.get(roster);
  if (held !== undefined) return held;
  const found = roster.find((e) => isHeadquarters(world, ctx, e)) ?? null;
  headquartersByRoster.set(roster, found);
  return found;
}

function isHeadquarters(world: World, ctx: SystemContext, e: Entity): boolean {
  const type = world.get(e, Building).buildingType;
  return contentIndex(ctx.content).buildings.get(type)?.id === HEADQUARTERS_BUILDING_ID;
}

/** The headquarters of `owner` that `seat` believes stand: with nothing hidden his lowest-id one, else
 *  each it sees or remembers ({@link believedBuildings}), a start headquarters known from the map brief. */
function believedHeadquartersOf(
  world: World,
  ctx: SystemContext,
  seat: number,
  owner: number,
): readonly Entity[] {
  if (!fogHides(ctx.fog)) {
    const hq = seatHeadquartersOf(world, ctx, owner);
    return hq === null ? [] : [hq];
  }
  return believedBuildings(world, ctx, seat, owner).filter((e) => isHeadquarters(world, ctx, e));
}

/** Which stances a headquarters search counts: the front's enemies, or the sea route's rivals. */
type StanceFilter = (stance: DiplomacyState) => boolean;

const isEnemy: StanceFilter = (stance) => stance === 'enemy';

/** A seat not held as friend: a neutral may turn enemy, so a seat plans its ships for it too. */
const isRival: StanceFilter = (stance) => stance !== 'friend';

/** The believed headquarters nearest `from` (Manhattan) of a player whose stance the seat's `counts`
 *  admits, the lowest id on a tie, or null while it knows of none standing. */
function nearestHeadquarters(
  world: World,
  ctx: SystemContext,
  player: number,
  from: HalfCellNode,
  counts: StanceFilter,
): OpposingBuilding | null {
  let best: OpposingBuilding | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let owner = 0; owner < MAX_PLAYERS; owner++) {
    if (owner === player || !counts(diplomacyStance(world, player, owner))) continue;
    for (const hq of believedHeadquartersOf(world, ctx, player, owner)) {
      const node = anchorNodeOf(world, hq);
      if (node === null) continue;
      const distance = nodeManhattan(node, from);
      if (distance < bestDistance || (distance === bestDistance && best !== null && hq < best.entity)) {
        best = { entity: hq, node, headquarters: true };
        bestDistance = distance;
      }
    }
  }
  return best;
}

/**
 * The believed building ({@link believedBuildings}) nearest `from` (Manhattan) of a player the seat holds
 * as enemy, headquarters ranked ahead of everything else, or null while it knows of no enemy building.
 * The lowest id wins a tie. The enemies' other buildings are walked only while none of them has a
 * headquarters.
 */
export function nearestEnemyBuilding(
  world: World,
  ctx: SystemContext,
  player: number,
  from: HalfCellNode,
): OpposingBuilding | null {
  const hq = nearestHeadquarters(world, ctx, player, from, isEnemy);
  if (hq !== null) return hq;
  let best: OpposingBuilding | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let owner = 0; owner < MAX_PLAYERS; owner++) {
    if (owner === player || diplomacyStance(world, player, owner) !== 'enemy') continue;
    for (const e of believedBuildings(world, ctx, player, owner)) {
      const node = anchorNodeOf(world, e);
      if (node === null) continue;
      const distance = nodeManhattan(node, from);
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
  readonly rival: number;
}

/**
 * The seat's route to the headquarters it sails for when only a ship makes it: its base's and that
 * headquarters' interaction cells lie on different land components, neither {@link NO_COMPONENT}. That is
 * the nearest enemy headquarters, or while no enemy has one, the nearest of any seat not held as friend,
 * so a neutral next door never hides an enemy over the sea. Null on a shared continent, while the seat knows
 * of no such headquarters, and for a seat with no base.
 */
export function seaRouteOf(world: World, ctx: SystemContext, player: number): SeaRoute | null {
  const terrain = ctx.terrain;
  if (terrain === undefined) return null;
  const base = seatBaseOf(world, ctx, player);
  const from = base === null ? null : anchorNodeOf(world, base);
  if (base === null || from === null) return null;
  const rival =
    nearestHeadquarters(world, ctx, player, from, isEnemy) ??
    nearestHeadquarters(world, ctx, player, from, isRival);
  if (rival === null) return null;
  const home = terrain.componentOf(interactionCell(world, ctx, terrain, base));
  const far = terrain.componentOf(interactionCell(world, ctx, terrain, rival.entity));
  if (home === NO_COMPONENT || far === NO_COMPONENT || home === far) return null;
  return { home, rival: far };
}

/** Whether the seat needs a ship to reach the headquarters it sails for ({@link seaRouteOf}). */
export function rivalOverSea(world: World, ctx: SystemContext, player: number): boolean {
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
