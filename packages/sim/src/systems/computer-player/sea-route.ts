import {
  Building,
  ComputerIntel,
  type DiplomacyState,
  diplomacyStance,
  type FogMode,
  MAX_PLAYERS,
  Vehicle,
  VehicleDrive,
  vehiclePassengers,
} from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import { type HalfCellNode, nodeManhattan } from '../../nav/halfcell.js';
import { NO_COMPONENT, type NodeId, type TerrainGraph } from '../../nav/terrain/index.js';
import { colonyWantsShips, everyBuildingOf, liveColonyLands } from '../ai-shared/home-roster.js';
import { anchorNodeOf } from '../ai-shared/node-geometry.js';
import type { SystemContext } from '../context.js';
import { HEADQUARTERS_BUILDING_ID } from '../readviews/index.js';
import { isShipVehicle } from '../readviews/vehicles.js';
import { interactionCell } from '../settlers/targets/index.js';
import { mooringSpotsOf } from '../vehicles/dock.js';
import { fogHides, playerSeesNode } from '../vision/gates.js';
import type { FogState } from '../vision/state.js';
import { seatBaseOf } from './base.js';
import { believedBuildings, rememberedBuildings } from './knowledge/intel/index.js';

/** Another seat's building a seat measures its front or its sea route by. `seen` when the seat sees its
 *  spot, so the entity may be read live; a remembered one may since have fallen out of sight. */
export interface OpposingBuilding {
  readonly entity: Entity;
  readonly node: HalfCellNode;
  readonly headquarters: boolean;
  readonly seen: boolean;
}

const headquartersByRoster = new WeakMap<readonly Entity[], readonly Entity[]>();

/**
 * The seat's headquarters in any construction state, ascending id. Kept per {@link everyBuildingOf} roster
 * copy, which is replaced whenever a building is added, removed or re-owned, so a seat's roster is walked
 * once per such change: a headquarters sits on no upgrade chain, so no type change in place makes or
 * unmakes one.
 */
function seatHeadquartersOf(world: World, ctx: SystemContext, player: number): readonly Entity[] {
  const roster = everyBuildingOf(world, player);
  const held = headquartersByRoster.get(roster);
  if (held !== undefined) return held;
  const found = roster.filter((e) => isHeadquartersType(ctx, world.get(e, Building).buildingType));
  headquartersByRoster.set(roster, found);
  return found;
}

function isHeadquartersType(ctx: SystemContext, buildingType: number): boolean {
  return contentIndex(ctx.content).buildings.get(buildingType)?.id === HEADQUARTERS_BUILDING_ID;
}

/** One seat's remembered headquarters out of sight, kept while its memory and its view stand: the build
 *  order, the workforce and the placement all ask for the sea route in one decision. Derived read-state,
 *  never hashed. */
interface RememberedHeadquarters {
  readonly fog: FogState;
  readonly mode: FogMode;
  readonly view: number;
  readonly intelMembership: number;
  readonly intelValues: number;
  readonly list: readonly OwnedHeadquarters[];
}

/** A headquarters with the seat that owns it, as the seat last saw it. */
export interface OwnedHeadquarters extends OpposingBuilding {
  readonly owner: number;
}

const rememberedHeadquartersBySeat = new WeakMap<World, Map<number, RememberedHeadquarters>>();

/** The headquarters `seat` remembers at spots it does not see, of every owner, ascending id. One walk of
 *  its memory per change of that memory or of its view. */
