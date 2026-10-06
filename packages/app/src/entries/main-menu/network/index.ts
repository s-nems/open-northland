import type { MapText } from '@open-northland/data';
import { MAX_NICK_LENGTH } from '@open-northland/net-protocol';
import { loadMapList } from '../../../content/maps-index.js';
import { errorText } from '../../../diag/error-text.js';
import { bcp47Tag, formatMessage, messages, pluralForm } from '../../../i18n/index.js';
import type { LaunchEntry } from '../../../launch.js';
import { type ConnectionEvent, NetworkConnection } from '../../../net/connection.js';
import { relayCloseText, relayReasonText } from '../../../net/relay-reason.js';
import { relayIdentity } from '../../relay/identity.js';
import { node } from '../dom.js';
import { type MapSelectItem, mapItem } from '../map-select-model.js';
import type { MenuScreen } from '../model.js';
import type { MenuSound } from '../music.js';
import { screenHead } from '../screen-head.js';
import { roomAssets } from './assets.js';
import { connectionForm } from './connection-form.js';
import { createPanel } from './create.js';
import { prepareRoomCreation } from './creation.js';
import { escapeLeavesRoom, openRooms, relayAddress, validNetworkNick, worldTitle } from './model.js';
import { button } from './parts.js';
import { mountNetworkRoom } from './room/index.js';
import { launchNetworkGame } from './start.js';

