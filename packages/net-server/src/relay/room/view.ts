import type { GameSession } from '@open-northland/lockstep';
import {
  MAX_LOADING_PROGRESS,
  type RoomSettings,
  type RoomState,
  type RoomView,
  withFlag,
} from '@open-northland/net-protocol';
import type { SeatTable } from '../lobby/seats.js';
import type { Member } from '../member.js';

/** Serialize the public room without exposing its identity tokens or mutable membership objects. */
export function roomView(
  id: string,
  state: RoomState,
  creatorToken: string,
  settings: RoomSettings,
  locked: boolean,
  seats: SeatTable,
  members: ReadonlyMap<string, Member>,
  behindTicks: (member: Member) => number,
): RoomView {
  const creator = members.get(creatorToken);
  if (creator === undefined) throw new Error(`room ${id} has members but no creator`);
  return {
    id,
    state,
    creator: creator.nick,
    settings,
    locked,
    seats: seats.views(),
    members: [...members.values()].map((member) => ({
      nick: member.nick,
      ...withFlag(member.flag),
      seat: member.seat,
      connected: member.connected,
      compatibility: member.compatibility,
      load: member.load,
      loading: member.loaded ? MAX_LOADING_PROGRESS : member.loading,
      roundTripMs: member.connected ? member.roundTripMs : null,
      delayTicks: member.connected ? member.delayTicks : null,
      behindTicks: behindTicks(member),
    })),
  };
}

/** Initial-save identity and the shared roster are fixed while localSeat varies per recipient. */
export function sessionForMember(
  member: Member,
  settings: RoomSettings,
  seats: GameSession['seats'] | null,
): GameSession {
  if (seats === null) throw new Error('no descriptor before the start');
  return {
    ...(settings.initialSave === undefined ? {} : { initialSave: settings.initialSave }),
    ...(settings.kickedSeatMode === undefined ? {} : { kickedSeatMode: settings.kickedSeatMode }),
    world: settings.world,
    seed: settings.seed,
    seats,
    localSeat: member.seat ?? 'observer',
    rules: settings.rules,
    speed: settings.speed,
  };
}
