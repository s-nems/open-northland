import { base64ToBytes, RelayClient, RelaySocket, type WorldPort } from '@open-northland/net-client';
import { DESCRIPTOR_WORLD, type ServerMessage, TICK_MS } from '@open-northland/net-protocol';
import { loadRoomMapDocuments } from '../content/transfer/index.js';
import { errorText } from '../diag/error-text.js';
import { currentDiagGameSession, diag, setDiagGameSession } from '../diag/index.js';
import { formatMessage, messages } from '../i18n/index.js';
import { takeNetworkHandover } from '../net/handover.js';
import { networkSaveSession } from '../net/save-session.js';
import { bindDisplayMode } from '../view/fullscreen.js';
import { BUTTON_STYLE, el, mountMessage } from '../view/overlay.js';
import type { GameViewHandle } from '../view/runtime/game-view.js';
import type { NetReadout } from '../view/runtime/net-readout.js';
import { takeStagedSave } from '../view/runtime/save-load/index.js';
import { storePendingLoad } from '../view/runtime/save-load/pending-store.js';
import { haltOnFailedRestore } from '../view/runtime/world-bootstrap.js';
import { type AssembledMapWorld, assembleMapWorld, presentMapWorld } from './map/boot.js';
import { lobbyCompatibilityReporter } from './relay/compatibility.js';
import { roomCreation } from './relay/creation.js';
import { devRelayExit } from './relay/dev-exit.js';
import { devLobbyAction } from './relay/dev-lobby.js';
import { relayIdentity } from './relay/identity.js';
import { mountLobbyCard } from './relay/lobby-card.js';
import { mountNetHud, type NetHud } from './relay/net-hud.js';
import { NEW_ROOM, relayPlan, searchWithRoom } from './relay/plan.js';
import { roomExitObserver } from './relay/room-exit.js';

