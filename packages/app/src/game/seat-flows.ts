import {
  decodeMissionResult,
  isCivilizationTribe,
  type MapScript,
  type MissionPoint,
  type MissionResult,
} from '@open-northland/data';
import type { GameSession } from '@open-northland/lockstep';
import { hexDistanceBetween } from '@open-northland/sim';

/** A seat the session plays as another civilization: the people the map authored for it and the chosen one. */
export interface SeatChange {
  readonly seat: number;
  readonly authored: number;
  readonly chosen: number;
}

/** The roster and script lines that decide which seats play another civilization and what reaches them. */
export type SeatScript = Pick<MapScript, 'players' | 'missions'>;

export type FlowKind = 'human' | 'house' | 'vehicle';

/** A placed or spawned thing, located the way the script's handover lines address it. */
export interface FlowingThing {
  readonly owner: number | undefined;
  readonly missionId?: number | undefined;
  readonly at?: MissionPoint | undefined;
}

/** The things of `player` an area line hands on: within `range` of `point`, or all of them for no point. */
interface AreaFlow {
  readonly player: number;
  readonly kinds: readonly FlowKind[];
  readonly point: MissionPoint | null;
  readonly range: number;
  readonly change: SeatChange;
}

/**
 * Everything the script will hand a re-tribed seat, read off the script before the world is built:
 * the seats it hands over whole, the mission ids its by-id lines hand, and the areas whose contents
 * it hands. Whatever reaches the seat by a line the script may never run (a diplomacy choice) counts.
 */
export interface SeatFlows {
  /** The session's re-tribed seats. */
  readonly changes: ReadonlyMap<number, SeatChange>;
  /** Owners all of whose things reach a re-tribed seat: the seat itself and the seats handed to it whole. */
  readonly seats: ReadonlyMap<number, SeatChange>;
  /** Per id, the seats it is handed to, in line order. */
  readonly ids: Readonly<Record<FlowKind, ReadonlyMap<number, readonly SeatChange[]>>>;
  readonly areas: readonly AreaFlow[];
  /** Seats another person plays, whose things move only when a handover delivers them. A computer, map-AI
   *  or idle seat may hold the seat's people staged for it. Read from the session as it starts or
   *  resumes: a seat saved as a person's and resumed as a computer's stages from then on, which changes
   *  later spawns, never what the save already holds. */
  readonly played: ReadonlySet<number>;
}

/** "No id": a handover of it reaches every id-less human, which only the handover itself can tell apart. */
const NO_MISSION_ID = 0;

/**
 * The seats the session plays as another civilization than the map's roster row names. A monster seat
 * has no civilization to trade, so it keeps its own tribe whatever the session carries.
 */
export function sessionSeatChanges(
  session: Pick<GameSession, 'seats'>,
  script: Pick<MapScript, 'players'>,
): ReadonlyMap<number, SeatChange> {
  const changes = new Map<number, SeatChange>();
  for (const seat of session.seats) {
    if (seat.tribe === undefined || !isCivilizationTribe(seat.tribe)) continue;
    const authored = script.players.find((row) => row.player === seat.player)?.tribeId;
    if (authored === undefined || !isCivilizationTribe(authored) || authored === seat.tribe) continue;
    changes.set(seat.player, { seat: seat.player, authored, chosen: seat.tribe });
  }
  return changes;
}

export function seatFlows(session: Pick<GameSession, 'seats'>, script: SeatScript): SeatFlows {
  const changes = sessionSeatChanges(session, script);
  const played = new Set(session.seats.filter((seat) => seat.mode === 'human').map((seat) => seat.player));
  const flows: SeatFlows = {
    changes,
    seats: new Map(changes),
    ids: { human: new Map(), house: new Map(), vehicle: new Map() },
    areas: [],
    played,
  };
  if (changes.size === 0) return flows;
  const lines = script.missions.flatMap((mission) =>
    mission.results.map((line) => decodeMissionResult(line)),
  );
  handWholeSeats(flows, lines);
  handIds(flows, lines);
  handAreas(flows, lines);
  return flows;
}

/** A seat the session does not play, whose things may all be staged for a re-tribed seat. */
function staging(flows: SeatFlows, player: number): boolean {
  return !flows.played.has(player) && !flows.seats.has(player);
}

/** `ChangePlayerPlayerId`, followed through chains of seats handed on. */
function handWholeSeats(flows: SeatFlows, lines: readonly MissionResult[]): void {
  const seats = flows.seats as Map<number, SeatChange>;
  let grew = true;
  while (grew) {
    grew = false;
    for (const op of lines) {
      if (op.opcode !== 'ChangePlayerPlayerId') continue;
      const change = seats.get(op.otherPlayer);
      if (change === undefined || !staging(flows, op.player)) continue;
      seats.set(op.player, change);
      grew = true;
    }
  }
}

