import type { MapAiSeat } from '@open-northland/data';
import { defineComponent, type Entity, type World } from '../../ecs/world.js';

/**
 * The seats' `[AIData]` rows: the immutable program each scripted handler runs, handed to the
 * simulation like the mission script and never saved. A restore is handed the same rows.
 */
export type MapAiScript = readonly MapAiSeat[];

/** The tick a condition record carries for a change that never happened. */
export const MAP_AI_TICK_NEVER = -1;

/** One declared condition slot's live state; the definition stays in the script. */
export interface MapAiConditionRecord {
  active: boolean;
  /** Tick of the last inactive-to-active change, or {@link MAP_AI_TICK_NEVER}. */
  activatedTick: number;
  /** Tick of the last active-to-inactive change, or {@link MAP_AI_TICK_NEVER}. */
  deactivatedTick: number;
}

/** One task's live state, indexed like the script's task list. */
export interface MapAiTaskRecord {
  /** A one-shot task that has run, or a repeating one told to run once. */
  done: boolean;
  /** The task's priority while its condition holds, 0 while it does not. */
  priority: number;
}

/** A soldier the handler lists: which task it serves, or the default position. */
export interface MapAiSoldierRecord {
  entity: Entity;
  /** The script index of the Defend or Attack task it serves, or null. */
  task: number | null;
  onDefault: boolean;
}

/** An Attack group's state: whether its band is regrouping at the rally point, and how tightly. */
export interface MapAiAttackGroupRecord {
  /** The script index of the first task in the group, which names the group. */
  task: number;
  regrouping: boolean;
  /** The map-point range around the rally point the band gathers inside while regrouping. */
  range: number;
}

/** One building the seat stood with on its first turn: what the handler raises again once it is gone. */
export interface MapAiHouseRecord {
  buildingType: number;
  tribe: number;
  /** The anchor's half-cell node. */
  hx: number;
  hy: number;
}

/** One wall segment or gate the seat stood with on its first turn, raised again once it is gone. A gate
 *  is remembered by its shut row. */
export interface MapAiWallRecord {
  gfxIndex: number;
  tribe: number;
  /** The anchor's half-cell node. */
  hx: number;
  hy: number;
  /** The body nodes the map stood it over a deposit or a neighbouring segment, with their blocker and
   *  other walls' stamps on the first turn: what does not keep it from going up again. */
  ground: MapAiWallGround[];
}

export interface MapAiWallGround {
  x: number;
  y: number;
  obstacle: number;
  walls: number;
}

export interface MapAiDefaultPosition {
  hx: number;
  hy: number;
  range: number;
}

/**
 * One scripted handler's running program: the per-seat state of the conditions, tasks and soldiers
 * of the seat's `[AIData]` rows (the script itself is content). Created on the seat's first handler
 * turn, saved and hashed from there on.
 */
export interface MapAiStateData {
  player: number;
  /** Where the seat's soldiers stand when no task takes them: authored, else the seat's centre. */
  defaultPosition: MapAiDefaultPosition | null;
  /** The handler's own Defend task at the seat's centre, added on the first turn of a seat that
   *  authored no task at all; it counts as the task after the script's last. */
  defaultDefend: { hx: number; hy: number } | null;
  /** Indexed by slot; a slot the script never declared is null. */
  conditions: (MapAiConditionRecord | null)[];
  tasks: MapAiTaskRecord[];
  soldiers: MapAiSoldierRecord[];
  groups: MapAiAttackGroupRecord[];
  /** The rebuild list, at most {@link MAP_AI_REBUILD_LIST_LIMIT} buildings in entity order. */
  houses: MapAiHouseRecord[];
  /** The wall list, at most {@link MAP_AI_WALL_LIST_LIMIT} segments and gates, nearest the centre first. */
  walls: MapAiWallRecord[];
}

/** How many of its first-turn buildings a seat remembers for rebuilding. Original behavior. */
export const MAP_AI_REBUILD_LIST_LIMIT = 100;
/** How many of its first-turn walls a seat remembers for rebuilding. Original behavior. */
export const MAP_AI_WALL_LIST_LIMIT = 1000;

export const MapAiState = defineComponent<MapAiStateData>('MapAiState', 'players', { simOnly: true });

/** The program carrier for `player`, or null before its first turn. The lowest-id carrier wins should
 *  more than one ever exist. */
export function mapAiEntity(world: World, player: number): Entity | null {
  let best: Entity | null = null;
  for (const e of world.query(MapAiState)) {
    if (world.get(e, MapAiState).player !== player) continue;
    if (best === null || e < best) best = e;
  }
  return best;
}
