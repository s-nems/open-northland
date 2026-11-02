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
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { isFighterJob } from '../readviews/index.js';
import { interactionCell } from '../settlers/targets/index.js';
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
  if (colony.line !== null) ships.push(colony.line.ship);
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
    for (const ship of heldShipsOf(colony)) ships.set(ship, colony.land);
  }
  return { lands, listed, ships };
}

/** The land of the colony `e` is held by, or undefined for one of home's: a building by the land of its door,
 *  a person when listed, riding a held ship, or standing on that land and no fighter. */
function colonyLandOf(
  world: World,
  ctx: SystemContext,
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
  const { hx, hy } = nodeOfPosition(p.x, p.y);
  if (!terrain.inBounds(hx, hy)) return undefined;
  const stands = terrain.componentOf(terrain.nodeAt(hx, hy));
  // A landing on a shared island stays the army's, so a fighter never counts by where he stands.
  return claims.lands.has(stands) && !isFighterJob(ctx.content, world.tryGet(e, Settler)?.jobType ?? null)
    ? stands
    : undefined;
}

/** Whether `seat`'s building or settler `e` is one of its colonies' ({@link colonyLandOf}). */
export function colonyMember(world: World, ctx: SystemContext, seat: number, e: Entity): boolean {
  const terrain = ctx.terrain;
  if (terrain === undefined) return false;
  return colonyLandOf(world, ctx, terrain, claimsOf(seatColonies(world, seat)), e) !== undefined;
}

/** A roster parted into home and each colony land, ascending id. */
interface RosterSplit {
  readonly roster: readonly Entity[];
  readonly riders: number;
  readonly colonyRevision: number;
  readonly home: readonly Entity[];
  readonly byLand: ReadonlyMap<number, readonly Entity[]>;
}

/** A seat's reader of `roster` parted between home and its colonies, null with no colony. Derived from saved
 *  state in one pass over the roster and kept while the roster, the riders and the seat's colonies stand: a
 *  person changes land only through {@link Rider}, and another seat's colony write leaves this one's. Never
 *  hashed. */
function rosterSplitOf(
  roster: (world: World, player: number) => readonly Entity[],
): (world: World, ctx: SystemContext, seat: number) => RosterSplit | null {
  const views = new WeakMap<World, Map<number, RosterSplit>>();
  return (world, ctx, seat) => {
    const carrier = aiControlEntity(world, seat);
    const colonyRevision = carrier === null ? undefined : world.revisionOf(carrier, ComputerColony);
    const terrain = ctx.terrain;
    if (colonyRevision === undefined || terrain === undefined) return null;
    const owned = roster(world, seat);
    let bySeat = views.get(world);
    if (bySeat === undefined) {
      bySeat = new Map();
      views.set(world, bySeat);
    }
    const riders = world.componentGeneration(Rider);
    const held = bySeat.get(seat);
    if (
      held !== undefined &&
      held.roster === owned &&
      held.riders === riders &&
      held.colonyRevision === colonyRevision
    )
      return held;
    const claims = claimsOf(seatColonies(world, seat));
    const home: Entity[] = [];
    const byLand = new Map<number, Entity[]>();
    for (const e of owned) {
      const land = colonyLandOf(world, ctx, terrain, claims, e);
      if (land === undefined) home.push(e);
      else if (byLand.has(land)) byLand.get(land)?.push(e);
      else byLand.set(land, [e]);
    }
    const split: RosterSplit = { roster: owned, riders, colonyRevision, home, byLand };
    bySeat.set(seat, split);
    return split;
  };
}

const buildingSplit = rosterSplitOf(ownedBuildings);
const settlerSplit = rosterSplitOf(ownedSettlers);

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