/** The by-id handovers to a receiving seat, and the vehicle ids renumbered onto a handed one. */
function handIds(flows: SeatFlows, lines: readonly MissionResult[]): void {
  const hand = (kind: FlowKind, id: number, to: number): void => {
    const change = flows.seats.get(to);
    if (change === undefined || id === NO_MISSION_ID) return;
    const ids = flows.ids[kind] as Map<number, SeatChange[]>;
    const seats = ids.get(id) ?? [];
    if (!seats.includes(change)) ids.set(id, [...seats, change]);
  };
  for (const op of lines) {
    if (op.opcode === 'ChangeHumanPlayerId') hand('human', op.humanId, op.player);
    else if (op.opcode === 'ChangeHousesPlayerId') hand('house', op.objectId, op.player);
    else if (op.opcode === 'ChangeVehiclesPlayerId') hand('vehicle', op.vehicleId, op.player);
  }
  const vehicles = flows.ids.vehicle as Map<number, readonly SeatChange[]>;
  let grew = true;
  while (grew) {
    grew = false;
    for (const op of lines) {
      if (op.opcode !== 'ChangeMissionIdOfVehicles') continue;
      const handed = vehicles.get(op.index);
      if (handed === undefined || vehicles.has(op.vehicleId)) continue;
      vehicles.set(op.vehicleId, handed);
      grew = true;
    }
  }
}

/**
 * The area lines: a seat's things handed within an area, and a seat's things stamped with a handed id
 * within an area or anywhere. Read at the authored places, so a unit that walks into the area later
 * is left to the handover's own check.
 */
function handAreas(flows: SeatFlows, lines: readonly MissionResult[]): void {
  const areas = flows.areas as AreaFlow[];
  const add = (
    player: number,
    kinds: readonly FlowKind[],
    point: MissionPoint | null,
    range: number,
    changes: readonly SeatChange[] | undefined,
  ): void => {
    if (flows.played.has(player)) return;
    for (const change of changes ?? []) areas.push({ player, kinds, point, range, change });
  };
  const ALL: readonly FlowKind[] = ['human', 'house', 'vehicle'];
  for (const op of lines) {
    switch (op.opcode) {
      case 'ChangePlayerIdInArea':
        add(op.player, ALL, op.point, op.range, seatsOf(flows.seats.get(op.otherPlayer)));
        break;
      case 'ChangeHumanObjectIdInArea':
      case 'ChangeMissionIdOfHumanInRange':
        add(op.player, ['human'], op.point, op.range, flows.ids.human.get(op.humanId));
        break;
      case 'ChangeMissionIdOfPlayer':
        add(op.player, ['human'], null, 0, flows.ids.human.get(op.humanId));
        break;
      case 'ChangeMissionIdOfVehiclesInRange':
        add(op.player, ['vehicle'], op.point, op.range, flows.ids.vehicle.get(op.vehicleId));
        break;
      // The continent is a property of the built terrain; every vehicle of the seat stands in for it.
      case 'ChangeMissionIdOfPlayersVehiclesOnContinent':
        add(op.player, ['vehicle'], null, 0, flows.ids.vehicle.get(op.vehicleId));
        break;
      default:
        break;
    }
  }
}

function seatsOf(change: SeatChange | undefined): readonly SeatChange[] {
  return change === undefined ? [] : [change];
}

/**
 * The re-tribed seat whose authored people `thing` (of `tribe`) is and reaches: through its owner, its
 * mission id or an area, in that order. A computer seat's own people follow its own choice, while a
 * thing of another seat's people it holds follows the seat the script hands it to.
 */
export function flowOf(
  flows: SeatFlows,
  kind: FlowKind,
  thing: FlowingThing,
  tribe: number,
): SeatChange | undefined {
  const { owner, missionId, at } = thing;
  if (owner === undefined) return undefined;
  const of = (change: SeatChange | undefined): SeatChange | undefined =>
    change?.authored === tribe ? change : undefined;
  const whole = of(flows.seats.get(owner));
  if (whole !== undefined || flows.played.has(owner)) return whole;
  const byId = (missionId === undefined ? undefined : flows.ids[kind].get(missionId))?.find(
    (change) => change.authored === tribe,
  );
  if (byId !== undefined) return byId;
  for (const area of flows.areas) {
    if (area.player !== owner || !area.kinds.includes(kind) || area.change.authored !== tribe) continue;
    if (area.point === null) return area.change;
    if (at !== undefined && hexDistanceBetween(at.hx, at.hy, area.point.hx, area.point.hy) <= area.range)
      return area.change;
  }
  return undefined;
}
