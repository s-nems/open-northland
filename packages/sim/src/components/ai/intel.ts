import { defineComponent, type Entity } from '../../ecs/world.js';

/** The tick a memory entry holds when the seat has never seen it: a start building known from the map
 *  brief, a zone never in sight. */
export const NEVER_SEEN = -1;

/** Another seat's building as this seat last saw it, or as the map brief's start layout gave it. */
export interface IntelBuilding {
  entity: Entity;
  /** The owner when last seen; the seat's relation to it is read live, never stored. */
  owner: number;
  buildingType: number;
  hx: number;
  hy: number;
  /** {@link NEVER_SEEN} for a start building not yet seen. */
  seenAt: number;
  /** The fighters seen holding a post on it at the last sighting. */
  posted: number;
}

/** What one other seat's fighters have shown of themselves. */
export interface IntelForces {
  player: number;
  /** The most fighters seen at once, as of {@link peakAt}; reads decay it with age. */
  peak: number;
  peakAt: number;
  /** The last tick any of its fighters was seen, and the zone most of them stood in then. */
  lastSeenAt: number;
  lastZone: number;
}

/** One computer seat's memory of the others, fed only by its own sight. */
export interface ComputerIntelState {
  /** Ascending entity id. */
  buildings: IntelBuilding[];
  /** Ascending player. */
  forces: IntelForces[];
  /** Per map-brief zone, row-major, the last tick the seat saw into it, else {@link NEVER_SEEN}. */
  zoneSeenAt: number[];
}

/** Held on the seat's `AiControl` carrier, so it dies with the seat (`systems/computer-player/knowledge/intel`). */
export const ComputerIntel = defineComponent<ComputerIntelState>('ComputerIntel', 'players');
