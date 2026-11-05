import {
  aiControlEntity,
  Building,
  type ColonyOverflow,
  type ColonyState,
  ComputerColony,
  Position,
  Rider,
  Settler,
} from '../../components/index.js';
import type { DeepReadonly, Entity, World } from '../../ecs/world.js';
import type { TerrainGraph } from '../../nav/terrain/index.js';
import type { MapContext, SystemContext } from '../context.js';
import { isFighterJob } from '../readviews/index.js';
import { interactionCell } from '../settlers/targets/index.js';
import { moverNode } from '../spatial/mover-node.js';
import { ownedBuildings, ownedSettlers } from './seat-roster.js';

type ColonyView = DeepReadonly<ColonyState>;

const NO_COLONIES: readonly ColonyView[] = [];
const NOBODY: readonly Entity[] = [];

/** `seat`'s colonies, oldest first, an abandoned one among them: its land stays out of the home reads. */
export function seatColonies(world: World, seat: number): readonly ColonyView[] {
  const carrier = aiControlEntity(world, seat);
  return (carrier === null ? undefined : world.tryGet(carrier, ComputerColony)?.colonies) ?? NO_COLONIES;
}

function heldShipsOf(colony: ColonyView): Entity[] {
  const ships: Entity[] = [];
  if (colony.scout !== null) ships.push(colony.scout.ship);
  if (colony.ship !== null) ships.push(colony.ship);
  for (const route of [colony.route, colony.relief])
    if (route !== null && route.ship !== null) ships.push(route.ship);
  if (colony.ferry !== null) ships.push(colony.ferry.ship);
  return ships;
}

/** The ships `seat`'s colonies hold. */
export function colonyHeldShips(world: World, seat: number): readonly Entity[] {
  return seatColonies(world, seat).flatMap(heldShipsOf);
}

function liveColonies(world: World, seat: number): readonly ColonyView[] {
  return seatColonies(world, seat).filter((colony) => colony.phase !== 'abandoned');
}

/** The lands `seat`'s live colony plans stand on. */
export function liveColonyLands(world: World, seat: number): readonly number[] {
  return liveColonies(world, seat).map((colony) => colony.land);
}

/** Every land `seat` holds a colony on, an abandoned one's too. */
export function colonyLands(world: World, seat: number): ReadonlySet<number> {
  return new Set(seatColonies(world, seat).map((colony) => colony.land));
}

/** The fighters `seat`'s colonies hold as their garrisons. */
export function colonyGarrisons(world: World, seat: number): readonly Entity[] {
  return seatColonies(world, seat).flatMap((colony) => colony.garrison);
}

/** Whether `seat` holds a live colony plan, whose ships its joinery owes. */
export function colonyWantsShips(world: World, seat: number): boolean {
  return seatColonies(world, seat).some((colony) => colony.phase !== 'abandoned');
}

/** The buildings `seat`'s order has handed to its colonies; none of one given up, so home's steps stand open
 *  again. */
export function colonyOverflow(world: World, seat: number): readonly DeepReadonly<ColonyOverflow>[] {
  return liveColonies(world, seat).flatMap((colony) => colony.overflow);
}

/** What a seat's colonies hold by land and by name. */
interface ColonyClaims {
  readonly lands: ReadonlySet<number>;
  /** The colony land of each listed person and each held ship. */
  readonly listed: ReadonlyMap<Entity, number>;
  readonly ships: ReadonlyMap<Entity, number>;
}

function claimsOf(colonies: readonly ColonyView[]): ColonyClaims {
  const lands = new Set<number>();
  const listed = new Map<Entity, number>();
  const ships = new Map<Entity, number>();
  for (const colony of colonies) {
    lands.add(colony.land);
    for (const e of colony.people) listed.set(e, colony.land);
    for (const e of colony.rest) listed.set(e, colony.land);
    for (const e of colony.garrison) listed.set(e, colony.land);
    for (const ship of heldShipsOf(colony)) ships.set(ship, colony.land);
  }
  return { lands, listed, ships };
}

function sameMap<K, V>(a: ReadonlyMap<K, V>, b: ReadonlyMap<K, V>): boolean {
  if (a.size !== b.size) return false;
  for (const [key, value] of a) if (b.get(key) !== value) return false;
  return true;
}

