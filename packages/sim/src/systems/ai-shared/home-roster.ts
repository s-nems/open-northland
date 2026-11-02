import {
  aiControlEntity,
  Building,
  ComputerColony,
  type ComputerColonyState,
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

type ColonyView = DeepReadonly<ComputerColonyState>;

function colonyOf(world: World, seat: number): ColonyView | undefined {
  const carrier = aiControlEntity(world, seat);
  return carrier === null ? undefined : world.tryGet(carrier, ComputerColony);
}

function heldShipsOf(colony: ColonyView): Entity[] {
  const ships: Entity[] = [];
  if (colony.scout !== null) ships.push(colony.scout.ship);
  if (colony.ship !== null) ships.push(colony.ship);
  if (colony.line !== null) ships.push(colony.line.ship);
  return ships;
}

/** The ships `seat`'s colony holds. */
export function colonyHeldShips(world: World, seat: number): readonly Entity[] {
  const colony = colonyOf(world, seat);
  return colony === undefined ? [] : heldShipsOf(colony);
}

function belongsToColony(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  colony: ColonyView,
  e: Entity,
): boolean {
  if (world.has(e, Building))
    return terrain.componentOf(interactionCell(world, ctx, terrain, e)) === colony.land;
  if (colony.people.includes(e) || colony.rest.includes(e)) return true;
  const ship = world.tryGet(e, Rider)?.vehicle;
  if (ship !== undefined && heldShipsOf(colony).includes(ship)) return true;
  const p = world.tryGet(e, Position);
  if (p === undefined) return false;
  const { hx, hy } = nodeOfPosition(p.x, p.y);
  // A landing on a shared island stays the army's, so a fighter never counts by where he stands.
  return (
    terrain.inBounds(hx, hy) &&
    terrain.componentOf(terrain.nodeAt(hx, hy)) === colony.land &&
    !isFighterJob(ctx.content, world.tryGet(e, Settler)?.jobType ?? null)
  );
}

/** Whether `seat`'s building or settler `e` is its colony's: a building by the land of its door, a person
 *  when listed, riding a held ship, or standing on that land and no fighter. */
export function colonyMember(world: World, ctx: SystemContext, seat: number, e: Entity): boolean {
  const colony = colonyOf(world, seat);
  const terrain = ctx.terrain;
  return colony !== undefined && terrain !== undefined && belongsToColony(world, ctx, terrain, colony, e);
}

interface HomeView {
  readonly roster: readonly Entity[];
  readonly riders: number;
  readonly colonies: number;
  readonly colonyValues: number;
  readonly home: readonly Entity[];
}

/** A seat's home reader over `roster`. With no colony it hands back the roster itself. Otherwise derived
 *  from saved state and kept while the roster, the riders and the colonies stand: a person changes land
 *  only through {@link Rider}. Never hashed. */
function homeViewOf(
  roster: (world: World, player: number) => readonly Entity[],
): (world: World, ctx: SystemContext, seat: number) => readonly Entity[] {
  const views = new WeakMap<World, Map<number, HomeView>>();
  return (world, ctx, seat) => {
    const owned = roster(world, seat);
    const colony = colonyOf(world, seat);
    const terrain = ctx.terrain;
    if (colony === undefined || terrain === undefined) return owned;
    let bySeat = views.get(world);
    if (bySeat === undefined) {
      bySeat = new Map();
      views.set(world, bySeat);
    }
    const riders = world.componentGeneration(Rider);
    const colonies = world.componentGeneration(ComputerColony);
    const colonyValues = world.componentValueGeneration(ComputerColony);
    const held = bySeat.get(seat);
    if (
      held !== undefined &&
      held.roster === owned &&
      held.riders === riders &&
      held.colonies === colonies &&
      held.colonyValues === colonyValues
    )
      return held.home;
    const home = owned.filter((e) => !belongsToColony(world, ctx, terrain, colony, e));
    bySeat.set(seat, { roster: owned, riders, colonies, colonyValues, home });
    return home;
  };
}

/** The seat's buildings at home, ascending id: what the computer player runs its settlement by. */
export const homeBuildings = homeViewOf(ownedBuildings);

/** The seat's people at home, ascending id. */
export const homeSettlers = homeViewOf(ownedSettlers);

/** Every building of a seat, a colony's included: for a read of another seat or of all a seat holds. The
 *  computer player reaches for {@link homeBuildings} first; biome keeps the bare roster out of its folder. */
export const everyBuildingOf = ownedBuildings;

/** Every person of a seat, a colony's included ({@link everyBuildingOf}). */
export const everySettlerOf = ownedSettlers;