export function networkScreen(
  open: (screen: MenuScreen) => void,
  launch: LaunchEntry,
  params: URLSearchParams,
  sound: MenuSound,
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
    advanced,
    resetServer,
    connect,
    disconnect,
    rememberAddress,
  } = connectionForm(params.get('relay'), () => dropConnection(''));
  const columns = node('div', 'network-menu__columns');
  let connection: NetworkConnection | null = null;
  let assets: ReturnType<typeof roomAssets> | null = null;
  let room: ReturnType<typeof mountNetworkRoom> | null = null;
  let unsubscribe: () => void = () => undefined;
  let disposed = false;
  let handedOff = false;
  let busy = false;
  let generation = 0;
  let enteredStartedRoom = false;

  /** Map names for the room header; a room shown before the listing answers names its map by id. */
  let mapNames: ReadonlyMap<string, MapText | undefined> = new Map();
  let mapPreviews: ReadonlyMap<string, MapSelectItem> = new Map();
  void loadMapList().then((entries) => {
    mapNames = new Map(entries.map((entry) => [entry.id, entry.name]));
    mapPreviews = new Map(entries.map((entry) => [entry.id, mapItem(entry)]));
    const current = connection;
    if (!disposed && room !== null && current?.client.room)
      room.update(current.client.room, current.connected);
  });

  const notice = (text: string): void => {
    status.textContent = text;
    room?.notice(text);
    status.hidden = room !== null;
  };
  const failure = (error: unknown): void => notice(formatMessage(copy.failed, { reason: errorText(error) }));
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
    unsubscribe();
    assets?.dispose();
    assets = null;
    connection?.dispose();
    connection = null;
    create.closeMapList();
    resetRoom();
    notice(text);
    sync();
    nick.focus();
  };
  const list = node('div', 'network-menu__rooms');
  const refresh = button(copy.refresh, () => connection?.client.listRooms());
  const rooms = node('section', 'network-menu__room-list');
  const roomsHead = node('header', 'network-menu__section-head');
  roomsHead.append(node('h2', '', copy.rooms), refresh);
  rooms.append(roomsHead, list);
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
        current.client.createRoom(creation.settings, creation.seats);
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
  columns.append(rooms, create.card);
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
    resetServer.disabled = connection !== null;
    address.disabled = connection !== null;
    nick.disabled = connection !== null;
    connect.disabled = connection !== null;
    connect.textContent = connection === null ? copy.connect : copy.connecting;
    if (!connected && connection !== null) form.append(disconnect);
    else account.append(disconnect);
    disconnect.hidden = connection === null;
    refresh.disabled = !connected || busy;
    create.enable(connected && !busy);
    for (const item of list.querySelectorAll<HTMLButtonElement>('button')) item.disabled = !connected || busy;
  }

  function paintRooms(): void {
    const current = connection;
    if (current === null) return;
    const available = openRooms(current.client.rooms);
    list.replaceChildren(
      ...available.map((summary) => {
        const row = node('div', 'network-menu__room-row');
        const title = node('div');
        title.append(
          node('strong', '', summary.name),
          node(
            'p',
            '',
            formatMessage(copy.roomCapacity, {
              members: formatMessage(pluralForm(summary.members, copy.members, bcp47Tag()), {
                count: summary.members,
              }),
              seats: summary.seats,
            }),
          ),
        );
        row.append(
          title,
          button(copy.join, () => {
            if (current.connected && !busy) {
              busy = true;
              sync();
              current.client.joinRoom(summary.id);
            }
          }),
        );
        return row;
      }),
    );
    if (available.length === 0) {
      const empty = node('div', 'network-menu__empty');
      empty.append(node('h3', '', copy.emptyTitle), node('p', '', copy.empty));
      list.append(empty);
    }
    sync();
  }

  function leaveRoom(): void {
    generation++;
    if (connection?.connected) connection.client.leaveRoom();
    else {
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
    if (current === null || assets === null || busy) return;
    const mine = generation;
    busy = true;
    notice(copy.starting);
    void launchNetworkGame(
      current,
      assets,
      (search) => {
        handedOff = true;
        launch(search);
      },
      () => !disposed && generation === mine && connection === current,
    ).catch((error: unknown) => {
      if (disposed || generation !== mine) return;
      failure(error);
      // A seat in a started game is given up only on purpose: the room stays up with the notice.
      if (enteredStartedRoom) busy = false;
      else leaveRoom();
    });
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
    switch (message.kind) {
      case 'welcome':
        list.replaceChildren(node('p', 'network-menu__muted', copy.loadingRooms));
        current.client.listRooms();
        notice('');
        sync();
        refresh.focus();
        break;
      case 'rooms':
        paintRooms();
        break;
      case 'room':
        busy = false;
        if (room === null) {
          enteredStartedRoom = message.room.state !== 'lobby';
          room = mountNetworkRoom({
            client: current.client,
            copy: messages().networkRoom,
            savedRoster: () => assets?.savedRoster() ?? null,
            mapPreview: (world) => (world.kind === 'map' ? (mapPreviews.get(world.mapId) ?? null) : null),
            onLeave: leaveRoom,
            rejoin: enteredStartedRoom ? launchGame : null,
            onRetryCompatibility: () => assets?.retry(),
            worldTitle: (world) => worldTitle(world, mapNames),
          });
          roomHost.replaceChildren(room.element);
          room.element.tabIndex = -1;
          room.element.focus();
          room.showChat(current.client.chat);
          browser.hidden = true;
          head.hidden = true;
          status.textContent = '';
        }
        room.update(message.room, current.connected);
        assets?.observe(message.room);
        sync();
        break;
      case 'left':
        generation++;
        busy = false;
        assets?.observe(null);
        resetRoom();
        notice(copy.left);
        current.client.listRooms();
        sync();
        refresh.focus();
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
      case 'rejected':
        room?.rejected(message.of);
        busy = false;
        notice(formatMessage(messages().net.refused, { reason: relayReasonText(message.reason) }));
        sync();
        break;
      case 'error':
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
      connection = new NetworkConnection(url, relayIdentity(url, nick.value.trim()));
      assets = roomAssets(connection.client, failure, {}, () => {
        const current = connection;
        if (room && current?.client.room) room.update(current.client.room, current.connected);
      });
      unsubscribe = connection.subscribe(observe);
      notice(copy.connecting);
      sync();
    } catch (error) {
      connection?.dispose();
      connection = null;
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
      unsubscribe();
      create.dispose();
      room?.dispose();
      assets?.dispose();
      // Only the Leave button gives a seat in a started game up; leaving the screen keeps it.
      if (!handedOff) connection?.dispose(!enteredStartedRoom);
    },
  };
}
