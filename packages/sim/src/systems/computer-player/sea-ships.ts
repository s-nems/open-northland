import { Position, Vehicle, VehicleDrive, vehiclePassengers } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import { TICKS_PER_SECOND } from '../../core/loop.js';
import type { DeepReadonly, Entity, World } from '../../ecs/world.js';
import { type HalfCellNode, nodeManhattan } from '../../nav/halfcell.js';
import { NO_COMPONENT, type NodeId, type TerrainGraph } from '../../nav/terrain/index.js';
import { colonyHeldShips } from '../ai-shared/home-roster.js';
import { anchorNodeOf } from '../ai-shared/node-geometry.js';
import type { SystemContext } from '../context.js';
import { isShipVehicle } from '../readviews/vehicles.js';
import { mooringSpotsOf } from '../vehicles/dock.js';
import { vehicleIndex } from '../vehicles/registry.js';
import { LANDING_SHORE_SPACING_NODES, landOfPoint } from './sea-route.js';

// A seat's own ships as its landings and its colonies use them: which lie free at home, and where one
// refused at its berth docks instead.

const SECONDS_PER_MINUTE = 60;

/** The most a seat's ship sails out on a landing or a colony's errand before it turns back, and sails home
 *  before it lets the crew go (authored). */
export const SHIP_SAIL_TIMEOUT_TICKS = 12 * SECONDS_PER_MINUTE * TICKS_PER_SECOND;

/** What a read of a seat's ships takes, a landing's or a colony's. */
export interface ShipEnv {
  readonly world: World;
  readonly ctx: SystemContext;
  readonly terrain: TerrainGraph;
  readonly seat: number;
}

/** The seat's ships a landing may take, ascending id: on the map, moored at a shore of `home`, crewless,
 *  not under way, riding no carrier and held by no colony. */
export function freeShips(env: ShipEnv, home: number): Entity[] {
  const { world, ctx, terrain, seat } = env;
  const vehicles = contentIndex(ctx.content).vehicles;
  const held = colonyHeldShips(world, seat);
  const ships: Entity[] = [];
  for (const e of vehicleIndex(world).ownedBy(seat)) {
    if (held.includes(e)) continue;
    const state = world.get(e, Vehicle);
    const type = vehicles.get(state.vehicleType);
    if (type === undefined || !isShipVehicle(type) || type.passengerVector === undefined) continue;
    if (!world.has(e, Position) || world.has(e, VehicleDrive) || state.carrier !== null) continue;
    if (!state.moored || state.mooring === null || vehiclePassengers(state).length > 0) continue;
    if (landOfPoint(terrain, state.mooring) === home) ships.push(e);
  }
  return ships.sort((a, b) => a - b);
}

const ANY_SHORE = (): boolean => true;

/**
 * Another shore point on the land of `refused` for a ship lying still short of it, the way hulls moored
 * there since or lying across its berth refuse its dock order: the mooring spot nearest the ship, the
 * lowest node on a tie, at least {@link LANDING_SHORE_SPACING_NODES} from `refused`, from each of `tried`
 * and from every other ship of the seat's mooring, and one `usable` admits. Null when that land has none.
 * Costs the ship's mooring spots.
 */
export function otherShore(
  env: ShipEnv,
  ship: Entity,
  refused: HalfCellNode,
  tried: readonly DeepReadonly<HalfCellNode>[] = [],
  usable: (at: HalfCellNode) => boolean = ANY_SHORE,
): HalfCellNode | null {
  const { world, ctx, terrain, seat } = env;
  const at = anchorNodeOf(world, ship);
  const spots = mooringSpotsOf(world, ctx, terrain, ship);
  const land = landOfPoint(terrain, refused);
  if (at === null || spots === null || land === NO_COMPONENT) return null;
  const taken: DeepReadonly<HalfCellNode>[] = [refused, ...tried];
  for (const e of vehicleIndex(world).ownedBy(seat)) {
    const mooring = e === ship ? null : world.get(e, Vehicle).mooring;
    if (mooring !== null) taken.push(mooring);
  }
  let best: { readonly at: HalfCellNode; readonly node: NodeId; readonly distance: number } | null = null;
  for (const node of spots.spots) {
    if (terrain.componentOf(node) !== land) continue;
    const { x, y } = terrain.coordsOf(node);
    const spot = { hx: x, hy: y };
    if (taken.some((t) => nodeManhattan(t, spot) < LANDING_SHORE_SPACING_NODES) || !usable(spot)) continue;
    const distance = nodeManhattan(spot, at);
    if (best === null || distance < best.distance || (distance === best.distance && node < best.node))
      best = { at: spot, node, distance };
  }
  return best?.at ?? null;
}
