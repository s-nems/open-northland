import { hexDistance } from '../../../../nav/halfcell.js';
import {
  type MissionGoalOp,
  type MissionResultOp,
  type MissionScript,
  SUCCESSFUL_IF,
} from '../../../missions/script.js';
import type { IntentPoint, MissionTiming, Trigger } from './triggers.js';

export interface IntentArea {
  readonly point: IntentPoint;
  /** In map points (`hexDistance`), as the mission range goals measure. */
  readonly range: number;
}

/** How a script pays for holding an area: a presence check on a repeating timer that hands over goods a
 *  deciding deliver objective counts. */
export interface HoldReward {
  /** The repeating timer's first tick, its cadence when it re-arms itself from the map start. */
  readonly everyTicks: number;
  /** How many rewarded checks the deciding objective needs. */
  readonly checks: number;
  /** The deliver objective's mission the rewards feed. */
  readonly feeds: number;
}

/**
 * What a goal asks of the players it names, classified over the goal opcodes. `player` is whose units,
 * goods or houses count, which on a team map is not always the seat itself.
 */
export type Objective =
  | { readonly kind: 'defeatPlayers'; readonly players: readonly number[] }
  /** Outlast every rival: the skirmish rule or a goal table's last-standing row. */
  | { readonly kind: 'eliminateRivals' }
  | {
      readonly kind: 'holdArea';
      readonly player: number;
      readonly area: IntentArea;
      readonly minUnits: number;
      /** Null for a one-time check; set for an area the script rewards holding again and again. */
      readonly reward: HoldReward | null;
    }
  | { readonly kind: 'reachArea'; readonly player: number | null; readonly area: IntentArea }
  | {
      readonly kind: 'deliverGoods';
      readonly player: number | null;
      readonly good: number;
      readonly amount: number;
      readonly area: IntentArea | null;
    }
  | {
      readonly kind: 'buildHouses';
      readonly player: number;
      readonly houseType: number;
      readonly amount: number;
      readonly area: IntentArea | null;
    }
  /** `tick` is the earliest the timer runs out, when the chain to it is timed. */
  | { readonly kind: 'surviveUntil'; readonly seconds: number; readonly tick: number | null }
  | {
      readonly kind: 'growPopulation';
      readonly player: number;
      readonly amount: number;
      readonly soldiers: boolean;
    }
  | { readonly kind: 'trainUnits'; readonly player: number; readonly job: number; readonly amount: number }
  | { readonly kind: 'killUnits'; readonly player: number; readonly amount: number }
  /** Every scripted object carrying the mission id gone. */
  | {
      readonly kind: 'destroyObjects';
      readonly family: 'humans' | 'houses' | 'vehicles' | 'animals';
      readonly objectId: number;
    }
  | { readonly kind: 'payTribute'; readonly slot: number }
  | { readonly kind: 'meetPlayer'; readonly player: number; readonly other: number }
  | { readonly kind: 'unknown'; readonly opcode: string };

export type ObjectiveKind = Objective['kind'];

/**
 * How an objective bears on a verdict: `decides` is a goal of the mission naming the seat,
 * `prerequisite` a goal of a mission that leads to it, `supply` a goal of a mission that hands over
 * goods a deliver objective needs.
 */
export type ObjectiveRole = 'decides' | 'prerequisite' | 'supply';

export interface ScriptObjective {
  /** `win` from a `MissionWon`, `lose` from a `MissionFailed` naming the seat. */
  readonly verdict: 'win' | 'lose';
  readonly role: ObjectiveRole;
  /** The mission whose goal this is. */
  readonly mission: number;
  readonly objective: Objective;
}

/** Results that hand a player goods, which a deliver objective's supply missions are found by. */
type GoodsGrant = Extract<
  MissionResultOp,
  { opcode: 'AddGoodsToMapArea' | 'AddGoodsToAnyStock' | 'AddGoodsToHouses' }
>;

/**
 * The objectives a script sets `seat`: from every mission whose results name it won or lost, back
 * through the missions that activate it or that its goals probe (`IsMissionDone`, `CheckMission`,
 * `IfMissionIsActive`), plus the goals of missions supplying a deliver objective's goods. Ascending
 * mission order, each objective once per verdict and role.
 */
