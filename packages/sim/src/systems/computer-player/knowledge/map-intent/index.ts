import type { ContentSet, MapAiSeat } from '@open-northland/data';
import type { MapBriefView } from '../../../../components/index.js';
import type { SystemContext } from '../../../context.js';
import type { MissionScript } from '../../../missions/script.js';
import { type ScriptObjective, scriptObjectivesOf } from './objectives.js';
import { type ProgramTask, programOf } from './program.js';
import {
  type ScriptedThreat,
  type SeatTerritory,
  type SeatThreat,
  scriptedThreats,
  threatsToward,
} from './threats.js';
import { MissionTiming } from './triggers.js';

export * from './objectives.js';
export * from './program.js';
export * from './threats.js';
export * from './triggers.js';

/** The immutable inputs the map intent reads: the content (who is a fighter) and the map's scripts. */
export type MapIntentInputs = Pick<SystemContext, 'content' | 'missions' | 'mapAiScript'>;

/** What a whole map's scripts mean, before any seat: a pure function of {@link MapIntentInputs}. */
interface MapIntent {
  readonly script: MissionScript | null;
  readonly timing: MissionTiming | null;
  readonly mapAi: readonly MapAiSeat[];
  readonly threats: readonly ScriptedThreat[];
  readonly objectives: Map<number, readonly ScriptObjective[]>;
  readonly programs: Map<number, readonly ProgramTask[]>;
}

/** The stand-in key for an absent script, so a world without one still memoizes. */
const NO_SCRIPT = {};
const intentMemo = new WeakMap<ContentSet, WeakMap<object, WeakMap<object, MapIntent>>>();

function mapIntentOf(inputs: MapIntentInputs): MapIntent {
  let byMissions = intentMemo.get(inputs.content);
  if (byMissions === undefined) {
    byMissions = new WeakMap();
    intentMemo.set(inputs.content, byMissions);
  }
  const missionsKey = inputs.missions ?? NO_SCRIPT;
  let byMapAi = byMissions.get(missionsKey);
  if (byMapAi === undefined) {
    byMapAi = new WeakMap();
    byMissions.set(missionsKey, byMapAi);
  }
  const mapAiKey = inputs.mapAiScript ?? NO_SCRIPT;
  const held = byMapAi.get(mapAiKey);
  if (held !== undefined) return held;
  const script = inputs.missions ?? null;
  const timing = script === null ? null : new MissionTiming(script);
  const mapAi = inputs.mapAiScript ?? [];
  const intent: MapIntent = {
    script,
    timing,
    mapAi,
    threats: scriptedThreats(inputs.content, script, timing, mapAi),
    objectives: new Map(),
    programs: new Map(),
  };
  byMapAi.set(mapAiKey, intent);
  return intent;
}

/** What the map's scripts mean for one seat. */
export interface SeatMapIntent {
  readonly seat: number;
  readonly objectives: readonly ScriptObjective[];
  /** Empty without a territory to judge proximity by. */
  readonly threats: readonly SeatThreat[];
  /** The seat's own map-AI tasks, for a seat that runs one beside the computer player. */
  readonly program: readonly ProgramTask[];
}

/**
 * The scripted objectives, the attacks that reach `territory` and the seat's own program. A computer seat
 * knows the complete scripts (owner ruling), so nothing here is gated by sight.
 */
export function seatMapIntentOf(
  inputs: MapIntentInputs,
  seat: number,
  territory: SeatTerritory | null,
): SeatMapIntent {
  const intent = mapIntentOf(inputs);
  let objectives = intent.objectives.get(seat);
  if (objectives === undefined) {
    objectives =
      intent.script === null || intent.timing === null
        ? []
        : scriptObjectivesOf(intent.script, intent.timing, seat);
    intent.objectives.set(seat, objectives);
  }
  let program = intent.programs.get(seat);
  if (program === undefined) {
    program = programOf(intent.mapAi, seat, intent.timing);
    intent.programs.set(seat, program);
  }
  return {
    seat,
    objectives,
    threats: territory === null ? [] : threatsToward(intent.threats, seat, territory),
    program,
  };
}

/** The seat's start as the map brief recorded it, or null before the scan or for a seat it has none of. */
export function seatTerritoryOf(brief: MapBriefView | null, seat: number): SeatTerritory | null {
  const start = brief?.seats.find((s) => s.player === seat);
  if (start === undefined) return null;
  return {
    anchor: { hx: start.hx, hy: start.hy },
    buildings: start.buildings.map((b) => ({ hx: b.hx, hy: b.hy })),
  };
}
