import {
  type BuildingFootprint,
  type BuildingRecordFootprint,
  type BuildingTribeVariant,
  type MapAiSeat,
  type MapScript,
  sameBuildingFootprintCells,
} from '@open-northland/data';
import type { GameSession } from '@open-northland/lockstep';
import {
  type MissionGoalOp,
  type MissionHouseRef,
  type MissionResultOp,
  type MissionScript,
  type MissionSeatTribe,
  systems,
} from '@open-northland/sim';
import { civilizationTribes } from '../../content/civilizations.js';
import type { AuthoredPlacement } from '../world/authored-placements.js';
import type { MapScriptWorld } from '../world/build.js';
import type { AuthoredJoinRows } from '../world/content-joins.js';
import { mapScriptWorld } from '../world/mission-script.js';
import {
  type FlowingThing,
  type FlowKind,
  flowOf,
  type SeatChange,
  type SeatFlows,
  type SeatScript,
  seatFlows,
} from './seat-flows.js';

/**
 * The tribe a thing takes once the lobby changed its seat's civilization (`docs/formats/MISSIONS.md`,
 * "Seats played as another civilization"). Whatever reaches a re-tribed seat - its own placements,
 * a seat handed to it whole, a handed id or area, a spawn for any of these - takes the chosen people
 * when it is of the seat's authored people; a thing of another people stays that people, as do a hero
 * (Bjarni stays a viking), a monster, an animal and a building type the chosen civilization has no
 * graphics for (the viking big ship, the wonders).
 */
export interface SeatTribeRemap {
  readonly changed: boolean;
  /** A seat-wide row or line naming a people: a permission, an unlock, an AI task. */
  tribe(owner: number | undefined, tribe: number): number;
  /** A settler's tribe by its job typeId; an unresolved job counts as no hero. */
  human(thing: FlowingThing, job: number | undefined, tribe: number): number;
  vehicle(thing: FlowingThing, tribe: number): number;
  /** A house's tribe by its type and, for a map-placed house, its record. */
  building(thing: FlowingThing, typeId: number, tribe: number, record?: string): number;
  /** The re-tribed seats, for the handover safety net the mission script carries. */
  readonly seatTribes: readonly MissionSeatTribe[];
}

export const MAP_TRIBES: SeatTribeRemap = {
  changed: false,
  tribe: (_owner, tribe) => tribe,
  human: (_thing, _job, tribe) => tribe,
  vehicle: (_thing, tribe) => tribe,
  building: (_thing, _typeId, tribe) => tribe,
  seatTribes: [],
};

/** A building type row with the per-tribe footprints a handed house's conversion compares. */
interface SeatBuildingRow {
  readonly typeId?: number;
  readonly footprint?: BuildingFootprint;
  readonly tribeVariants?: readonly BuildingTribeVariant[];
  readonly recordFootprints?: readonly BuildingRecordFootprint[];
}

/** The content rows the remap reads: the drawn house types, the hero jobs, the house footprints and the
 *  tribes whose flagged rows join the civilization list. */
export type SeatTribeRows = Pick<AuthoredJoinRows, 'buildingBobs' | 'jobs' | 'tribes'> & {
  readonly buildings?: readonly SeatBuildingRow[];
};