function rememberedHeadquartersOf(
  world: World,
  ctx: SystemContext,
  fog: FogState,
  seat: number,
): readonly OwnedHeadquarters[] {
  let bySeat = rememberedHeadquartersBySeat.get(world);
  if (bySeat === undefined) {
    bySeat = new Map();
    rememberedHeadquartersBySeat.set(world, bySeat);
  }
  const view = fog.viewGeneration(seat);
  const intelMembership = world.componentGeneration(ComputerIntel);
  const intelValues = world.componentValueGeneration(ComputerIntel);
  const held = bySeat.get(seat);
  if (
    held !== undefined &&
    held.fog === fog &&
    held.mode === fog.activeMode &&
    held.view === view &&
    held.intelMembership === intelMembership &&
    held.intelValues === intelValues
  )
    return held.list;
  const list: OwnedHeadquarters[] = [];
  for (const b of rememberedBuildings(world, seat)) {
    if (!isHeadquartersType(ctx, b.buildingType) || playerSeesNode(fog, seat, b.hx, b.hy)) continue;
    list.push({
      entity: b.entity,
      owner: b.owner,
      node: { hx: b.hx, hy: b.hy },
      headquarters: true,
      seen: false,
    });
  }
  bySeat.set(seat, { fog, mode: fog.activeMode, view, intelMembership, intelValues, list });
  return list;
}

/** Which stances a headquarters search counts: the front's enemies, or the sea route's rivals. */
type StanceFilter = (stance: DiplomacyState) => boolean;

const isEnemy: StanceFilter = (stance) => stance === 'enemy';

/** A seat not held as friend: a neutral may turn enemy, so a seat plans its ships for it too. */
const isRival: StanceFilter = (stance) => stance !== 'friend';

/**
 * The believed headquarters nearest `from` (Manhattan) of a player whose stance the seat's `counts`
 * admits, the lowest id on a tie, or null while it knows of none standing. With nothing hidden each
 * owner's lowest-id headquarters; else the ones the seat sees and those it remembers out of sight
 * ({@link believedBuildings}), a start headquarters known from the map brief.
 */
