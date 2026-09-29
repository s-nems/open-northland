import { isCivilizationTribe as isCivilization, type MapAiSeat, type MapScript } from '@open-northland/data';
import type { GameSession } from '@open-northland/lockstep';
import type { MissionHouseRef, MissionScript } from '@open-northland/sim';
import type { AuthoredPlacement } from './world/authored-placements.js';
import type { MapScriptWorld } from './world/build.js';
import type { AuthoredJoinRows } from './world/content-joins.js';
import { mapScriptWorld } from './world/mission-script.js';

/** Seat to the civilization the lobby chose for it, for the seats whose choice differs from the map's. */
export type SeatTribes = ReadonlyMap<number, number>;

/**
 * The seats the session plays as another civilization than the map's roster row names. A monster seat
 * has no civilization to trade, so it keeps its own tribe whatever the session carries.
 */
export function sessionSeatTribes(
  session: Pick<GameSession, 'seats'>,
  players: MapScript['players'],
): SeatTribes {
  const chosen = new Map<number, number>();
  for (const seat of session.seats) {
    if (seat.tribe === undefined || !isCivilization(seat.tribe)) continue;
    const authored = players.find((row) => row.player === seat.player)?.tribeId;
    if (authored === undefined || !isCivilization(authored) || authored === seat.tribe) continue;
    chosen.set(seat.player, seat.tribe);
  }
  return chosen;
}

/**
 * The tribe a seat's own things take once the lobby changed its civilization: every civilization
 * settler, vehicle, building, permission row and script line of that seat, so a mixed-tribe town
 * becomes one people. A monster or an animal keeps its tribe, and so does a building type the chosen
 * civilization has no graphics for (the viking big ship, the wonders).
 */
export interface SeatTribeRemap {
  readonly changed: boolean;
  tribe(owner: number | undefined, tribe: number): number;
  building(owner: number | undefined, typeId: number, tribe: number): number;
}

export const MAP_TRIBES: SeatTribeRemap = {
  changed: false,
  tribe: (_owner, tribe) => tribe,
  building: (_owner, _typeId, tribe) => tribe,
};

export function seatTribeRemap(
  seatTribes: SeatTribes,
  rows: Pick<AuthoredJoinRows, 'buildingBobs'>,
): SeatTribeRemap {
  if (seatTribes.size === 0) return MAP_TRIBES;
  const drawn = new Set<string>();
  for (const bob of rows.buildingBobs ?? []) {
    if (bob.typeId !== undefined && bob.tribeId !== undefined) drawn.add(`${bob.tribeId}:${bob.typeId}`);
  }
  const tribe = (owner: number | undefined, current: number): number => {
    const chosen = owner === undefined ? undefined : seatTribes.get(owner);
    return chosen !== undefined && isCivilization(current) ? chosen : current;
  };
  return {
    changed: true,
    tribe,
    building: (owner, typeId, current) => {
      const next = tribe(owner, current);
      return drawn.has(`${next}:${typeId}`) ? next : current;
    },
  };
}

/** The roster as the session plays it: the chosen civilization on each changed seat's row. */
function seatedRoster(players: MapScript['players'], seatTribes: SeatTribes): MapScript['players'] {
  if (seatTribes.size === 0) return players;
  return players.map((row) => {
    const tribeId = seatTribes.get(row.player);
    return tribeId === undefined ? row : { ...row, tribeId };
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

/** A resolved script line naming a player and a tribe or a house of one: its tribe follows the seat. */
function seatedOp<T extends object>(op: T, remap: SeatTribeRemap): T {
  if (!('player' in op) || typeof op.player !== 'number') return op;
  const owner = op.player;
  let seated = op;
  if ('tribe' in op && typeof op.tribe === 'number') {
    const tribe = remap.tribe(owner, op.tribe);
    if (tribe !== op.tribe) seated = { ...seated, tribe };
  }
  if ('houseName' in op && isHouseRef(op.houseName)) {
    const house = op.houseName;
    const tribe = remap.building(owner, house.typeId, house.tribe);
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
    missions: script.missions.map((mission) => ({
      ...mission,
      goals: mission.goals.map((op) => seatedOp(op, remap)),
      results: mission.results.map((op) => seatedOp(op, remap)),
    })),
  };
}

/** A seat's `[AIData]` tasks that raise settlers raise them of the seat's chosen civilization. */
function seatedAi(seats: readonly MapAiSeat[], remap: SeatTribeRemap): readonly MapAiSeat[] {
  return seats.map((seat) => ({
    ...seat,
    tasks: seat.tasks.map((task) =>
      task.kind === 'createCreatures' ? { ...task, tribe: remap.tribe(seat.player, task.tribe) } : task,
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
    if (p.kind === 'building') return { ...p, tribe: remap.building(p.owner, p.typeId, p.tribe) };
    if (p.kind === 'human' || p.kind === 'vehicle') return { ...p, tribe: remap.tribe(p.owner, p.tribe) };
    return p;
  });
}

/** A session's seats as the world plays them: the seated roster and the remap its things take. */
export interface SessionSeating {
  readonly players: MapScript['players'];
  readonly remap: SeatTribeRemap;
}

export function sessionSeating(
  session: Pick<GameSession, 'seats'>,
  players: MapScript['players'],
  rows: Pick<AuthoredJoinRows, 'buildingBobs'>,
): SessionSeating {
  const seatTribes = sessionSeatTribes(session, players);
  return { players: seatedRoster(players, seatTribes), remap: seatTribeRemap(seatTribes, rows) };
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
  rows: AuthoredJoinRows | null,
): SessionMapScript {
  const { players, remap } = sessionSeating(session, script?.players ?? [], rows ?? {});
  const seated = script === null ? null : seatedMapScript(script, players, remap);
  return { script: seated, world: seatedScriptWorld(mapScriptWorld(seated, rows), remap), remap };
}