/** Whether two claims part a roster alike. */
function sameClaims(a: ColonyClaims, b: ColonyClaims): boolean {
  if (a.lands.size !== b.lands.size) return false;
  for (const land of a.lands) if (!b.lands.has(land)) return false;
  return sameMap(a.listed, b.listed) && sameMap(a.ships, b.ships);
}

/** The land of the colony `e` is held by, or undefined for one of home's: a building by the land of its door,
 *  a person when listed (a garrison's fighter too), riding a held ship, or standing on that land and no
 *  fighter. A walker stands on its step's node ({@link moverNode}), never on the water a shore step
 *  passes. */
function colonyLandOf(
  world: World,
  ctx: MapContext,
  terrain: TerrainGraph,
  claims: ColonyClaims,
  e: Entity,
): number | undefined {
  if (world.has(e, Building)) {
    const door = terrain.componentOf(interactionCell(world, ctx, terrain, e));
    return claims.lands.has(door) ? door : undefined;
  }
  const named = claims.listed.get(e);
  if (named !== undefined) return named;
  const ship = world.tryGet(e, Rider)?.vehicle;
  const sailing = ship === undefined ? undefined : claims.ships.get(ship);
  if (sailing !== undefined) return sailing;
  const p = world.tryGet(e, Position);
  if (p === undefined) return undefined;
  const { hx, hy } = moverNode(world, e, p);
  if (!terrain.inBounds(hx, hy)) return undefined;
  const stands = terrain.componentOf(terrain.nodeAt(hx, hy));
  // A landing on a shared island stays the army's, so a fighter never counts by where he stands.
  return claims.lands.has(stands) && !isFighterJob(ctx.content, world.tryGet(e, Settler)?.jobType ?? null)
    ? stands
    : undefined;
}

/** A roster parted into home and each colony land, ascending id. */
interface RosterParts {
  readonly home: readonly Entity[];
  readonly byLand: ReadonlyMap<number, readonly Entity[]>;
}

/** {@link RosterParts} with the key it stands on, the claims it parted by and the map it was read against. */
interface RosterSplit extends RosterParts {
  readonly roster: readonly Entity[];
  readonly riders: number;
  readonly trades: number;
  readonly colonyRevision: number;
  readonly claims: ColonyClaims;
  readonly map: MapContext;
}

function partsOf(
  world: World,
  map: MapContext,
  terrain: TerrainGraph,
  claims: ColonyClaims,
  owned: readonly Entity[],
): RosterParts {
  const home: Entity[] = [];
  const byLand = new Map<number, Entity[]>();
  for (const e of owned) {
    const land = colonyLandOf(world, map, terrain, claims, e);
    if (land === undefined) home.push(e);
    else if (byLand.has(land)) byLand.get(land)?.push(e);
    else byLand.set(land, [e]);
  }
  return { home, byLand };
}

function sameList(a: readonly Entity[] | undefined, b: readonly Entity[]): boolean {
  return a !== undefined && a.length === b.length && a.every((e, i) => e === b[i]);
}

function sameParts(a: RosterParts, b: RosterParts): boolean {
  return (
    sameList(a.home, b.home) &&
    a.byLand.size === b.byLand.size &&
    [...b.byLand].every(([land, people]) => sameList(a.byLand.get(land), people))
  );
}

/** A seat's reader of `roster` parted between home and its colonies, null with no colony. Derived from saved
 *  state in one pass over the roster and kept while the roster, the riders, the trades and the seat's colony
 *  claims stand: a person changes land only through {@link Rider}, a trade written in place on
 *  {@link Settler} turns one on colony land fighter or not, and a colony write that moves no land, list or
 *  held ship (a route's load, a ferry's leg) leaves the split as it was. Never hashed; the verifier named
 *  `name` re-derives each held split whose key still stands. */