export function scriptObjectivesOf(
  script: MissionScript,
  timing: MissionTiming,
  seat: number,
): ScriptObjective[] {
  const out: ScriptObjective[] = [];
  const seen = new Set<string>();
  const push = (entry: ScriptObjective) => {
    const key = `${entry.verdict}|${entry.role}|${JSON.stringify(entry.objective)}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(entry);
  };
  for (const verdict of ['win', 'lose'] as const) {
    const opcode = verdict === 'win' ? 'MissionWon' : 'MissionFailed';
    const deciding = missionsWhere(script, (r) => r.opcode === opcode && r.player === seat);
    const visited = new Set<number>(deciding);
    const open: { mission: number; role: ObjectiveRole }[] = deciding.map((mission) => ({
      mission,
      role: 'decides',
    }));
    while (open.length > 0) {
      const next = open.shift();
      if (next === undefined) break;
      const def = script.missions[next.mission];
      if (def === undefined) continue;
      const linked: number[] = [...timing.activatorsOf(next.mission)];
      for (const goal of def.goals) {
        if (
          goal.opcode === 'IsMissionDone' ||
          goal.opcode === 'CheckMission' ||
          goal.opcode === 'IfMissionIsActive'
        ) {
          linked.push(goal.missionIndex);
        }
      }
      for (const objective of missionObjectives(def.goals, def.successfullIf, timing, next.mission)) {
        push({ verdict, role: next.role, mission: next.mission, objective });
        if (objective.kind === 'deliverGoods') {
          for (const supplier of suppliersOf(script, objective)) {
            const supplied = script.missions[supplier];
            if (supplied === undefined) continue;
            for (const supply of missionObjectives(
              supplied.goals,
              supplied.successfullIf,
              timing,
              supplier,
            )) {
              const objectiveOf =
                holdOfSupply(supply, supplied.results, timing.fireOf(supplier), objective, next.mission) ??
                supply;
              push({ verdict, role: 'supply', mission: supplier, objective: objectiveOf });
            }
          }
        }
      }
      for (const mission of [...new Set(linked)].sort((a, b) => a - b)) {
        if (visited.has(mission)) continue;
        visited.add(mission);
        open.push({ mission, role: 'prerequisite' });
      }
    }
  }
  return out;
}

/** A mission's goals as objectives; under the all-rule its `PlayerDied` goals join one `defeatPlayers`. */
function missionObjectives(
  goals: readonly MissionGoalOp[],
  rule: number,
  timing: MissionTiming,
  mission: number,
): Objective[] {
  const out: Objective[] = [];
  const defeated: number[] = [];
  for (const goal of goals) {
    const objective = objectiveOfGoal(goal, timing, mission);
    if (objective === null) continue;
    if (objective.kind === 'defeatPlayers' && rule === SUCCESSFUL_IF.all) defeated.push(...objective.players);
    else out.push(objective);
  }
  if (defeated.length > 0)
    out.unshift({ kind: 'defeatPlayers', players: [...new Set(defeated)].sort((a, b) => a - b) });
  return out;
}

/**
 * A supply goal read as holding an area: a presence goal on an area whose mission fires on a repeating
 * timer and hands over the deliver objective's good each time, so holding the area is what wins it. Null
 * for any other supply.
 */
function holdOfSupply(
  supply: Objective,
  results: readonly MissionResultOp[],
  fire: Trigger,
  deliver: Extract<Objective, { kind: 'deliverGoods' }>,
  feeds: number,
): Objective | null {
  if (supply.kind !== 'reachArea' && supply.kind !== 'holdArea') return null;
  if (supply.player === null) return null;
  const everyTicks = repeatingTimerTick(fire);
  if (everyTicks === null) return null;
  let granted = 0;
  for (const r of results) if (isGoodsGrant(r) && r.good === deliver.good) granted += r.amount;
  if (granted <= 0) return null;
  return {
    kind: 'holdArea',
    player: supply.player,
    area: supply.area,
    minUnits: supply.kind === 'holdArea' ? supply.minUnits : 1,
    reward: { everyTicks, checks: Math.ceil(deliver.amount / granted), feeds },
  };
}

/** The tick of the first repeating timer a trigger waits on, null when none repeats. */
function repeatingTimerTick(t: Trigger): number | null {
  switch (t.kind) {
    case 'atTick':
      return t.repeats ? t.tick : null;
    case 'window':
      return t.repeats ? t.fromTick : null;
    case 'conditional':
      for (const c of t.conditions) {
        if (c.kind !== 'nested') continue;
        const tick = repeatingTimerTick(c.trigger);
        if (tick !== null) return tick;
      }
      return null;
    case 'always':
    case 'never':
      return null;
  }
}

function missionsWhere(script: MissionScript, test: (result: MissionResultOp) => boolean): number[] {
  const out: number[] = [];
  script.missions.forEach((mission, index) => {
    if (mission.results.some(test)) out.push(index);
  });
  return out;
}

/** Missions whose results hand over the deliver objective's good: into its area when it has one. */
function suppliersOf(
  script: MissionScript,
  objective: Extract<Objective, { kind: 'deliverGoods' }>,
): number[] {
  return missionsWhere(script, (r) => {
    if (!isGoodsGrant(r) || r.good !== objective.good) return false;
    if (r.opcode === 'AddGoodsToMapArea' && objective.area !== null) {
      return hexDistance(r.point, objective.area.point) <= objective.area.range + r.range;
    }
    return r.opcode !== 'AddGoodsToAnyStock' || objective.player === null || r.player === objective.player;
  });
}

function isGoodsGrant(r: MissionResultOp): r is GoodsGrant {
  return (
    r.opcode === 'AddGoodsToMapArea' || r.opcode === 'AddGoodsToAnyStock' || r.opcode === 'AddGoodsToHouses'
  );
}

/** One goal as an objective, or null for a goal that asks nothing (`True`) or only chains missions. */
export function objectiveOfGoal(
  goal: MissionGoalOp,
  timing: MissionTiming,
  mission: number,
): Objective | null {
  switch (goal.opcode) {
    case 'True':
    case 'IsMissionDone':
    case 'CheckMission':
    case 'IfMissionIsActive':
      return null;
    case 'PlayerDied':
      return { kind: 'defeatPlayers', players: [goal.player] };
    case 'TimeGone':
    case 'RandomTimeGone': {
      const fire = timing.fireOf(mission);
      return { kind: 'surviveUntil', seconds: goal.seconds, tick: fire.kind === 'atTick' ? fire.tick : null };
    }
    case 'FindPosByPlayersMapMoveable':
    case 'DetectGuide':
      return { kind: 'reachArea', player: goal.player, area: { point: goal.point, range: goal.range } };
    case 'FindPos':
      return { kind: 'reachArea', player: goal.player, area: { point: goal.point, range: 0 } };
    case 'FindPosByHumans':
      return { kind: 'reachArea', player: null, area: { point: goal.point, range: goal.range } };
    case 'NumberOfSoldiersNearPos':
    case 'NumberOfCivilainsNearPos':
      return {
        kind: 'holdArea',
        player: goal.player,
        area: { point: goal.point, range: goal.range },
        minUnits: goal.amount,
        reward: null,
      };
    case 'NumberOfGoodsInArea':
    case 'NumberOfGoodsInHousesInArea':
      return {
        kind: 'deliverGoods',
        player: goal.player,
        good: goal.good,
        amount: goal.amount,
        area: { point: goal.point, range: goal.range },
      };
    case 'GoodsGlobal':
      return { kind: 'deliverGoods', player: goal.player, good: goal.good, amount: goal.amount, area: null };
    case 'GoodsInHouses':
      return { kind: 'deliverGoods', player: null, good: goal.good, amount: goal.amount, area: null };
    case 'BuildHouses':
      return {
        kind: 'buildHouses',
        player: goal.player,
        houseType: goal.houseType,
        amount: goal.amount,
        area: null,
      };
    case 'NumberOfHousesInArea':
      return {
        kind: 'buildHouses',
        player: goal.player,
        houseType: goal.houseType,
        amount: goal.amount,
        area: { point: goal.point, range: goal.range },
      };
    case 'BuildHouseOnContinent':
      return {
        kind: 'buildHouses',
        player: goal.player,
        houseType: goal.houseType,
        amount: 1,
        area: { point: goal.point, range: 0 },
      };
    case 'Population':
    case 'HumansWithHome':
      return { kind: 'growPopulation', player: goal.player, amount: goal.amount, soldiers: false };
    case 'NumberOfSoldiers':
      return { kind: 'growPopulation', player: goal.player, amount: goal.amount, soldiers: true };
    case 'BuildHumans':
    case 'HumanAttachedToWorkHouse':
      return { kind: 'trainUnits', player: goal.player, job: goal.job, amount: goal.amount };
    case 'NumberOfHumansKilled':
      return { kind: 'killUnits', player: goal.player, amount: goal.amount };
    case 'HumansDied':
      return { kind: 'destroyObjects', family: 'humans', objectId: goal.humanId };
    case 'HousesDied':
      return { kind: 'destroyObjects', family: 'houses', objectId: goal.objectId };
    case 'VehiclesDied':
      return { kind: 'destroyObjects', family: 'vehicles', objectId: goal.vehicleId };
    case 'AnimalsDied':
      return { kind: 'destroyObjects', family: 'animals', objectId: goal.objectId };
    case 'PayTribute':
      return { kind: 'payTribute', slot: goal.slot };
    case 'PlayerSeen':
      return { kind: 'meetPlayer', player: goal.player, other: goal.otherPlayer };
    default:
      return { kind: 'unknown', opcode: goal.opcode };
  }
}
