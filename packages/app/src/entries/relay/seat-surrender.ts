import { closingCode } from '@open-northland/net-protocol';
import { type ConnectionEvent, NetworkConnection } from '../../net/connection.js';
import { reloadDocument } from '../../view/platform/navigation-guard.js';

/** How long giving a seat up waits for the relay before the menu opens anyway; the seat then stays held
 *  and the room can still vote it out. */
export const SURRENDER_TIMEOUT_MS = 5000;

type Identity = NetworkConnection['identity'];

/** The part of a connection giving a seat up uses. */
export interface SurrenderConnection {
  readonly client: { joinRoom(roomId: string, password?: string): void };
  subscribe(listener: (event: ConnectionEvent) => void): () => void;
  dispose(leave: boolean): void;
}

/** What a halted game whose seat the relay keeps offers besides the menu. */
export interface KeptSeat {
  /** Reloads the page, whose new connection is put back into the seat the relay kept. */
  readonly retry: () => void;
  /** Gives the seat up; settles once the leave went out or the relay could not be reached. */
  readonly leave: () => Promise<void>;
}

/** Whether a link the relay closed for good may leave a seat to come back to: not when another
 *  connection took this token over, nor when the relay shut down with its rooms. */
export function closeKeepsSeat(reason: string | undefined): boolean {
  const code = reason === undefined ? null : closingCode(reason);
  return code !== 'replaced' && code !== 'serverRestart';
}

export function keptSeat(url: string, identity: Identity, roomId: string): KeptSeat {
  return {
    retry: reloadDocument,
    leave: () => surrenderSeat(url, identity, roomId),
  };
}

/**
 * Give up the seat a halted game left held: a new connection on the same token is put back into the
 * started room, and leaving it from there is the explicit departure the relay hands to the AI at once
 * (or that ends a room whose clock never ran).
 */
export function surrenderSeat(
  url: string,
  identity: Identity,
  roomId: string,
  open: (url: string, identity: Identity) => SurrenderConnection = (at, as) => new NetworkConnection(at, as),
): Promise<void> {
  return new Promise((resolve) => {
    const connection = open(url, identity);
    let settled = false;
    const finish = (leave: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      connection.dispose(leave);
      resolve();
    };
    const timer = setTimeout(() => finish(false), SURRENDER_TIMEOUT_MS);
    const unsubscribe = connection.subscribe((event) => {
      if (event.kind === 'failure') finish(false);
      else if (event.kind === 'link') {
        if (event.state === 'closed') finish(false);
      } else {
        const { message } = event;
        if (message.kind === 'welcome') connection.client.joinRoom(roomId);
        else if (message.kind === 'room') finish(message.room.id === roomId);
        // `alreadyInRoom` answers the join beside the relay's own restoration; the room view follows.
        else if (message.kind === 'rejected' && message.of === 'joinRoom') {
          if (message.reason.code !== 'alreadyInRoom') finish(false);
        } else if (message.kind === 'left' || message.kind === 'error') finish(false);
      }
    });
  });
}
