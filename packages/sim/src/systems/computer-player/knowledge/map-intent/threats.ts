import type { ContentSet, MapAiSeat } from '@open-northland/data';
import { hexDistance } from '../../../../nav/halfcell.js';
import type { MissionResultOp, MissionScript } from '../../../missions/script.js';
import { isFighterJob } from '../../../readviews/index.js';
import { type IntentPoint, type MissionTiming, slotTrigger, type Trigger } from './triggers.js';

/**
 * Where a scripted attack comes from: a map-AI Attack task, fighters a mission spawns, a mission's
 * `SendHuman` walk, or its `MoveUnitsInArea` teleport. Fighters a map-AI program creates hold its
 * default position until a task takes them, so they count only as an attack's waves.
 */
export type ThreatSource = 'mapAiAttack' | 'missionSpawn' | 'missionSend' | 'missionMove';

export interface ThreatUnits {
  readonly job: number;
  readonly count: number;
}

/** Fighters a map-AI program creates while one of its attacks may run: they join its soldier pool. */
export interface ThreatWave extends ThreatUnits {
  readonly task: number;
  readonly point: IntentPoint;
  readonly trigger: Trigger;
}

/** One scripted attack anywhere on the map, before it is judged against a seat. */
export interface ScriptedThreat {
  readonly source: ThreatSource;
  /** Whose units; null for units the map placed under a mission id no result spawns. */
  readonly player: number | null;
  readonly target: IntentPoint;
  /** An attack's authored range around its target; 0 for a walk, a spawn or a teleport to a point. */
  readonly range: number;
  /** The fighters a mission spawns or sends; empty for an attack, whose band is drawn from its seat. */
  readonly units: readonly ThreatUnits[];
  /** An attack's soldier bounds (`max` 0 for no cap). */
  readonly soldiers: { readonly min: number; readonly max: number } | null;
  readonly rally: IntentPoint | null;
  /** Where its fighters set out from, as far as the scripts say: a spawn's point, the spawn points of the
   *  men a walk sends, an attack's rally; empty for map-placed men and a teleport. */
  readonly from: readonly IntentPoint[];
  readonly trigger: Trigger;
  /** The mission index for a mission source. */
  readonly mission: number | null;
  /** The task index in `player`'s map-AI program for a map-AI source. */
  readonly task: number | null;
  readonly waves: readonly ThreatWave[];
}

/** A scripted attack judged to reach the seat. */
export interface SeatThreat extends ScriptedThreat {
  /** Map-point distance from the target to the seat's start anchor. */
  readonly distance: number;
}

/** What a seat stands on: its start anchor and start buildings (the map brief's seat start). */
export interface SeatTerritory {
  readonly anchor: IntentPoint;
  readonly buildings: readonly IntentPoint[];
}

/**
 * How far past a threat's own range its target may lie from the seat's start anchor or a start building
 * and still hit the seat. Authored: about one settlement's spread around its start buildings. On
 * diamentowa_dolina, magiczny_las, mroczny_las, krwawa_rzeka and specjalna_forteca every scripted target
 * aimed at a seat lies within 29 map points of its start anchor.
 */
export const TERRITORY_MARGIN_NODES = 40;

/** Every scripted attack the map's program and script can launch, in source order. */
export function scriptedThreats(
  content: ContentSet,
  script: MissionScript | null,
  timing: MissionTiming | null,
  mapAi: readonly MapAiSeat[],
): ScriptedThreat[] {
  const out: ScriptedThreat[] = [];
  for (const seat of mapAi) {
    // `AI_Disable` stops the map AI, tasks and all.
    if (seat.allDisabled) continue;
    out.push(...mapAiThreats(content, seat, timing));
  }
  if (script !== null && timing !== null) out.push(...missionThreats(content, script, timing));
  return out;
}

function mapAiThreats(content: ContentSet, seat: MapAiSeat, timing: MissionTiming | null): ScriptedThreat[] {
  const waves: ThreatWave[] = [];
  seat.tasks.forEach((task, index) => {
    if (task.kind !== 'createCreatures' || !isFighterJob(content, task.job)) return;
    waves.push({
      task: index,
      job: task.job,
      count: task.count,
      point: { hx: task.x, hy: task.y },
      trigger: slotTrigger(seat, task.condition, timing),
    });
  });
  const out: ScriptedThreat[] = [];
  seat.tasks.forEach((task, index) => {
    if (task.kind !== 'attack') return;
    out.push({
      source: 'mapAiAttack',
      player: seat.player,
      target: { hx: task.x, hy: task.y },
      range: task.range,
      units: [],
      soldiers: { min: task.min, max: task.max },
      rally: { hx: task.rallyX, hy: task.rallyY },
      from: [{ hx: task.rallyX, hy: task.rallyY }],
      trigger: slotTrigger(seat, task.condition, timing),
      mission: null,
      task: index,
      waves,
    });
  });
  return out;
}

type SpawnOp = Extract<MissionResultOp, { opcode: 'SetHuman' | 'SetHumanX' }>;

