import type { MapText } from '@open-northland/data';
import { MAX_NICK_LENGTH, type RoomView } from '@open-northland/net-protocol';
import { apiBaseUrl, loadMapSources } from '../../../content/map-source/index.js';
import type { MapVerifyNotice } from '../../../content/transfer/index.js';
import { formatMessage, messages } from '../../../i18n/index.js';
import type { LaunchEntry } from '../../../launch.js';
import { type ConnectionEvent, NetworkConnection } from '../../../net/connection.js';
import { type RelayMapRequest, relayMapRequest } from '../../../net/map-request.js';
import { relayCloseText, relayFailureText, relayReasonText } from '../../../net/relay-reason.js';
import { nextPaint } from '../../../view/next-paint.js';
import { relayIdentity, rememberFlag } from '../../relay/identity.js';
import { node } from '../dom.js';
import { type MapSelectItem, mapSourceItem } from '../map-select/model.js';
import type { MenuScreen } from '../model.js';
import type { MenuSound } from '../music.js';
import { screenHead } from '../screen-head.js';
import { roomAssets } from './assets.js';
import { connectionForm } from './connection-form.js';
import { createPanel } from './create.js';
import { prepareRoomCreation } from './creation.js';
import { networkHall } from './hall/index.js';
import { escapeLeavesRoom, relayAddress, validNetworkNick, worldTitle } from './model.js';
import { mountNetworkRoom } from './room/index.js';
import { pingRelay, type RelayPing } from './server/ping.js';
import { launchNetworkGame } from './start.js';

export interface NetworkScreenServices {
  readonly connect: (url: string, nick: string) => NetworkConnection;
  readonly assets: typeof roomAssets;
  readonly startGame: typeof launchNetworkGame;
  readonly ping: RelayPing;
}

const SERVICES: NetworkScreenServices = {
  connect: (url, nick) => new NetworkConnection(url, relayIdentity(url, nick)),
  assets: roomAssets,
  startGame: launchNetworkGame,
  ping: pingRelay,
};