export function seatTribeRemap(flows: SeatFlows, rows: SeatTribeRows): SeatTribeRemap {
  if (flows.changes.size === 0) return MAP_TRIBES;
  const footprints = new Map<number, SeatBuildingRow>();
  for (const row of rows.buildings ?? []) if (row.typeId !== undefined) footprints.set(row.typeId, row);
  /** A house a handover delivers keeps its authored people when the two peoples stand its type on
   *  different footprint cells, as the handover net rules; the seat's own houses are placed fresh.
   *  A type without a row has no footprint for either. */
  const sameCells = (typeId: number, authored: number, chosen: number, record?: string): boolean => {
    const row = footprints.get(typeId);
    if (row === undefined) return true;
    const type = {
      footprint: row.footprint,
      tribeVariants: row.tribeVariants ?? [],
      recordFootprints: row.recordFootprints ?? [],
    };
    return sameBuildingFootprintCells(type, authored, chosen, record);
  };
  const drawn = new Map<number, Set<number>>();
  for (const bob of rows.buildingBobs ?? []) {
    if (bob.typeId === undefined || bob.tribeId === undefined) continue;
    const types = drawn.get(bob.tribeId) ?? new Set<number>();
    types.add(bob.typeId);
    drawn.set(bob.tribeId, types);
  }
  const heroJobs = new Set<number>();
  for (const job of rows.jobs ?? []) {
    if (job.typeId !== undefined && job.id !== undefined && systems.isHeroJobRow({ id: job.id })) {
      heroJobs.add(job.typeId);
    }
  }
  const moved = (change: SeatChange | undefined, current: number): number =>
    change !== undefined && current === change.authored ? change.chosen : current;
  const reached = (kind: FlowKind, thing: FlowingThing, current: number): number =>
    flowOf(flows, kind, thing, current)?.chosen ?? current;
  return {
    changed: true,
    tribe: (owner, current) => moved(owner === undefined ? undefined : flows.seats.get(owner), current),
    human: (thing, job, current) =>
      job !== undefined && heroJobs.has(job) ? current : reached('human', thing, current),
    vehicle: (thing, current) => reached('vehicle', thing, current),
    building: (thing, typeId, current, record) => {
      const change = flowOf(flows, 'house', thing, current);
      if (change === undefined || drawn.get(change.chosen)?.has(typeId) !== true) return current;
      const own = change.seat === thing.owner;
      return own || sameCells(typeId, current, change.chosen, record) ? change.chosen : current;
    },
    seatTribes: [...flows.changes.values()].map((change) => ({
      player: change.seat,
      authored: change.authored,
      chosen: change.chosen,
      drawnBuildings: [...(drawn.get(change.chosen) ?? [])].sort((a, b) => a - b),
    })),
  };
}

/** The roster as the session plays it: the chosen civilization on each changed seat's row, and on the row
 *  of a seat handed to it whole when that seat was authored as the same people, since what it raises
 *  reaches the changed seat too. */
function seatedRoster(players: MapScript['players'], remap: SeatTribeRemap): MapScript['players'] {
  if (!remap.changed) return players;
  return players.map((row) => {
    const tribeId = remap.tribe(row.player, row.tribeId);
    return tribeId === row.tribeId ? row : { ...row, tribeId };
  });
}

/** The session's own map script: the seated roster, and each changed seat's permission rows moved to
 *  its chosen civilization, since a row applies to one `(player, tribe)` pair. */
function seatedMapScript(script: MapScript, players: MapScript['players'], remap: SeatTribeRemap): MapScript {
  if (!remap.changed) return script;
  return {
    ...script,
    players,
    ...(script.permissions === undefined
      ? {}
      : {
          permissions: script.permissions.map((row) => ({
            ...row,
            tribe: remap.tribe(row.player, row.tribe),
          })),
        }),
  };
}

/** A spawn line's thing: its seat, its id and its point. */
function spawned(player: number, missionId: number, at: FlowingThing['at']): FlowingThing {
  return { owner: player, missionId, at };
}

/** A resolved spawn line takes the tribe its thing will end with, and a moved human the human form of its
 *  class (`UnitForm`); any other line naming a player and a tribe or a house follows its seat. */
function seatedResult(op: MissionResultOp, remap: SeatTribeRemap): MissionResultOp {
  switch (op.opcode) {
    case 'SetHuman':
    case 'SetHumanX': {
      const tribe = remap.human(spawned(op.player, op.humanId, op.point), op.job, op.tribe);
      return tribe === op.tribe ? op : { ...op, tribe, humanForm: true };
    }
    case 'SetVehicle': {
      const tribe = remap.vehicle(spawned(op.player, op.vehicleId, op.point), op.tribe);
      return tribe === op.tribe ? op : { ...op, tribe };
    }
    case 'SetHouse': {
      const house = op.houseName;
      const thing = spawned(op.player, op.objectId, op.point);
      const tribe = remap.building(thing, house.typeId, house.tribe, house.record);
      return tribe === house.tribe ? op : { ...op, houseName: { ...house, tribe } };
    }
    default:
      return seatedLine(op, remap);
  }
}

function seatedLine<T extends object>(op: T, remap: SeatTribeRemap): T {
  if (!('player' in op) || typeof op.player !== 'number') return op;
  const owner = op.player;
  let seated = op;
  if ('tribe' in op && typeof op.tribe === 'number') {
    const tribe = remap.tribe(owner, op.tribe);
    if (tribe !== op.tribe) seated = { ...seated, tribe };
  }
  if ('houseName' in op && isHouseRef(op.houseName)) {
    const house = op.houseName;
    const tribe = remap.building({ owner }, house.typeId, house.tribe, house.record);
    if (tribe !== house.tribe) seated = { ...seated, houseName: { ...house, tribe } };
  }
  return seated;
}

