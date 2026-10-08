import type { ServerMessage } from '@open-northland/net-protocol';
import { loadRoomMapDocuments } from '../content/transfer/index.js';
import { errorText } from '../diag/error-text.js';
import { formatMessage, messages } from '../i18n/index.js';
import { NetworkConnection } from '../net/connection.js';
import { takeNetworkHandover } from '../net/handover.js';
import { relayCloseText, relayFailureText, relayReasonText, worldFailureTitle } from '../net/relay-reason.js';
import { bindDisplayMode } from '../view/fullscreen.js';
import { releaseDocument, replaceEntryUrl } from '../view/navigation-guard.js';
import { mountMessage } from '../view/overlay.js';
import { lobbyCompatibilityReporter } from './relay/compatibility.js';
import { roomCreation } from './relay/creation.js';
import { devLobbyAction } from './relay/dev-lobby.js';
import { devRelayIdentity } from './relay/identity.js';
import { mountLobbyCard } from './relay/lobby-card.js';
import { mountReturnToMenuNotice } from './relay/menu-notice.js';
import { joinSearch, NEW_ROOM, nextPlayerNick, relayPlan, searchWithRoom } from './relay/plan.js';
import { roomExitObserver } from './relay/room-exit.js';

/**
 * The developer entry for a relayed game (`?relay=<ws url>&room=<id|new>`): it walks the lobby on its
 * own, then hands the connection to the network game, which boots the map the relay's descriptor
 * names. `room=new` creates a room for `?map=` and starts once `?players=` people sit ready; the URL
 * is then rewritten to the room's id, so a reload rejoins it.
 */