interface SpawnGroup {
  readonly player: number;
  readonly point: IntentPoint;
  readonly humanId: number;
  readonly units: Map<number, number>;
}

function missionThreats(content: ContentSet, script: MissionScript, timing: MissionTiming): ScriptedThreat[] {
  const spawnsById = new Map<number, SpawnGroup[]>();
  const perMission = script.missions.map((mission) => spawnGroups(content, mission.results));
  for (const groups of perMission) {
    for (const group of groups) {
      if (group.humanId === 0) continue;
      const held = spawnsById.get(group.humanId) ?? [];
      held.push(group);
      spawnsById.set(group.humanId, held);
    }
  }
  const out: ScriptedThreat[] = [];
  const seen = new Set<string>();
  const push = (threat: ScriptedThreat) => {
    // A mission repeats a send line for the same men; one threat each.
    const key = `${threat.source}|${threat.mission}|${threat.player}|${threat.target.hx},${threat.target.hy}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(threat);
  };
  script.missions.forEach((mission, index) => {
    const groups = perMission[index] ?? [];
    const fire = () => timing.fireOf(index);
    for (const group of groups) {
      push(
        missionThreat(
          'missionSpawn',
          group.player,
          group.point,
          unitsOf([group]),
          [group.point],
          fire(),
          index,
        ),
      );
    }
    for (const result of mission.results) {
      if (result.opcode === 'SendHuman') {
        const own = groups.filter((g) => g.humanId === result.humanId);
        const sent = own.length > 0 ? own : (spawnsById.get(result.humanId) ?? []);
        const owners = [...new Set(sent.map((g) => g.player))].sort((a, b) => a - b);
        if (owners.length === 0)
          push(missionThreat('missionSend', null, result.point, [], [], fire(), index));
        for (const owner of owners) {
          const groups = sent.filter((g) => g.player === owner);
          const from = groups.map((g) => g.point);
          push(missionThreat('missionSend', owner, result.point, unitsOf(groups), from, fire(), index));
        }
      } else if (result.opcode === 'MoveUnitsInArea') {
        // The one line that spells its destination with the generic index and extra kinds.
        const destination = { hx: result.index, hy: result.extra };
        push(missionThreat('missionMove', result.player, destination, [], [], fire(), index));
      }
    }
  });
  return out;
}

function missionThreat(
  source: ThreatSource,
  player: number | null,
  target: IntentPoint,
  units: readonly ThreatUnits[],
  from: readonly IntentPoint[],
  trigger: Trigger,
  mission: number,
): ScriptedThreat {
  return {
    source,
    player,
    target,
    range: 0,
    units,
    soldiers: null,
    rally: null,
    from,
    trigger,
    mission,
    task: null,
    waves: [],
  };
}

/** A mission's fighter spawns, one group per owner, point and mission id in first-line order. */
function spawnGroups(content: ContentSet, results: readonly MissionResultOp[]): SpawnGroup[] {
  const groups: SpawnGroup[] = [];
  for (const result of results) {
    if (!isSpawn(result) || !isFighterJob(content, result.job)) continue;
    const count = result.opcode === 'SetHumanX' ? result.amount : 1;
    let group = groups.find(
      (g) =>
        g.player === result.player &&
        g.humanId === result.humanId &&
        g.point.hx === result.point.hx &&
        g.point.hy === result.point.hy,
    );
    if (group === undefined) {
      group = { player: result.player, point: result.point, humanId: result.humanId, units: new Map() };
      groups.push(group);
    }
    group.units.set(result.job, (group.units.get(result.job) ?? 0) + count);
  }
  return groups;
}

function isSpawn(result: MissionResultOp): result is SpawnOp {
  return result.opcode === 'SetHuman' || result.opcode === 'SetHumanX';
}

/** Units summed per job, ascending job. */
function unitsOf(groups: readonly SpawnGroup[]): ThreatUnits[] {
  const byJob = new Map<number, number>();
  for (const group of groups) {
    for (const [job, count] of group.units) byJob.set(job, (byJob.get(job) ?? 0) + count);
  }
  return [...byJob.entries()].sort(([a], [b]) => a - b).map(([job, count]) => ({ job, count }));
}

/**
 * The threats that reach `seat`: another player's (or an unknown owner's) attack whose target lies
 * within its reach plus {@link TERRITORY_MARGIN_NODES} of the seat's anchor or a start building. An
 * Attack band goes for the enemy house on its target, else to within half its range of it (MISSIONS.md,
 * AI data), so half the range is its reach.
 */
export function threatsToward(
  threats: readonly ScriptedThreat[],
  seat: number,
  territory: SeatTerritory,
): SeatThreat[] {
  const out: SeatThreat[] = [];
  for (const threat of threats) {
    if (threat.player === seat) continue;
    const reach = Math.trunc(threat.range / 2) + TERRITORY_MARGIN_NODES;
    const near =
      hexDistance(threat.target, territory.anchor) <= reach ||
      territory.buildings.some((b) => hexDistance(threat.target, b) <= reach);
    if (near) out.push({ ...threat, distance: hexDistance(threat.target, territory.anchor) });
  }
  return out;
}