function isHouseRef(value: unknown): value is MissionHouseRef {
  return (
    typeof value === 'object' &&
    value !== null &&
    'typeId' in value &&
    typeof value.typeId === 'number' &&
    'tribe' in value &&
    typeof value.tribe === 'number'
  );
}

export function seatedMissions(script: MissionScript, remap: SeatTribeRemap): MissionScript {
  if (!remap.changed) return script;
  return {
    ...script,
    missions: script.missions.map((mission) => ({
      ...mission,
      goals: mission.goals.map((op: MissionGoalOp) => seatedLine(op, remap)),
      results: mission.results.map((op) => seatedResult(op, remap)),
    })),
    seatTribes: remap.seatTribes,
  };
}

/** A seat's `[AIData]` tasks that raise settlers raise them of the seat's chosen civilization. */
function seatedAi(seats: readonly MapAiSeat[], remap: SeatTribeRemap): readonly MapAiSeat[] {
  return seats.map((seat) => ({
    ...seat,
    tasks: seat.tasks.map((task) =>
      task.kind === 'createCreatures'
        ? {
            ...task,
            tribe: remap.human(
              { owner: seat.player, missionId: task.missionId, at: { hx: task.x, hy: task.y } },
              task.job,
              task.tribe,
            ),
          }
        : task,
    ),
  }));
}

export function seatedScriptWorld(world: MapScriptWorld, remap: SeatTribeRemap): MapScriptWorld {
  if (!remap.changed) return world;
  return {
    ...world,
    ...(world.missions === undefined ? {} : { missions: seatedMissions(world.missions, remap) }),
    ...(world.ai === undefined ? {} : { ai: seatedAi(world.ai, remap) }),
  };
}

export function seatedPlacements(
  placements: readonly AuthoredPlacement[],
  remap: SeatTribeRemap,
): readonly AuthoredPlacement[] {
  if (!remap.changed) return placements;
  return placements.map((p): AuthoredPlacement => {
    if (p.kind !== 'building' && p.kind !== 'human' && p.kind !== 'vehicle') return p;
    const thing = { owner: p.owner, missionId: p.missionId, at: { hx: p.x, hy: p.y } };
    if (p.kind === 'building') {
      return { ...p, tribe: remap.building(thing, p.typeId, p.tribe, p.graphics?.[0]?.editName) };
    }
    if (p.kind === 'human') {
      const tribe = remap.human(thing, p.jobType, p.tribe);
      return tribe === p.tribe ? p : { ...p, tribe, humanForm: true };
    }
    return { ...p, tribe: remap.vehicle(thing, p.tribe) };
  });
}

/** A session's seats as the world plays them: the seated roster and the remap its things take. */
export interface SessionSeating {
  readonly players: MapScript['players'];
  readonly remap: SeatTribeRemap;
}

export function sessionSeating(
  session: Pick<GameSession, 'seats'>,
  script: SeatScript | null,
  rows: SeatTribeRows,
): SessionSeating {
  if (script === null) return { players: [], remap: MAP_TRIBES };
  // The content's own civilization list: the authored five plus a pack's flagged tribes rows.
  const civilizations = new Set(civilizationTribes(rows.tribes));
  const remap = seatTribeRemap(seatFlows(session, script, civilizations), rows);
  return { players: seatedRoster(script.players, remap), remap };
}

/** What a session builds its map world from: the seated script, its resolved script world and the
 *  remap its authored placements take. */
export interface SessionMapScript {
  readonly script: MapScript | null;
  readonly world: MapScriptWorld;
  readonly remap: SeatTribeRemap;
}

export function sessionMapScript(
  session: Pick<GameSession, 'seats'>,
  script: MapScript | null,
  rows: (AuthoredJoinRows & SeatTribeRows) | null,
): SessionMapScript {
  const { players, remap } = sessionSeating(session, script, rows ?? {});
  const seated = script === null ? null : seatedMapScript(script, players, remap);
  return { script: seated, world: seatedScriptWorld(mapScriptWorld(seated, rows), remap), remap };
}