function nearestHeadquarters(
  world: World,
  ctx: SystemContext,
  player: number,
  from: HalfCellNode,
  counts: StanceFilter,
): OwnedHeadquarters | null {
  const fog = ctx.fog;
  const hidden = fogHides(fog);
  let best: OwnedHeadquarters | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  const consider = (candidate: OwnedHeadquarters): void => {
    const distance = nodeManhattan(candidate.node, from);
    if (
      distance < bestDistance ||
      (distance === bestDistance && best !== null && candidate.entity < best.entity)
    ) {
      best = candidate;
      bestDistance = distance;
    }
  };
  for (let owner = 0; owner < MAX_PLAYERS; owner++) {
    if (owner === player || !counts(diplomacyStance(world, player, owner))) continue;
    const live = seatHeadquartersOf(world, ctx, owner);
    const shown = hidden ? live.length : Math.min(live.length, 1);
    for (let i = 0; i < shown; i++) {
      const hq = live[i];
      const node = hq === undefined ? null : anchorNodeOf(world, hq);
      if (hq === undefined || node === null || (hidden && !playerSeesNode(fog, player, node.hx, node.hy)))
        continue;
      consider({ entity: hq, node, headquarters: true, seen: true, owner });
    }
  }
  if (hidden) {
    for (const hq of rememberedHeadquartersOf(world, ctx, fog, player)) {
      if (hq.owner !== player && counts(diplomacyStance(world, player, hq.owner))) consider(hq);
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
  const consider = (entity: Entity, node: HalfCellNode, seen: boolean): void => {
    const distance = nodeManhattan(node, from);
    // The seats' rosters are walked one after another, so the lowest id on a tie is kept explicitly.
    if (distance < bestDistance || (distance === bestDistance && best !== null && entity < best.entity)) {
      best = { entity, node, headquarters: false, seen };
      bestDistance = distance;
    }
  };
  for (let owner = 0; owner < MAX_PLAYERS; owner++) {
    if (owner === player || diplomacyStance(world, player, owner) !== 'enemy') continue;
    const { seen, remembered } = believedBuildings(world, ctx, player, owner);
    for (const e of seen) {
      const node = anchorNodeOf(world, e);
      if (node !== null) consider(e, node, true);
    }
    for (const b of remembered) consider(b.entity, { hx: b.hx, hy: b.hy }, false);
  }
  return best;
}

/** The two static land components ({@link TerrainGraph.componentOf}) a seat's sea route joins, each read
 *  at its headquarters' or base's interaction cell, a remembered headquarters' at its anchor, and the
 *  rival headquarters it sails for with the seat that owned it when last seen. */
export interface SeaRoute {
  readonly home: number;
  readonly rival: number;
  readonly headquarters: OwnedHeadquarters;
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
  const far = terrain.componentOf(
    rival.seen
      ? interactionCell(world, ctx, terrain, rival.entity)
      : terrain.nodeAtClamped(rival.node.hx, rival.node.hy),
  );
  if (home === NO_COMPONENT || far === NO_COMPONENT || home === far) return null;
  return { home, rival: far, headquarters: rival };
}

/** Whether the seat needs a ship to reach the headquarters it sails for ({@link seaRouteOf}). */
export function rivalOverSea(world: World, ctx: SystemContext, player: number): boolean {
  return seaRouteOf(world, ctx, player) !== null;
}

/** Whether the seat builds ships: for a rival over the sea, or for its colony. */
export function seatNeedsShips(world: World, ctx: SystemContext, player: number): boolean {
  return colonyWantsShips(world, player) || rivalOverSea(world, ctx, player);
}

/**
 * Whether `ship` is lost to `seat` though afloat: nobody aboard, nothing driving it, adrift or moored on a
 * land that is neither the seat's, a colony's nor the rival's it lands on, where nobody of the seat stands
 * to take the helm. The fleet counts it out, so the joinery builds its replacement.
 */
export function strandedShip(world: World, ctx: SystemContext, seat: number, ship: Entity): boolean {
  const state = world.get(ship, Vehicle);
  const type = contentIndex(ctx.content).vehicles.get(state.vehicleType);
  if (type === undefined || !isShipVehicle(type)) return false;
  if (vehiclePassengers(state).length > 0 || world.has(ship, VehicleDrive)) return false;
  const terrain = ctx.terrain;
  if (!state.moored || state.mooring === null || terrain === undefined) return !state.moored;
  const land = terrain.componentOf(terrain.nodeAtClamped(state.mooring.hx, state.mooring.hy));
  const base = seatBaseOf(world, ctx, seat);
  const home = base === null ? NO_COMPONENT : terrain.componentOf(interactionCell(world, ctx, terrain, base));
  const route = seaRouteOf(world, ctx, seat);
  return land !== home && !liveColonyLands(world, seat).includes(land) && land !== route?.rival;
}

/** How far apart, in half-cell nodes, ships' shore points lie, so the hulls moor side by side. */
export const LANDING_SHORE_SPACING_NODES = 10;

/**
 * Up to `count` shore points on `land`, each at least {@link LANDING_SHORE_SPACING_NODES} from the others:
 * the mooring spots `ship` can sail to ({@link mooringSpotsOf}) that `usable` admits, nearest `towards`
 * first, the lowest node on a tie.
 */
export function shorePoints(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  ship: Entity,
  land: number,
  towards: HalfCellNode,
  usable: (at: HalfCellNode) => boolean,
  count: number,
): HalfCellNode[] {
  const spots = mooringSpotsOf(world, ctx, terrain, ship);
  if (spots === null) return [];
  const candidates: { readonly at: HalfCellNode; readonly node: NodeId; readonly distance: number }[] = [];
  for (const node of spots.spots) {
    if (terrain.componentOf(node) !== land) continue;
    const { x, y } = terrain.coordsOf(node);
    const at = { hx: x, hy: y };
    if (!usable(at)) continue;
    candidates.push({ at, node, distance: nodeManhattan(at, towards) });
  }
  candidates.sort((a, b) => a.distance - b.distance || a.node - b.node);
  const picked: HalfCellNode[] = [];
  for (const c of candidates) {
    if (picked.length >= count) break;
    if (picked.every((p) => nodeManhattan(p, c.at) >= LANDING_SHORE_SPACING_NODES)) picked.push(c.at);
  }
  return picked;
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