export async function renderRelayGame(canvas: HTMLCanvasElement, params: URLSearchParams): Promise<void> {
  const network = takeNetworkHandover();
  if (network !== null) {
    try {
      const { renderNetworkGame } = await import('./relay/network-game.js');
      renderNetworkGame(canvas, params, network);
    } catch (error) {
      network.connection.dispose();
      throw error;
    }
    return;
  }
  if (params.has('network')) {
    const { renderNetworkReload } = await import('./relay/network-reload.js');
    renderNetworkReload(canvas, params);
    return;
  }
  const scope = new AbortController();
  bindDisplayMode(params, undefined, scope.signal);
  const plan = relayPlan(params);
  if (plan === null) {
    mountMessage('relay', `?relay=<ws://host:port>&room=<id|${NEW_ROOM}>[&map=<id>&players=<n>]`);
    return;
  }
  const copy = messages().net;
  const relayCopy = messages().networkRelay;
  const identity = devRelayIdentity(plan.url, params.get('nick'));
  const card = mountLobbyCard();
  card.connecting(plan.url);
  const roomPlan = plan.room;
  const players = roomPlan.kind === 'create' ? roomPlan.players : null;
  const creation = roomPlan.kind === 'create' ? await roomCreation(params, roomPlan.mapId) : null;
  if (roomPlan.kind === 'create' && creation?.seats.length === 0) {
    card.dismiss();
    mountMessage(relayCopy.createRoomFailed, copy.roomNoSeats);
    return;
  }

  const connection = new NetworkConnection(plan.url, identity);
  const { client } = connection;
  let urlPinned = roomPlan.kind === 'join';
  // The walk hands off until the network game has subscribed, so a closing link or a failure in
  // between still ends the entry.
  let stage: 'walking' | 'handingOff' | 'ended' = 'walking';
  let requestedEntry = false;
  const compatibility = lobbyCompatibilityReporter(client, (error) => {
    card.note(formatMessage(copy.refused, { reason: String(error) }));
  });
  const observeExit = roomExitObserver((reason) =>
    halt(reason === null ? copy.roomEnded : `${copy.roomEnded}: ${relayReasonText(reason)}`, ''),
  );
  const unsubscribe = connection.subscribe((event) => {
    if (event.kind === 'failure') {
      const title = worldFailureTitle(event.what, event.error);
      const reason = relayFailureText(event.error);
      halt(title ?? formatMessage(copy.bootFailed, { reason }), title === null ? '' : reason);
    } else if (event.kind === 'message') {
      if (stage === 'walking') observe(event.message);
    } else if (event.state === 'closed') halt(relayCloseText(event.reason), '');
    // The developer walk asks for its room once; a dropped lobby link ends it instead of stalling.
    else if (event.state === 'reconnecting' && stage === 'walking') halt(copy.reconnecting, '');
  });

  /** The lobby walk is over: the game is about to take the connection, or the entry gives up. */
  function stopWalking(): boolean {
    if (stage !== 'walking') return false;
    stage = 'handingOff';
    compatibility.dispose();
    card.dismiss();
    scope.abort();
    return true;
  }

  function halt(title: string, detail: string): void {
    stopWalking();
    if (stage === 'ended') return;
    stage = 'ended';
    unsubscribe();
    connection.dispose();
    // Nothing runs behind the notice; leaving it asks nothing.
    releaseDocument();
    mountReturnToMenuNotice(title, detail);
  }

  function observe(message: ServerMessage): void {
    if (observeExit(message)) return;
    switch (message.kind) {
      case 'welcome':
        // A token the relay already knows is put back into its room by `hello` alone, its view
        // arriving right after; a request that crosses that is refused as "already in a room",
        // which `rejected` swallows.
        if (client.room !== null || requestedEntry) break;
        requestedEntry = true;
        if (creation !== null) client.createRoom(creation.settings, creation.seats);
        else if (roomPlan.kind === 'join') client.joinRoom(roomPlan.id);
        break;
      case 'room': {
        compatibility.observe(message.room);
        if (!urlPinned) {
          replaceEntryUrl(searchWithRoom(params, message.room.id));
          urlPinned = true;
        }
        const { room } = message;
        const invite =
          players !== null && room.state === 'lobby' && room.members.length < players
            ? joinSearch(
                params,
                room.id,
                nextPlayerNick(
                  room.members.map((member) => member.nick),
                  (number) => formatMessage(copy.invitedNick, { number }),
                ),
              )
            : null;
        card.room(room, players, invite);
        card.note(null);
        const action = devLobbyAction(message.room, client.nick, {
          players: players ?? Number.POSITIVE_INFINITY,
        });
        if (action?.kind === 'claimSeat') client.claimSeat(action.player);
        else if (action?.kind === 'setReady') client.setReady(true);
        else if (action?.kind === 'start') client.start();
        break;
      }
      case 'rejected': {
        const entering = message.of === 'joinRoom' || message.of === 'createRoom';
        if (entering && client.room !== null) break;
        // A refusal that ends the walk: the room could not be entered.
        if (entering)
          halt(
            message.of === 'joinRoom' ? relayCopy.joinRoomFailed : relayCopy.createRoomFailed,
            formatMessage(copy.refused, { reason: relayReasonText(message.reason) }),
          );
        // A lobby step the walk repeats on the next room view, such as a seat two joiners raced for.
        else card.note(formatMessage(copy.refused, { reason: relayReasonText(message.reason) }));
        break;
      }
      case 'kicked':
        if (message.player === client.session?.localSeat) halt(copy.youWereKicked, '');
        break;
      case 'start':
        void handOff();
        break;
      default:
        break;
    }
  }

  async function handOff(): Promise<void> {
    const room = client.room;
    if (!stopWalking()) return;
    try {
      // A saved room's start needs its initial save verified from bytes only the menu path holds.
      if (room?.settings.initialSave) throw new Error('the developer entry does not play saved rooms');
      const map = room === null ? null : await loadRoomMapDocuments(room);
      if (map === null) throw new Error('Missing or incompatible verified map');
      const { renderNetworkGame } = await import('./relay/network-game.js');
      if (stage !== 'handingOff') return;
      renderNetworkGame(canvas, params, { connection, map, initialSave: null });
      stage = 'ended';
      unsubscribe();
    } catch (error) {
      halt(relayCopy.openFailed, errorText(error));
    }
  }
}
