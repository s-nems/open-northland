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

/** Whether the room still has this client after the link came back: ask for the held room on each
 *  welcome, and read the refusal. `alreadyInRoom` is the relay's own answer for a member it put back;
 *  the protocol reference says why a token the room removed meanwhile hears nothing else. */
export function rejoinProbe(client: {
  readonly room: { readonly id: string } | null;
  joinRoom(roomId: string): void;
}): RejoinProbe {
  let probing = false;
  return {
    observe(message) {
      if (message.kind === 'welcome') {
        const room = client.room;
        if (room === null) return 'passed';
        probing = true;
        client.joinRoom(room.id);
        return 'passed';
      }
      if (message.kind !== 'rejected' || message.of !== 'joinRoom' || !probing) return 'passed';
      probing = false;
      if (message.reason.code === 'alreadyInRoom') return 'consumed';
      return { kind: 'refused', text: rejoinRefusalText(message.reason) };
    },
  };
}

/** The refusal worded for the player left out: a game going on without it, or a room that is gone. */
function rejoinRefusalText(reason: RelayReason): string {
  const copy = messages().net;
  if (reason.code === 'gameStarted') return copy.removedWhileAway;
  if (reason.code === 'noRoom') return copy.roomGoneWhileAway;
  return relayReasonText(reason);
}
