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
  /** The fighters seen holding a post on it at the last sighting, and their points. */
  posted: number;
  postedPoints: number;
}

/** What one other seat's fighters have shown of themselves. */
export interface IntelForces {
  player: number;
  /** The most fighters seen at once, as of {@link peakAt}; reads decay it with age. */
  peak: number;
  peakAt: number;
  /** The most fighter points seen at once (`military/points.ts`), as of {@link peakPointsAt}; decays
   *  like {@link peak}. */
  peakPoints: number;
  peakPointsAt: number;
  /** The most fighter points ever seen at once, never aged, and the seat's own fighter points then. */
  mostPoints: number;
  ownPointsAtMost: number;
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
  /** The seat's scout at the last observation and the zone he stood in, or null with none. */
  scout: IntelScout | null;
  /** Per map-brief zone, row-major, the last tick the seat lost a scout there, else {@link NEVER_SEEN}. */
  scoutLostAt: number[];
  /** Per map-brief zone, row-major, the last tick the seat's scout turned back from a goal there, else
   *  {@link NEVER_SEEN}. */
  scoutTurnedBackAt: number[];
}

/** The scout as the seat last saw him: gone by the next observation, he died in {@link zone}. */
export interface IntelScout {
  entity: Entity;
  zone: number;
}

/** Held on the seat's `AiControl` carrier, so it dies with the seat (`systems/computer-player/knowledge/intel`). */
export const ComputerIntel = defineComponent<ComputerIntelState>('ComputerIntel', 'players');
