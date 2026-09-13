import { type ClientMessage, MAX_ENVELOPE_BYTES } from '@open-northland/net-protocol';
import type { Member, Refusal } from './member.js';
import type { Room } from './room.js';

export type RoomMessage = Exclude<
  ClientMessage,
  { kind: 'hello' | 'listRooms' | 'createRoom' | 'joinRoom' | 'leaveRoom' | 'pong' }
>;

export function dispatchRoomMessage(room: Room, member: Member, message: RoomMessage, now: number): Refusal {
  switch (message.kind) {
    case 'claimSeat':
      return room.claimSeat(member, message.player);
    case 'setSeat':
      return room.setSeat(member, message.player, message);
    case 'requestMap':
      return room.requestMap(member, now);
    case 'requestInitialSave':
      return room.requestInitialSave(member, now);
    case 'setCompatibility':
      return room.setCompatibility(member, message.compatibility);
    case 'setSettings':
      return room.setSettings(member, message.settings);
    case 'setReady':
      return room.setReady(member, message.ready);
    case 'start':
      return room.start(member, now);
    case 'loaded':
      return room.markLoaded(member, message, now);
    case 'saveOrders':
      return room.saveOrders(member, message);
    case 'finish':
      return room.finish(member, message);
    case 'ack':
      return room.ack(member, message.tick, message.digest, message.world, now);
    case 'command': {
      const bytes = Buffer.byteLength(JSON.stringify(message.envelope));
      if (bytes > MAX_ENVELOPE_BYTES) return `envelope of ${bytes} bytes over ${MAX_ENVELOPE_BYTES}`;
      return room.submit(member, message.envelope, message.fromTick);
    }
    case 'clock':
      return room.setClock(member, message.speed, message.paused);
    case 'kick':
      return room.kick(member, message.player, now);
    case 'blob':
      return room.blob(member, message, now);
    case 'chat':
      room.chat(member, message.text);
      return null;
    default:
      return assertNever(message);
  }
}

function assertNever(value: never): never {
  throw new Error(`unreachable: ${JSON.stringify(value)}`);
}
