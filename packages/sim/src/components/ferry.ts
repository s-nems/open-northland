import { defineComponent } from '../ecs/component.js';
import type { Entity } from '../ecs/world.js';
import type { HalfCellNode } from '../nav/halfcell.js';
import type { NodeId } from '../nav/terrain/index.js';

/** The legs a booked crossing runs: the passengers walk to the door at the home shore, the ship sails
 *  for the far shore where the walk lines pick them up, and the empty ship sails back home. A dispatch
 *  crossing adds the pickup leg, the ship sailing from its own island to the waiting passengers'. */
export const FERRY_PHASES = ['board', 'pickup', 'sail', 'return'] as const;
export type FerryPhase = (typeof FERRY_PHASES)[number];

/**
 * One crossing a ship with a scout at the helm makes for its passengers, from the walk order that
 * could not cross the water: held on the ship from the first booking until it has carried its
 * passengers over and lies moored at its home shore again. The passengers walk to its door on the
 * home island, it docks at a shore of the target island, each walks on from there to the spot its
 * order named, and the ship sails back to the mooring the crossing booked it at. When the home island
 * keeps no ship, one from another island is dispatched: it sails to the passengers' shore first, the
 * passengers waiting where they stand until it moors there. A route that dies under the hull - a step
 * another ship blocked - ends no leg: the watcher docks the leg's shore again until the crossing runs
 * on. A player's own order
 * to the ship meanwhile lapses the booking, the riders staying ordinary ones.
 */
export interface FerryVoyageState {
  /** The settlers the crossing carries, booking order first; each also carries `FerryPassenger`. */
  passengers: Entity[];
  /** The shore point the ship sails to moor at; null while boarding or while a pickup has not sailed. */
  shore: HalfCellNode | null;
  /** The leg under way. */
  phase: FerryPhase;
  /** The tick the first booking was made. */
  since: number;
  /** The shore point the ship lay moored at when the crossing was booked; the return leg sails it back there. */
  home: HalfCellNode | null;
}

export const FerryVoyage = defineComponent<FerryVoyageState>('FerryVoyage', 'movement');

/**
 * A settler booked on a ferry crossing ({@link FerryVoyage}): `ship` is the vessel it walks to and
 * rides, `goal` the spot its move order named, which the walk line from the far shore carries it to.
 * `wait` is the coast node on their own island a dispatched booking holds the settler at while the
 * ship sails to it - a bare move goal of the crossing's own, so they stand at the water when it
 * arrives; null before such a spot is found or for a booking on a ship already lying at their
 * island. The booking ends when the settler steps ashore at `goal`, and with the voyage it was booked on.
 */
export const FerryPassenger = defineComponent<{ ship: Entity; goal: NodeId; wait: NodeId | null }>(
  'FerryPassenger',
  'movement',
);

/**
 * A settler whose island-crossing move order found no free ship at booking time: the order stands as
 * this hold instead of refusing lost. The ferry system retries the booking every few ticks, so the
 * settler takes the first ship that comes free - one coming back from a crossing, newly crewed or
 * newly built. While one of the owner's ships is away and comes back to moor on their island, `wait`
 * is that berth: a bare move goal of the hold's own walks them there, so they stand at the landing
 * place when the ship moors and take it the moment the search lets it. Null when no ship will come
 * back here, so they stand where they are instead. The hold ends when a booking is made
 * (`FerryPassenger` replaces it) or when the settler's own new order takes them somewhere else.
 */
export const FerryWaiting = defineComponent<{ goal: NodeId; since: number; wait: NodeId | null }>(
  'FerryWaiting',
  'movement',
);