/**
 * The developer entry for a relayed game (`?relay=<ws url>&room=<id|new>`): it walks the lobby on its
 * own, boots the map the relay's descriptor names, runs it through the relay client, and mounts the
 * network overlays. `room=new` creates a room for `?map=` and starts once `?players=` people sit
 * ready; the URL is then rewritten to the room's id, so a reload rejoins it.
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
  const identity = relayIdentity(plan.url, params.get('nick'));
  const card = mountLobbyCard();
  card.connecting(plan.url);
  const roomPlan = plan.room;
  const players = roomPlan.kind === 'create' ? roomPlan.players : null;
  const creation = roomPlan.kind === 'create' ? await roomCreation(params, roomPlan.mapId) : null;
  if (roomPlan.kind === 'create' && creation?.seats.length === 0) {
    card.dismiss();
    mountMessage(roomPlan.mapId, copy.roomNoSeats);
    return;
  }

  let world: AssembledMapWorld | null = null;
  let view: GameViewHandle | null = null;
  let hud: NetHud | null = null;
  let urlPinned = roomPlan.kind === 'join';
  let lastDesync: Extract<ServerMessage, { kind: 'desync' }> | null = null;
  let out = false;
  let requestedEntry = false;
  let presentation: Promise<void> = Promise.resolve();

  const readout = (): NetReadout => ({
    connected: socket.connected,
    roundTripMs: client.roundTripMs,
    delayTicks: client.delayTicks,
    delayMs: client.delayTicks === null ? null : (client.delayTicks * TICK_MS) / client.speed,
    clickToApplyMs: client.latency.clickToApplyMs,
    bufferedTicks: client.bufferedTicks,
  });

  const observeExit = roomExitObserver((reason) =>
    leave(reason === null ? copy.roomEnded : `${copy.roomEnded}: ${reason}`),
  );

  const port: WorldPort = {
    async open(session, snapshotTick) {
      if (out) return null;
      if (session.world.kind !== 'map')
        throw new Error(`a relayed game plays a map, not a ${session.world.kind}`);
      // A saved start needs the initial save verified from its bytes, which only the menu path holds;
      // reloading into the staged snapshot here would ask for it again on every boot.
      if (session.initialSave !== undefined) throw new Error('the developer entry does not play saved rooms');
      const mapId = session.world.mapId;
      // A staged snapshot is what a resync relaunch left for this boot; otherwise a room already past
      // its start is asked for its cached snapshot.
      let staged: Awaited<ReturnType<typeof takeStagedSave>>;
      try {
        staged = await takeStagedSave(mapId);
      } catch (err) {
        haltOnFailedRestore(err);
        throw err;
      }
      if (out || (staged === null && snapshotTick !== null)) return null;
      const verifiedMap = client.room === null ? null : await loadRoomMapDocuments(client.room);
      if (out) return null;
      if (verifiedMap === null) throw new Error('Missing or incompatible verified map');
      card.dismiss();
      const assembled = await assembleMapWorld(canvas, params, {
        multiplayer: true,
        mapId,
        stagedSave: staged,
        verifiedMap,
        sessionFor: () => session,
      });
      if (out) {
        assembled?.app.destroy(false, { children: true });
        return null;
      }
      if (assembled === null) throw new Error('the map boot halted');
      // The fallback strip takes its owner from the local seat, which two clients would do differently.
      if (assembled.loaded === null) throw new Error(`no decoded map ${mapId}`);
      world = assembled;
      return { sim: assembled.sim, generation: staged === null ? DESCRIPTOR_WORLD : assembled.sim.tick };
    },
    async restore(_session, snapshot) {
      // The world is rebuilt by a fresh boot over the staged snapshot, the way a loaded save is: the
      // page reloads into this same entry and rejoins on its stored token.
      await storePendingLoad(base64ToBytes(snapshot));
      window.location.reload();
      return null;
    },
  };

  const client = new RelayClient({
    token: identity.token,
    nick: identity.nick,
    world: port,
    onMessage: observe,
    onWorld: () => {
      presentation = present().catch((error: unknown) => {
        diag.warn('net', 'presentation failed', { error: errorText(error) });
        leave(formatMessage(copy.bootFailed, { reason: errorText(error) }));
      });
    },
    onDropped: (tick, reason) => diag.warn('net', `dropped an envelope for tick ${tick}: ${reason}`),
    onError: (what, error) => {
      diag.warn('net', `${what} failed`, { error: errorText(error) });
      if (what === 'open' || what === 'restore') {
        card.dismiss();
        mountMessage(what, formatMessage(copy.bootFailed, { reason: errorText(error) }));
      } else if (what === 'result') {
        leave(formatMessage(copy.bootFailed, { reason: errorText(error) }));
      }
    },
    connected: () => socket.connected,
  });
  const socket = new RelaySocket({
    url: plan.url,
    onOpen: () => {
      hud?.link('ok');
      client.hello();
    },
    onMessage: (raw) => {
      try {
        client.receive(raw);
      } catch (err) {
        diag.warn('net', 'refused a relay message', { error: errorText(err) });
      }
    },
    onClosed: (reason) => {
      if (out) return;
      // With no HUD to carry the notice, the lobby card gives way to it and a way back.
      if (hud === null) {
        card.dismiss();
        leave(formatMessage(copy.closed, { reason }));
      } else hud.link('closed', reason);
    },
    onRetry: () => hud?.link('reconnecting'),
  });
  const compatibility = lobbyCompatibilityReporter(client, (error) => {
    card.note(formatMessage(copy.refused, { reason: String(error) }));
  });
  client.attach((message) => {
    socket.send(message);
  });

  const exit = devRelayExit({
    canvas,
    client,
    socket,
    world: () => world,
    presentation: () => presentation,
    cleanup() {
      out = true;
      scope.abort();
      compatibility.dispose();
      card.dismiss();
      view?.destroy();
      hud?.dispose();
      hud = null;
    },
    onFailure: (error) => leave(formatMessage(copy.bootFailed, { reason: errorText(error) })),
  });

  function observe(message: ServerMessage): void {
    if (out) return;
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
          window.history.replaceState(null, '', searchWithRoom(params, message.room.id));
          urlPinned = true;
        }
        if (world === null) {
          card.room(message.room, players);
          card.note(null);
        }
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
        if (entering && client.room !== null) return;
        // A refusal that ends the boot: the room could not be entered, or the world was not taken.
        if (entering || message.of === 'loaded') {
          card.dismiss();
          mountMessage(message.of, formatMessage(copy.refused, { reason: message.reason }));
          return;
        }
        // A lobby step the walk repeats on the next room view, such as a seat two joiners raced for.
        if (world === null) {
          card.note(formatMessage(copy.refused, { reason: message.reason }));
          return;
        }
        break;
      }
      case 'kicked':
        if (message.player === client.session?.localSeat) leave(copy.youWereKicked);
        break;
      case 'desync':
        lastDesync = message;
        break;
      default:
        break;
    }
    hud?.observe(message);
  }

  async function present(): Promise<void> {
    if (out || world === null) return;
    const presented = await presentMapWorld(world, {
      driver: client,
      sharedClock: true,
      confirmedMatchEnd: () => client.endedTick,
      onReturnToMenu: () => exit.quit(),
      introAtStart: false,
      netReadout: readout,
      networkSave: networkSaveSession(client, world.sim),
    });
    if (out) {
      presented.destroy();
      return;
    }
    view = presented;
    hud = mountNetHud({ client, view, readout });
    if (!socket.connected) hud.link('reconnecting');
    const diagSession = currentDiagGameSession();
    if (diagSession !== null) {
      setDiagGameSession({
        ...diagSession,
        net: () => ({
          desync:
            lastDesync === null
              ? null
              : { tick: lastDesync.tick, domains: lastDesync.domains, reference: lastDesync.reference },
          digests: client.digests.list(),
          delayTicks: client.delayTicks,
          roundTripMs: client.roundTripMs,
        }),
      });
    }
  }

  function leave(reason: string): void {
    if (out) return;
    exit.dispose();
    const back = el('button', BUTTON_STYLE, messages().hud.returnToMenu);
    back.type = 'button';
    back.addEventListener('click', () => {
      back.parentElement?.remove();
      exit.quit();
    });
    mountMessage(reason, '', [back]);
  }
}
