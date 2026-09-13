import type { GameSession } from '@open-northland/lockstep';
import type { RoomSettings, RoomState, RoomView } from '@open-northland/net-protocol';
import type { Member } from './member.js';
import type { SeatTable } from './seats.js';

/** Serialize the public room without exposing its identity tokens or mutable membership objects. */
export function roomView(
  id: string,
  state: RoomState,
  creatorToken: string,
  settings: RoomSettings,
  seats: SeatTable,
  members: ReadonlyMap<string, Member>,
): RoomView {
  const creator = members.get(creatorToken);
  if (creator === undefined) throw new Error(`room ${id} has members but no creator`);
  return {
    id,
    state,
    creator: creator.nick,
    settings,
    seats: seats.views(),
    members: [...members.values()].map(({ nick, seat, connected, compatibility }) => ({
      nick,
      seat,
      connected,
      compatibility,
    })),
  };
}

/** Initial-save identity and the shared roster are fixed while localSeat varies per recipient. */
export function sessionForMember(
  member: Member,
  settings: RoomSettings,
  seats: GameSession['seats'] | null,
): GameSession {
  if (member.seat === null) throw new Error(`${member.nick} has no seat in a started room`);
  if (seats === null) throw new Error('no descriptor before the start');
  return {
    ...(settings.initialSave === undefined ? {} : { initialSave: settings.initialSave }),
    ...(settings.kickedSeatMode === undefined ? {} : { kickedSeatMode: settings.kickedSeatMode }),
    world: settings.world,
    seed: settings.seed,
    seats,
    localSeat: member.seat,
    rules: settings.rules,
    speed: settings.speed,
  };
}
