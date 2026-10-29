import type { ContentSet, MapAiSeat } from '@open-northland/data';
import {
  type DiplomacyState,
  diplomacyStance,
  MapAiState,
  type MapBriefView,
  type MatchVictory,
  mapAiEntity,
  mapBriefOf,
  matchGoalTable,
  matchRulesView,
  missionRecords,
  missionStateExists,
  playerBit,
} from '../../../../components/index.js';
import type { World } from '../../../../ecs/world.js';
import type { SystemContext } from '../../../context.js';
import type { MissionScript } from '../../../missions/script.js';
import {
  type Objective,
  type ObjectiveRole,
  type ScriptObjective,
  scriptObjectivesOf,
} from './objectives.js';
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

/** Where a scripted event stands now: its mission or task not yet live, live and waiting, or done. */
export type IntentStatus = 'pending' | 'active' | 'fired';

export type ObjectiveSource = 'script' | 'matchGoal' | 'skirmish';

export interface ObjectiveSummary {
  readonly source: ObjectiveSource;
  readonly verdict: 'win' | 'lose';
  readonly role: ObjectiveRole;
  readonly mission: number | null;
  readonly objective: Objective;
  /** Null for a match row or before the script's state exists. */
  readonly status: IntentStatus | null;
}

export interface ThreatSummary extends SeatThreat {
  readonly status: IntentStatus | null;
  /** The seat's stance toward the attacker now; null for an unknown owner. */
  readonly stance: DiplomacyState | null;
}

export interface ProgramTaskSummary {
  readonly task: ProgramTask;
  readonly status: IntentStatus | null;
}

/** A plain-data digest of one seat's map intent with its live state, for a debug view. */
export interface SeatMapIntentSummary {
  readonly seat: number;
  readonly victory: MatchVictory;
  readonly territoryKnown: boolean;
  readonly objectives: readonly ObjectiveSummary[];
  readonly threats: readonly ThreatSummary[];
  readonly program: readonly ProgramTaskSummary[];
}

/** `seat`'s map intent overlaid with which missions and tasks are live and the match's own goals. */
export function seatMapIntentSummaryOf(
  world: World,
  inputs: MapIntentInputs,
  seat: number,
): SeatMapIntentSummary {
  const territory = seatTerritoryOf(mapBriefOf(world), seat);
  const intent = seatMapIntentOf(inputs, seat, territory);
  const missionStatus = missionStatusReader(world);
  const rules = matchRulesView(world);
  const objectives: ObjectiveSummary[] = intent.objectives.map((o) => ({
    source: 'script',
    ...o,
    status: missionStatus(o.mission),
  }));
  objectives.push(...matchObjectives(world, seat, rules.victory));
  return {
    seat,
    victory: rules.victory,
    territoryKnown: territory !== null,
    objectives,
    threats: intent.threats.map((t) => ({
      ...t,
      status: t.mission !== null ? missionStatus(t.mission) : taskStatus(world, t.player, t.task),
      stance: t.player === null ? null : diplomacyStance(world, seat, t.player),
    })),
    program: intent.program.map((task) => ({ task, status: taskStatus(world, seat, task.task) })),
  };
}

function missionStatusReader(world: World): (mission: number) => IntentStatus | null {
  if (!missionStateExists(world)) return () => null;
  const records = missionRecords(world);
  return (mission) => {
    const record = records[mission];
    if (record === undefined) return null;
    if ((record.fireCount ?? 0) > 0) return 'fired';
    return record.active ? 'active' : 'pending';
  };
}

/** A map-AI task's state on its seat's program carrier: done, switched on, or waiting. */
function taskStatus(world: World, player: number | null, task: number | null): IntentStatus | null {
  if (player === null || task === null) return null;
  const carrier = mapAiEntity(world, player);
  if (carrier === null) return null;
  const record = world.get(carrier, MapAiState).tasks[task];
  if (record === undefined) return null;
  if (record.done) return 'fired';
  return record.priority > 0 ? 'active' : 'pending';
}

/** The match's own goals for `seat`: its goal-table rows, or the skirmish rule. Script verdict rows are
 *  the script objectives already listed. */
function matchObjectives(world: World, seat: number, victory: MatchVictory): ObjectiveSummary[] {
  const row = (source: ObjectiveSource, objective: Objective): ObjectiveSummary => ({
    source,
    verdict: 'win',
    role: 'decides',
    mission: null,
    objective,
    status: null,
  });
  if (victory === 'elimination') return [row('skirmish', { kind: 'eliminateRivals' })];
  if (victory !== 'goals') return [];
  const table = matchGoalTable(world);
  if ((table.seats & playerBit(seat)) === 0) return [];
  const out: ObjectiveSummary[] = [];
  for (const goal of table.goals) {
    switch (goal.kind) {
      case 'goods':
        for (const { good, amount } of goal.goods) {
          out.push(row('matchGoal', { kind: 'deliverGoods', player: seat, good, amount, area: null }));
        }
        break;
      case 'inhabitants':
        out.push(
          row('matchGoal', {
            kind: 'growPopulation',
            player: seat,
            amount: goal.count,
            soldiers: goal.soldiers,
          }),
        );
        break;
      case 'lastStanding':
        out.push(row('matchGoal', { kind: 'eliminateRivals' }));
        break;
      case 'wonByMission':
      case 'lostByMission':
        break;
    }
  }
  return out;
}
