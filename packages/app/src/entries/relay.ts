import { base64ToBytes, RelayClient, RelaySocket, type WorldPort } from '@open-northland/net-client';
import {
  DESCRIPTOR_WORLD,
  MAX_ROOM_NAME_LENGTH,
  type RoomSeatSetup,
  type RoomSettings,
  type ServerMessage,
  TICK_MS,
} from '@open-northland/net-protocol';
import { loadMapScript } from '../content/map-loader.js';
import { currentDiagGameSession, diag, setDiagGameSession } from '../diag/index.js';
import { sessionRuleOverrides } from '../game/session-rules.js';
import { DEFAULT_SESSION_SEED, DEFAULT_SESSION_SPEED } from '../game/session-url.js';
import { formatMessage, messages } from '../i18n/index.js';
import { bindDisplayMode } from '../view/fullscreen.js';
import { BUTTON_STYLE, el, mountMessage } from '../view/overlay.js';
import { floatParam, intParam, menuSearch } from '../view/params.js';
import type { GameViewHandle } from '../view/runtime/game-view.js';
import type { NetReadout } from '../view/runtime/net-readout.js';
import { takeStagedSave } from '../view/runtime/save-load/index.js';
import { storePendingLoad } from '../view/runtime/save-load/pending-store.js';
import { haltOnFailedRestore } from '../view/runtime/world-bootstrap.js';
import { type AssembledMapWorld, assembleMapWorld, presentMapWorld } from './map/boot.js';
import { devLobbyAction } from './relay/dev-lobby.js';
import { relayIdentity } from './relay/identity.js';
import { mountLobbyCard } from './relay/lobby-card.js';
import { mountNetHud, type NetHud } from './relay/net-hud.js';
import { NEW_ROOM, relayPlan, searchWithRoom } from './relay/plan.js';

/**
 * The developer entry for a relayed game (`?relay=<ws url>&room=<id|new>`): it walks the lobby on its
 * own, boots the map the relay's descriptor names, runs it through the relay client, and mounts the
 * network overlays. `room=new` creates a room for `?map=` and starts once `?players=` people sit
 * ready; the URL is then rewritten to the room's id, so a reload rejoins it.
 */
export async function renderRelayGame(canvas: HTMLCanvasElement, params: URLSearchParams): Promise<void> {
  bindDisplayMode(params);
  const plan = relayPlan(params);
  if (plan === null) {
    mountMessage('relay', `?relay=<ws://host:port>&room=<id|${NEW_ROOM}>[&map=<id>&players=<n>]`);
    return;
  }
  const copy = messages().net;
  const identity = relayIdentity(params);
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

  const readout = (): NetReadout => ({
    connected: socket.connected,
    roundTripMs: client.roundTripMs,
    delayTicks: client.delayTicks,
    delayMs: client.delayTicks === null ? null : (client.delayTicks * TICK_MS) / client.speed,
    clickToApplyMs: client.latency.clickToApplyMs,
    bufferedTicks: client.bufferedTicks,
  });

  const port: WorldPort = {
    async open(session, snapshotTick) {
      if (session.world.kind !== 'map')
        throw new Error(`a relayed game plays a map, not a ${session.world.kind}`);
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
      if (staged === null && snapshotTick !== null) return null;
      card.dismiss();
      const assembled = await assembleMapWorld(canvas, params, {
        mapId,
        stagedSave: staged,
        sessionFor: () => session,
      });
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
      void present();
    },
    onDropped: (tick, reason) => diag.warn('net', `dropped an envelope for tick ${tick}: ${reason}`),
    onError: (what, error) => {
      diag.warn('net', `${what} failed`, { error: String(error) });
      if (what === 'open' || what === 'restore') {
        card.dismiss();
        mountMessage(what, formatMessage(copy.bootFailed, { reason: String(error) }));
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
        diag.warn('net', 'refused a relay message', { error: String(err) });
      }
    },
    onClosed: (reason) => {
      if (!out) hud?.link('closed', reason);
    },
    onRetry: () => hud?.link('reconnecting'),
  });
  client.attach((message) => {
    socket.send(message);
  });

  function observe(message: ServerMessage): void {
    switch (message.kind) {
      case 'welcome':
        // A token the relay already knows is put back into its room by `hello` alone, its view
        // arriving right after; a request that crosses that is refused as "already in a room",
        // which `rejected` swallows.
        if (client.room !== null) break;
        if (creation !== null) client.createRoom(creation.settings, creation.seats);
        else if (roomPlan.kind === 'join') client.joinRoom(roomPlan.id);
        break;
      case 'room': {
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
    if (world === null) return;
    view = await presentMapWorld(world, {
      driver: client,
      sharedClock: true,
      introAtStart: false,
      netReadout: readout,
    });
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
    out = true;
    socket.close();
    hud?.dispose();
    hud = null;
    const back = el('button', BUTTON_STYLE, messages().hud.returnToMenu);
    back.type = 'button';
    back.addEventListener('click', () => {
      view?.destroy();
      window.location.search = menuSearch();
    });
    mountMessage(reason, '', [back]);
  }
}

interface RoomCreation {
  readonly settings: RoomSettings;
  readonly seats: readonly RoomSeatSetup[];
}

/** The room a creator opens for a map: its script's roster, with the authored AI seats kept as AI and
 *  every other seat open, and the search's seed, rules and tempo. */
async function roomCreation(params: URLSearchParams, mapId: string): Promise<RoomCreation> {
  const script = await loadMapScript(mapId);
  return {
    settings: {
      name: mapId.slice(0, MAX_ROOM_NAME_LENGTH),
      world: { kind: 'map', mapId },
      seed: intParam(params, 'seed', DEFAULT_SESSION_SEED),
      rules: sessionRuleOverrides(params),
      speed: floatParam(params, 'speed', DEFAULT_SESSION_SPEED),
    },
    seats: (script?.players ?? []).map((slot) => ({
      player: slot.player,
      mode: slot.type === 'ai' ? 'ai' : 'idle',
      color: slot.colorId,
    })),
  };
}
