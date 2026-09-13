import { compatibilityIssues } from '@open-northland/net-protocol';
import { loadLobbyCompatibility } from '../../content/lobby-identity.js';
import { loadRoomMapDocuments } from '../../content/transfer/index.js';
import { errorText } from '../../diag/error-text.js';
import { formatMessage, messages } from '../../i18n/index.js';
import { swapToEntry } from '../../launch.js';
import { NetworkConnection } from '../../net/connection.js';
import { BUTTON_STYLE, el, mountMessage } from '../../view/overlay.js';
import { menuSearch } from '../../view/params.js';
import { relayIdentity } from './identity.js';
import { renderNetworkGame } from './network-game.js';
import { ignoreReconnectRejection, wrongReconnectRoom } from './reload-message.js';

/** A document reload recreates the connection while the runtime still restores the relay snapshot. */
export function renderNetworkReload(canvas: HTMLCanvasElement, params: URLSearchParams): void {
  const url = params.get('relay');
  const roomId = params.get('room');
  if (url === null || roomId === null) throw new Error('Missing multiplayer reconnect address');
  const connection = new NetworkConnection(url, relayIdentity(url, params.get('nick')));
  let closed = false;
  let opening = false;
  let handedOff = false;
  const dispose = (detach = true) => {
    if (closed) return;
    closed = true;
    unsubscribe();
    if (!handedOff) {
      if (detach) connection.dispose();
      else connection.socket.close();
    }
  };
  const fail = (error: unknown, detach = true) => {
    if (closed) return;
    dispose(detach);
    const back = el('button', BUTTON_STYLE, messages().hud.returnToMenu);
    back.type = 'button';
    back.addEventListener('click', () => {
      void swapToEntry(menuSearch(), () => back.parentElement?.remove());
    });
    mountMessage(formatMessage(messages().net.bootFailed, { reason: errorText(error) }), '', [back]);
  };
  const unsubscribe = connection.subscribe((event) => {
    if (event.kind === 'link' && event.state === 'closed') {
      fail(event.reason ?? 'Connection closed');
      return;
    }
    if (event.kind === 'failure') {
      fail(event.error);
      return;
    }
    if (event.kind !== 'message') return;
    const message = event.message;
    if (wrongReconnectRoom(message, roomId)) {
      fail('Reconnect token belongs to another room', false);
      return;
    }
    if (ignoreReconnectRejection(message, roomId, connection.client.room?.id ?? null)) return;
    if (message.kind === 'welcome') connection.client.joinRoom(roomId);
    if (message.kind === 'left' || message.kind === 'error' || message.kind === 'rejected') {
      fail(message.kind === 'left' ? messages().net.roomEnded : message.reason);
      return;
    }
    if (message.kind !== 'start' || opening) return;
    opening = true;
    void (async () => {
      const room = connection.client.room;
      if (room === null) throw new Error('Missing reconnect room');
      const map = await loadRoomMapDocuments(room);
      if (closed) return;
      if (map === null) throw new Error(messages().network.missingMap);
      const report = await loadLobbyCompatibility(map.mapId, fetch, undefined, map);
      if (closed) return;
      const members = room.members.filter((member) => member.nick !== connection.client.nick);
      const issues = compatibilityIssues(
        [
          ...members,
          {
            nick: connection.client.nick,
            compatibility: { ...report, save: room.settings.initialSave?.fingerprint ?? null },
          },
        ],
        room.creator,
        room.settings.initialSave,
      );
      if (issues.length > 0) throw new Error('Reconnect content differs from the session');
      handedOff = true;
      dispose();
      try {
        renderNetworkGame(canvas, params, { connection, map, initialSave: null });
      } catch (error) {
        closed = false;
        handedOff = false;
        fail(error);
      }
    })().catch(fail);
  });
  window.addEventListener(
    'pagehide',
    () => {
      if (closed) return;
      closed = true;
      unsubscribe();
      connection.socket.close();
    },
    { once: true },
  );
}
