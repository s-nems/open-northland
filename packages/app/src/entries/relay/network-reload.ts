import { compatibilityIssues, type ServerMessage } from '@open-northland/net-protocol';
import { loadLobbyCompatibility } from '../../content/lobby-identity.js';
import { loadRoomMapDocuments } from '../../content/transfer/index.js';
import { messages } from '../../i18n/index.js';
import { NetworkConnection } from '../../net/connection.js';
import { relayMapRequest } from '../../net/map-request.js';
import {
  ownDepartureText,
  relayCloseText,
  relayFailureText,
  relayReasonText,
} from '../../net/relay-reason.js';
import { dismissBootProgress, mountBootProgress } from '../../view/boot/progress.js';
import { releaseDocument } from '../../view/platform/navigation-guard.js';
import { readStoredSettings } from '../../view/settings/store.js';
import { compatibilityIssuesText } from './compatibility.js';
import { relayIdentity } from './identity.js';
import { keptView } from './kept-view.js';
import { mountHaltNotice } from './menu-notice.js';
import { renderNetworkGame } from './network-game.js';
import { wrongReconnectRoom } from './reload-message.js';
import { roomEndText, roomExitObserver } from './room-exit.js';
import { closeKeepsSeat, keptSeat } from './seat-surrender.js';

/** A document reload recreates the connection while the runtime still restores the relay snapshot. */
export function renderNetworkReload(canvas: HTMLCanvasElement, params: URLSearchParams): void {
  const url = params.get('relay');
  const roomId = params.get('room');
  if (url === null || roomId === null) throw new Error('Missing multiplayer reconnect address');
  const connection = new NetworkConnection(url, relayIdentity(url, params.get('nick')));
  let closed = false;
  let opening = false;
  let handedOff = false;
  const mapRequest = relayMapRequest(connection.client);
  // Nothing here gives the seat up: the halt notice's Leave is the player's own way to.
  const dispose = () => {
    if (closed) return;
    closed = true;
    unsubscribe();
    mapRequest.cancel();
    if (!handedOff) connection.dispose(false);
  };
  /** `seatKept` says the relay may still hold this client's seat, which the notice then offers back. */
  const fail = (error: unknown, seatKept = true) => {
    if (closed) return;
    dispose();
    dismissBootProgress();
    // Nothing is running any more; closing the tab on the notice loses nothing.
    releaseDocument();
    mountHaltNotice(messages().networkRelay.openFailed, relayFailureText(error), {
      onCard: false,
      seat: seatKept ? keptSeat(url, connection.identity, roomId) : null,
      view: keptView(url, roomId),
    });
  };
  // An `error` says why the relay ends the room or the link; the `left` or the close after it decides.
  const exit = roomExitObserver((reason) => fail(roomEndText(reason), false));
  const unsubscribe = connection.subscribe((event) => {
    if (event.kind === 'link' && event.state === 'closed') {
      fail(relayCloseText(event), closeKeepsSeat(event.reason));
      return;
    }
    if (event.kind === 'failure') {
      // A refused rejoin lost the room, so no seat is left to offer back.
      fail(event.error, event.what !== 'room');
      return;
    }
    if (event.kind !== 'message') return;
    const message = event.message;
    if (wrongReconnectRoom(message, roomId)) {
      fail(messages().networkRelay.reconnectOtherRoom, false);
      return;
    }
    if (exit(message)) return;
    // A refused map request reaches the load as its error, and the room still holds the seat.
    if (mapRequest.observe(message)) return;
    if (message.kind === 'welcome') {
      // The refusal as the player chose it now: the room record takes it beside the fresh hello.
      connection.client.joinRoom(roomId, undefined, readStoredSettings().replayOptOut === true);
      mapRequest.relinked();
    }
    // The room took the seat while this tab was away or loading; the `left` follows. A farewell
    // reaches a tab that holds no room yet, and it may name a nick the room made unique.
    if (message.kind === 'kicked' && ownKick(message, connection.client)) {
      fail(ownDepartureText(message), false);
      return;
    }
    if (message.kind === 'rejected') {
      fail(relayReasonText(message.reason), false);
      return;
    }
    if (message.kind !== 'start' || opening) return;
    opening = true;
    void (async () => {
      const room = connection.client.room;
      if (room === null) throw new Error('Missing reconnect room');
      // The verify blocks the page; the world's boot then mounts its own steps over this card.
      await mountBootProgress(['verify']).begin('verify');
      if (closed) return;
      const map = await loadRoomMapDocuments(room, { delivered: mapRequest.request });
      if (closed) return;
      if (map === null) throw new Error(messages().network.mapLostOnReturn);
      const report = await loadLobbyCompatibility(map.mapId, undefined, undefined, map);
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
      if (issues.length > 0) throw new Error(compatibilityIssuesText(issues));
      handedOff = true;
      dispose();
      try {
        renderNetworkGame(canvas, params, { connection, map, initialSave: null });
      } catch (error) {
        closed = false;
        handedOff = false;
        fail(error);
      }
    })().catch((error: unknown) => fail(error));
  });
  window.addEventListener(
    'pagehide',
    () => {
      if (closed) return;
      closed = true;
      unsubscribe();
      connection.dispose(false);
    },
    { once: true },
  );
}

function ownKick(
  kicked: Extract<ServerMessage, { kind: 'kicked' }>,
  client: NetworkConnection['client'],
): boolean {
  return client.room === null || kicked.player === client.session?.localSeat;
}