export function networkScreen(
  open: (screen: MenuScreen) => void,
  launch: LaunchEntry,
  params: URLSearchParams,
  sound: MenuSound,
  services: NetworkScreenServices = SERVICES,
) {
  const copy = messages().network;
  const element = node('section', 'main-menu__screen network-menu');
  const browser = node('div', 'network-menu__browser');
  const status = node('p', 'network-menu__notice');
  status.setAttribute('role', 'status');
  const roomHost = node('div');
  const {
    form,
    account,
    accountName,
    address,
    nick,
    flag,
    advanced,
    connect,
    disconnect,
    rememberAddress,
    lockServer,
    dispose: disposeForm,
  } = connectionForm(params.get('relay'), () => dropConnection(''), services.ping);
  const columns = node('div', 'network-menu__columns');
  let connection: NetworkConnection | null = null;
  let assets: ReturnType<typeof roomAssets> | null = null;
  /** Asks the relay for a started room's map this browser no longer has. */
  let mapRequest: RelayMapRequest | null = null;
  let room: ReturnType<typeof mountNetworkRoom> | null = null;
  let unsubscribe: () => void = () => undefined;
  let disposed = false;
  let handedOff = false;
  let busy = false;
  let generation = 0;
  let enteredStartedRoom = false;
  /** What the next `left` says instead of `copy.left`: the relay explains a removal just before it. */
  let leftNotice: string | null = null;

  /** Map names for the room header; a room shown before the listing answers names its map by id. */
  let mapNames: ReadonlyMap<string, MapText | undefined> = new Map();
  let mapPreviews: ReadonlyMap<string, MapSelectItem> = new Map();
  const loadMapNames = (): void => {
    const api = apiBaseUrl();
    void loadMapSources().then((sources) => {
      mapNames = new Map(sources.map((source) => [source.entry.id, source.entry.name]));
      mapPreviews = new Map(sources.map((source) => [source.entry.id, mapSourceItem(source, api)]));
      const current = connection;
      if (disposed) return;
      hall.showRooms();
      if (room !== null && current?.client.room) room.update(current.client.room, current.connected);
    });
  };
  loadMapNames();

  const notice = (text: string): void => {
    status.textContent = text;
    room?.notice(text);
    status.hidden = room !== null;
  };
  const failure = (error: unknown): void =>
    notice(formatMessage(copy.failed, { reason: relayFailureText(error) }));
  const verifyNotice: MapVerifyNotice = {
    async show() {
      notice(copy.verifyingMap);
      await nextPaint();
    },
    hide() {
      if (status.textContent === copy.verifyingMap) notice('');
    },
  };
  const resetRoom = (): void => {
    room?.dispose();
    room = null;
    enteredStartedRoom = false;
    roomHost.replaceChildren();
    browser.hidden = false;
    head.hidden = false;
  };
  /** Ends this screen's connection and room, leaving `text` as the notice; Connect works again. */
  const dropConnection = (text: string): void => {
    generation++;
    busy = false;
    mapRequest?.cancel();
    mapRequest = null;
    unsubscribe();
    assets?.dispose();
    assets = null;
    connection?.dispose();
    connection = null;
    create.resetMapList();
    hall.closePassword();
    leftNotice = null;
    resetRoom();
    notice(text);
    sync();
    nick.focus();
  };
  const hall = networkHall({
    client: () => connection?.client ?? null,
    worldTitle: (world) => worldTitle(world, mapNames),
    join(roomId, password) {
      const current = connection;
      if (current === null || !current.connected || busy) return;
      busy = true;
      sync();
      current.client.joinRoom(roomId, password);
    },
  });
  const head = screenHead('multiplayer', open);
  const create = createPanel({
    async create(choice) {
      const current = connection;
      const mine = generation;
      if (current === null || !current.connected || !current.client.welcomed || busy) return;
      busy = true;
      sync();
      try {
        const creation = await prepareRoomCreation(choice, params);
        if (disposed || mine !== generation || connection !== current || !current.connected) return;
        assets?.prepare(creation.initial, creation.handle);
        current.client.createRoom(creation.settings, creation.seats, choice.password);
      } finally {
        busy = false;
        sync();
      }
    },
    showMapList(on) {
      head.hidden = on;
      status.hidden = on;
      browser.hidden = on;
    },
  });
  columns.append(hall.rooms, create.card, hall.chat, hall.players);
  browser.append(form, account, columns);
  element.append(head, status, browser, create.mapList, roomHost);

  function sync(): void {
    const connected = connection?.connected === true && connection.client.welcomed;
    if (room !== null) status.hidden = true;
    else {
      status.hidden = false;
      if (connected) element.insertBefore(status, browser);
      else form.insertBefore(status, connect);
    }
    form.hidden = connected;
    account.hidden = !connected;
    columns.hidden = !connected;
    element.classList.toggle('is-entry', !connected && room === null);
    accountName.textContent = formatMessage(copy.connected, { nick: connection?.client.nick ?? nick.value });
    lockServer(connection !== null);
    nick.disabled = connection !== null;
    flag.setDisabled(connection !== null);
    connect.disabled = connection !== null;
    connect.textContent = connection === null ? copy.connect : copy.connecting;
    if (!connected && connection !== null) form.append(disconnect);
    else account.append(disconnect);
    disconnect.hidden = connection === null;
    create.enable(connected && !busy);
    hall.enable(connected && !busy);
  }

  function leaveRoom(): void {
    generation++;
    mapRequest?.cancel();
    if (connection?.connected) connection.client.leaveRoom();
    else {
      mapRequest = null;
      unsubscribe();
      assets?.dispose();
      assets = null;
      connection?.dispose();
      connection = null;
      resetRoom();
      notice(copy.left);
      sync();
    }
  }

  function launchGame(): void {
    const current = connection;
    const request = mapRequest;
    if (current === null || assets === null || request === null || busy) return;
    const mine = generation;
    busy = true;
    notice(copy.starting);
    const failed = (error: unknown): void => {
      if (disposed || generation !== mine) return;
      failure(error);
      // A seat in a started game is given up only on purpose: the room stays up with the notice.
      if (enteredStartedRoom) busy = false;
      else leaveRoom();
    };
    void services
      .startGame(
        current,
        assets,
        (search) => {
          handedOff = true;
          launch(search);
        },
        () => !disposed && generation === mine && connection === current,
        // The game's module never loaded: this screen holds the connection again and hears the room.
        // Leaving now would end every player's start, since the clock has not run; the room stays
        // up as a started one instead, to try again from or to leave on purpose.
        (error) => {
          handedOff = false;
          enteredStartedRoom = true;
          const view = current.client.room;
          if (view !== null) showRoom(current, view);
          failed(error);
        },
        request.request,
      )
      .catch(failed);
  }

  /** Mounts the room screen afresh, a started room's with its way back into the game. */
  function showRoom(current: NetworkConnection, view: RoomView): void {
    room?.dispose();
    hall.closePassword();
    leftNotice = null;
    const shown = mountNetworkRoom({
      client: current.client,
      copy: messages().networkRoom,
      savedRoster: () => assets?.savedRoster() ?? null,
      mapSlots: () => assets?.mapSlots() ?? null,
      mapPreview: (world) => (world.kind === 'map' ? (mapPreviews.get(world.mapId) ?? null) : null),
      onLeave: leaveRoom,
      rejoin: enteredStartedRoom ? launchGame : null,
      onRetryCompatibility: () => assets?.retry(),
      worldTitle: (world) => worldTitle(world, mapNames),
    });
    room = shown;
    roomHost.replaceChildren(shown.element);
    shown.element.tabIndex = -1;
    shown.element.focus();
    shown.showChat(current.client.chat);
    browser.hidden = true;
    head.hidden = true;
    status.textContent = '';
    shown.update(view, current.connected);
    assets?.observe(view);
    sync();
  }

  function observe(event: ConnectionEvent): void {
    const current = connection;
    if (disposed || handedOff || current === null) return;
    if (event.kind === 'failure') {
      failure(event.error);
      return;
    }
    if (event.kind === 'link') {
      if (event.state === 'reconnecting') {
        generation++;
        busy = false;
        mapRequest?.cancel();
        notice(copy.reconnecting);
      } else if (event.state === 'closed') {
        // A link that will not reopen leaves nothing to wait for, a restarted relay no room to show.
        dropConnection(relayCloseText(event.reason));
        return;
      }
      room && current.client.room && room.update(current.client.room, current.connected);
      sync();
      return;
    }
    const message = event.message;
    assets?.observeMessage(message);
    if (mapRequest?.observe(message)) return;
    switch (message.kind) {
      case 'welcome':
        notice('');
        sync();
        hall.rooms.focus();
        break;
      case 'rooms':
        hall.showRooms();
        break;
      case 'presence':
        hall.showPresence();
        break;
      case 'hallChatHistory':
        hall.showChat();
        break;
      case 'hallChat':
        hall.observeChat(message);
        if (message.from !== current.client.nick) sound.cue('chat');
        break;
      case 'room':
        busy = false;
        if (room === null) {
          enteredStartedRoom = message.room.state !== 'lobby';
          showRoom(current, message.room);
        } else {
          room.update(message.room, current.connected);
          assets?.observe(message.room);
          sync();
        }
        break;
      case 'left':
        generation++;
        busy = false;
        mapRequest?.cancel();
        assets?.observe(null);
        resetRoom();
        notice(leftNotice ?? copy.left);
        leftNotice = null;
        sync();
        hall.rooms.focus();
        break;
      case 'chatHistory':
        room?.showChat(current.client.chat);
        break;
      case 'chat':
        room?.observeChat(message);
        // Another player's line rings, as the original lobby does; our own echo stays silent (a choice:
        // the original does not separate the two).
        if (message.from !== current.client.nick) sound.cue('chat');
        break;
      case 'rejected': {
        room?.rejected(message.of);
        busy = false;
        const refusal = formatMessage(messages().net.refused, { reason: relayReasonText(message.reason) });
        sync();
        // A refusal the hall's password field shows stays there, beside what the player retypes.
        if (message.of === 'joinRoom' && hall.joinRefused(message.reason, refusal)) notice('');
        else notice(refusal);
        break;
      }
      case 'error':
        if (message.reason.code === 'banned') {
          leftNotice = copy.banned;
          notice(copy.banned);
          break;
        }
        notice(
          formatMessage(messages().networkRelay.serverSays, { reason: relayReasonText(message.reason) }),
        );
        break;
      case 'start':
        // A token put back into a started room gets its `start` on connect; there the player
        // chooses between rejoining and leaving instead.
        if (!enteredStartedRoom) launchGame();
        break;
      default:
        break;
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (connection !== null) return;
    const url = relayAddress(address.value);
    if (url === null) {
      advanced.open = true;
      address.focus();
      notice(copy.invalidServer);
      return;
    }
    if (!validNetworkNick(nick.value.trim())) {
      nick.focus();
      notice(formatMessage(copy.invalidNick, { max: MAX_NICK_LENGTH }));
      return;
    }
    try {
      rememberAddress();
      rememberFlag(flag.value());
      connection = services.connect(url, nick.value.trim());
      mapRequest = relayMapRequest(connection.client);
      assets = services.assets(
        connection.client,
        failure,
        { verifyNotice },
        () => {
          const current = connection;
          if (room && current?.client.room) room.update(current.client.room, current.connected);
        },
        loadMapNames,
      );
      unsubscribe = connection.subscribe(observe);
      notice(copy.connecting);
      sync();
    } catch (error) {
      connection?.dispose();
      connection = null;
      mapRequest = null;
      failure(error);
      sync();
    }
  });
  element.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !escapeLeavesRoom(event.target)) return;
    if (create.closeMapList()) {
      event.stopPropagation();
      event.preventDefault();
      return;
    }
    if (room === null) return;
    event.stopPropagation();
    event.preventDefault();
    leaveRoom();
  });
  sync();
  queueMicrotask(() => {
    if (!disposed) nick.focus();
  });
  return {
    element,
    dispose(): void {
      disposed = true;
      generation++;
      mapRequest?.cancel();
      unsubscribe();
      create.dispose();
      hall.dispose();
      disposeForm();
      room?.dispose();
      assets?.dispose();
      // Only the Leave button gives a seat in a started game up; leaving the screen keeps it.
      if (!handedOff) connection?.dispose(!enteredStartedRoom);
    },
  };
}
