import type { RelayReason, ServerMessage } from '@open-northland/net-protocol';
import { messages } from '../../i18n/index.js';
import { relayReasonText } from '../../net/relay-reason.js';

/** A returning token's join request was refused: why the room is no longer this player's. */
export type RejoinRefusal = { readonly kind: 'refused'; readonly text: string };

/** What the probe made of a relay message: it consumed one meant for it, or it ends the game. */
export type RejoinOutcome = 'passed' | 'consumed' | RejoinRefusal;

export interface RejoinProbe {
  observe(message: ServerMessage): RejoinOutcome;
}

/**
 * Whether the room still has this client after the link came back. The relay welcomes a returning
 * token and, when the token still belongs to a running room, puts it back in on its own; a token the
 * room removed meanwhile, voted out while its connection was down, is welcomed without a room and
 * nothing more, so its world would wait for frames for good. The probe asks to join the room again:
 * a member put back is refused as already in it, and the refusal of anyone else says why the room is
 * no longer theirs.
 */
export function rejoinProbe(client: {
  readonly room: { readonly id: string } | null;
  joinRoom(roomId: string): void;
}): RejoinProbe {
  let probing: string | null = null;
  return {
    observe(message) {
      if (message.kind === 'welcome') {
        const room = client.room;
        if (room === null) return 'passed';
        probing = room.id;
        client.joinRoom(room.id);
        return 'passed';
      }
      if (message.kind !== 'rejected' || message.of !== 'joinRoom' || probing === null) return 'passed';
      probing = null;
      if (message.reason.code === 'alreadyInRoom') return 'consumed';
      return { kind: 'refused', text: rejoinRefusalText(message.reason) };
    },
  };
}

/** The room's refusal of a returning token's join, worded for the player left out: a running game
 *  it is no longer in, or a room that is gone. */
export function rejoinRefusalText(reason: RelayReason): string {
  const copy = messages().net;
  if (reason.code === 'gameStarted') return copy.removedWhileAway;
  if (reason.code === 'noRoom') return copy.roomGoneWhileAway;
  return relayReasonText(reason);
}
