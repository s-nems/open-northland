import type { DeepReadonly, Entity, World } from '../../ecs/world.js';
import { defineWorldSingleton } from '../../ecs/world-singleton.js';

/** A seat's building as the map brief saw it at the scan: its type and anchor node. */
export interface BriefBuilding {
  buildingType: number;
  hx: number;
  hy: number;
}

/** Where one player slot started: every seat may know every other's (owner ruling on what a computer
 *  seat knows). */
export interface BriefSeatStart {
  player: number;
  /** Its built headquarters' interaction node, else its most central storage's, else its settlers'
   *  centroid. */
  hx: number;
  hy: number;
  /** The static land component the anchor stands on, or `NO_COMPONENT`. */
  component: number;
  /** Ascending entity id at the scan. */
  buildings: BriefBuilding[];
}

/** One land component the brief keeps: one holding a seat start or at least a zone's worth of land. */
export interface BriefLandComponent {
  component: number;
  nodes: number;
  /** The water bodies bordering it, ascending label. */
  waters: number[];
}

/**
 * The computer player's one scan of the static map, shared by every computer seat. Every per-zone layer
 * is row-major over the zone grid, `zy * zonesWide + zx`, one entry per zone.
 */
export interface MapBriefState {
  /** Whether the scan ran: absent, every other field is empty. */
  scanned: boolean;
  /** The map and zone edge in half-cell nodes. */
  width: number;
  height: number;
  zoneNodes: number;
  zonesWide: number;
  zonesHigh: number;
  /** Walkable land nodes. */
  land: number[];
  water: number[];
  /** Buildable nodes nothing stood on. */
  free: number[];
  /** Buildable nodes only harvestable resources blocked. */
  clearable: number[];
  /** Buildable nodes landscape no player removes blocked, or a script closed to building. */
  blocked: number[];
  /** Free nodes crops may be sown on: the grass the farm, well, hive and herb hut want. */
  plantable: number[];
  /** Per zone, the land component holding most of its walkable land, the lowest label on a tie;
   *  `NO_COMPONENT` for a zone without land. */
  dominantLand: number[];
  /** The tracked goods' stable content ids, the column order of {@link deposits}. */
  goods: string[];
  /** Summed `Resource.remaining` per zone and good, `zone * goods.length + column`. */
  deposits: number[];
  /** Fish per zone, binned by each swarm's shore node (where a fisher stands), else its own node. */
  fish: number[];
  /** Ascending component label. */
  landComponents: BriefLandComponent[];
  /** Ascending player slot. */
  seats: BriefSeatStart[];
}

const mapBrief = defineWorldSingleton<MapBriefState>('MapBrief', 'players', () => ({
  scanned: false,
  width: 0,
  height: 0,
  zoneNodes: 0,
  zonesWide: 0,
  zonesHigh: 0,
  land: [],
  water: [],
  free: [],
  clearable: [],
  blocked: [],
  plantable: [],
  dominantLand: [],
  goods: [],
  deposits: [],
  fish: [],
  landComponents: [],
  seats: [],
}));

export const MapBrief = mapBrief.component;

export type MapBriefView = DeepReadonly<MapBriefState>;

/** The world's map brief, or null before the computer player's first scan. */
export function mapBriefOf(world: World): MapBriefView | null {
  const brief = mapBrief.read(world);
  return brief.scanned ? brief : null;
}

/** Store the scan's result, once per world, on an existing `carrier` rather than a fresh entity: a new
 *  entity would shift the id of every entity created after it, and with them the id-keyed beats. */
export function writeMapBrief(world: World, carrier: Entity, scanned: MapBriefState): void {
  world.add(carrier, MapBrief, scanned);
}
