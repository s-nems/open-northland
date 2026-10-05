import type { RelayReason, RoomView, ServerMessage } from '@open-northland/net-protocol';

/** What the probe made of a relay message: it consumed one meant for it, or the room refused the
 *  client its seat back. */
export type RejoinOutcome = 'passed' | 'consumed' | { readonly refused: RelayReason };

/**
 * Whether a started room still has this client after the link came back: ask for the held room on
 * each welcome and read the refusal. `alreadyInRoom` is the relay's answer for a member it put back, or
 * to a join sent beside the relay's own restoration, and never news; the protocol reference says why a
 * token the room removed meanwhile hears nothing else.
 */
export function rejoinProbe(client: {
  readonly room: Pick<RoomView, 'id' | 'state'> | null;
  joinRoom(roomId: string): void;
}): (message: ServerMessage) => RejoinOutcome {
  let probing = false;
  return (message) => {
    if (message.kind === 'welcome') {
      const room = client.room;
      if (room === null || room.state === 'lobby') return 'passed';
      probing = true;
      client.joinRoom(room.id);
      return 'passed';
    }
    if (message.kind !== 'rejected' || message.of !== 'joinRoom') return 'passed';
    if (message.reason.code === 'alreadyInRoom') {
      probing = false;
      return client.room === null ? 'passed' : 'consumed';
    }
    if (!probing) return 'passed';
    probing = false;
    return { refused: message.reason };
  };
}