function rosterSplitOf(
  roster: (world: World, player: number) => readonly Entity[],
  name: string,
): (world: World, ctx: SystemContext, seat: number) => RosterSplit | null {
  const views = new WeakMap<World, Map<number, RosterSplit>>();
  const colonyRevisionOf = (world: World, seat: number): number | undefined => {
    const carrier = aiControlEntity(world, seat);
    return carrier === null ? undefined : world.revisionOf(carrier, ComputerColony);
  };
  /** Whether `held` still answers for `owned` with the riders and trades as they are, colonies aside. */
  const rosterStands = (world: World, held: RosterSplit, owned: readonly Entity[]): boolean =>
    held.roster === owned &&
    held.riders === world.componentGeneration(Rider) &&
    held.trades === world.componentValueGeneration(Settler);
  const verify = (world: World): string[] => {
    const faults: string[] = [];
    for (const [seat, held] of views.get(world) ?? []) {
      // A stale key is not a fault: the next read derives the split again.
      const terrain = held.map.terrain;
      if (terrain === undefined || colonyRevisionOf(world, seat) !== held.colonyRevision) continue;
      if (!rosterStands(world, held, roster(world, seat))) continue;
      const claims = claimsOf(seatColonies(world, seat));
      if (!sameParts(held, partsOf(world, held.map, terrain, claims, held.roster)))
        faults.push(`${name} of seat ${seat} disagrees with a fresh derivation: its key missed a change`);
    }
    return faults;
  };
  return (world, ctx, seat) => {
    const colonyRevision = colonyRevisionOf(world, seat);
    const terrain = ctx.terrain;
    if (colonyRevision === undefined || terrain === undefined) return null;
    const colonies = seatColonies(world, seat);
    if (colonies.length === 0) return null;
    let bySeat = views.get(world);
    if (bySeat === undefined) {
      // Registered on the first read only: the verifier closes over `world` alone.
      world.registerCacheVerifier(name, () => verify(world));
      bySeat = new Map();
      views.set(world, bySeat);
    }
    const owned = roster(world, seat);
    const held = bySeat.get(seat);
    const kept = held !== undefined && rosterStands(world, held, owned);
    if (kept && held.colonyRevision === colonyRevision) return held;
    const claims = claimsOf(colonies);
    if (kept && sameClaims(held.claims, claims)) {
      const same: RosterSplit = { ...held, colonyRevision };
      bySeat.set(seat, same);
      return same;
    }
    const map: MapContext = { content: ctx.content, terrain };
    const split: RosterSplit = {
      roster: owned,
      riders: world.componentGeneration(Rider),
      trades: world.componentValueGeneration(Settler),
      colonyRevision,
      claims,
      map,
      ...partsOf(world, map, terrain, claims, owned),
    };
    bySeat.set(seat, split);
    return split;
  };
}

const buildingSplit = rosterSplitOf(ownedBuildings, 'homeBuildingSplit');
const settlerSplit = rosterSplitOf(ownedSettlers, 'homeSettlerSplit');

/** The seat's buildings at home, ascending id: what the computer player runs its settlement by. */
export function homeBuildings(world: World, ctx: SystemContext, seat: number): readonly Entity[] {
  return buildingSplit(world, ctx, seat)?.home ?? ownedBuildings(world, seat);
}

/** The seat's people at home, ascending id. */
export function homeSettlers(world: World, ctx: SystemContext, seat: number): readonly Entity[] {
  return settlerSplit(world, ctx, seat)?.home ?? ownedSettlers(world, seat);
}

/** The seat's buildings on the colony on `land`, ascending id; a shared list. */
export function colonyBuildingsOn(
  world: World,
  ctx: SystemContext,
  seat: number,
  land: number,
): readonly Entity[] {
  return buildingSplit(world, ctx, seat)?.byLand.get(land) ?? NOBODY;
}

/** The seat's people held by the colony on `land`, ascending id; a shared list. */
export function colonySettlersOn(
  world: World,
  ctx: SystemContext,
  seat: number,
  land: number,
): readonly Entity[] {
  return settlerSplit(world, ctx, seat)?.byLand.get(land) ?? NOBODY;
}

/** Every building of a seat, a colony's included: for a read of another seat or of all a seat holds. The
 *  computer player reaches for {@link homeBuildings} first; biome keeps the bare roster out of its folder. */
export const everyBuildingOf = ownedBuildings;

/** Every person of a seat, a colony's included ({@link everyBuildingOf}). */
export const everySettlerOf = ownedSettlers;
