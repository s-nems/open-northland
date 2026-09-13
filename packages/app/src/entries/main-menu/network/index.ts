import { MAX_NICK_LENGTH } from '@open-northland/net-protocol';
import { errorText } from '../../../diag/error-text.js';
import { bcp47Tag, formatMessage, messages } from '../../../i18n/index.js';
import type { LaunchEntry } from '../../../launch.js';
import { type ConnectionEvent, NetworkConnection } from '../../../net/connection.js';
import { readStoredSettings } from '../../../view/settings-store.js';
import { relayIdentity } from '../../relay/identity.js';
import { DEFAULT_RELAY_URL } from '../lobby/relay-default.js';
import { pluralForm } from '../map-select-model.js';
import type { MenuScreen } from '../model.js';
import { screenHead } from '../screen-head.js';
import { roomAssets } from './assets.js';
import { createRoomCard } from './create-card.js';
import { prepareRoomCreation } from './creation.js';
import { escapeLeavesRoom, openRooms, relayAddress, validNetworkNick } from './model.js';
import { button, field, node } from './parts.js';
import { mountNetworkRoom } from './room/index.js';
import { launchNetworkGame } from './start.js';

export function networkScreen(
  open: (screen: MenuScreen) => void,
  launch: LaunchEntry,
  params: URLSearchParams,
) {
  const copy = messages().network;
  const element = node('section', 'main-menu__screen network-menu');
  const browser = node('div', 'network-menu__browser');
  const status = node('p', 'network-menu__notice');
  status.setAttribute('role', 'status');
  const roomHost = node('div');
  const address = node('input');
  address.type = 'url';
  address.value = params.get('relay') ?? DEFAULT_RELAY_URL;
  address.required = true;
  const nick = node('input');
  nick.value = readStoredSettings().netNick ?? '';
  nick.maxLength = MAX_NICK_LENGTH;
  nick.required = true;
  const form = node('form', 'network-menu__connection');
  const connect = node('button', 'main-menu__primary', copy.connect);
  connect.type = 'submit';
  let connection: NetworkConnection | null = null;
  let assets: ReturnType<typeof roomAssets> | null = null;
  let room: ReturnType<typeof mountNetworkRoom> | null = null;
  let unsubscribe: () => void = () => undefined;
  let disposed = false;
  let handedOff = false;
  let busy = false;
  let generation = 0;

  const notice = (text: string): void => {
    status.textContent = text;
    room?.notice(text);
  };
  const failure = (error: unknown): void => notice(formatMessage(copy.failed, { reason: errorText(error) }));
  const resetRoom = (): void => {
    room?.dispose();
    room = null;
    roomHost.replaceChildren();
    browser.hidden = false;
  };
  const disconnect = button(copy.disconnect, () => {
    generation++;
    unsubscribe();
    assets?.dispose();
    assets = null;
    connection?.dispose();
    connection = null;
    resetRoom();
    notice('');
    sync();
  });
  form.append(field(copy.server, address), field(copy.nick, nick), connect, disconnect);
  const list = node('div', 'network-menu__rooms');
  const refresh = button(copy.refresh, () => connection?.client.listRooms());
  const rooms = node('section', 'network-menu__room-list');
  rooms.append(node('h2', '', copy.rooms), refresh, list);
  const create = createRoomCard(async (choice) => {
    const current = connection;
    const mine = generation;
    if (current === null || !current.socket.connected || !current.client.welcomed || busy) return;
    busy = true;
    sync();
    try {
      const creation = await prepareRoomCreation(choice, params);
      if (disposed || mine !== generation || connection !== current || !current.socket.connected) return;
      assets?.prepare(creation.initial, creation.handle);
      current.client.createRoom(creation.settings, creation.seats);
    } finally {
      busy = false;
      sync();
    }
  });
  browser.append(form, node('div', 'network-menu__columns'));
  browser.lastElementChild?.append(rooms, create.element);
  element.append(screenHead('multiplayer', open), status, browser, roomHost);

  function sync(): void {
    const connected = connection?.socket.connected === true && connection.client.welcomed;
    address.disabled = connection !== null;
    nick.disabled = connection !== null;
    connect.disabled = connection !== null;
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
            formatMessage(pluralForm(summary.members, copy.members, bcp47Tag()), { count: summary.members }),
          ),
        );
        row.append(
          title,
          button(copy.join, () => {
            if (current.socket.connected && !busy) {
              busy = true;
              sync();
              current.client.joinRoom(summary.id);
            }
          }),
        );
        return row;
      }),
    );
    if (available.length === 0) list.append(node('p', '', copy.empty));
    sync();
  }

  function leaveRoom(): void {
    generation++;
    if (connection?.socket.connected) connection.client.leaveRoom();
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
        current.client.welcomed = false;
        if (current.client.room?.state === 'lobby') current.client.receive({ kind: 'left' });
        notice(copy.reconnecting);
      } else if (event.state === 'closed')
        notice(formatMessage(messages().net.closed, { reason: event.reason ?? '' }));
      room && current.client.room && room.update(current.client.room, current.socket.connected);
      sync();
      return;
    }
    const message = event.message;
    assets?.observeMessage(message);
    switch (message.kind) {
      case 'welcome':
        current.client.listRooms();
        notice(formatMessage(copy.connected, { nick: current.client.nick }));
        sync();
        break;
      case 'rooms':
        paintRooms();
        break;
      case 'room':
        busy = false;
        if (room === null) {
          room = mountNetworkRoom({
            client: current.client,
            copy: messages().networkRoom,
            savedRoster: () => assets?.savedRoster() ?? null,
            onLeave: leaveRoom,
            onRetryCompatibility: () => assets?.retry(),
          });
          roomHost.replaceChildren(room.element);
          browser.hidden = true;
          status.textContent = '';
        }
        room.update(message.room, current.socket.connected);
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
        break;
      case 'chat':
        room?.observeChat(message.from, message.text);
        break;
      case 'rejected':
        room?.rejected(message.of);
        busy = false;
        notice(formatMessage(messages().net.refused, { reason: message.reason }));
        sync();
        break;
      case 'error':
        notice(message.reason);
        break;
      case 'start': {
        if (assets === null) return;
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
          if (!disposed && generation === mine) {
            failure(error);
            leaveRoom();
          }
        });
        break;
      }
      default:
        break;
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (connection !== null) return;
    const url = relayAddress(address.value);
    if (url === null) {
      notice(copy.invalidServer);
      return;
    }
    if (!validNetworkNick(nick.value.trim())) {
      notice(formatMessage(copy.invalidNick, { max: MAX_NICK_LENGTH }));
      return;
    }
    try {
      connection = new NetworkConnection(url, relayIdentity(url, nick.value.trim()));
      assets = roomAssets(connection.client, failure, {}, () => {
        const current = connection;
        if (room && current?.client.room) room.update(current.client.room, current.socket.connected);
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
    if (event.key !== 'Escape' || room === null || !escapeLeavesRoom(event.target)) return;
    event.stopPropagation();
    event.preventDefault();
    leaveRoom();
  });
  sync();
  return {
    element,
    dispose(): void {
      disposed = true;
      generation++;
      unsubscribe();
      create.dispose();
      room?.dispose();
      assets?.dispose();
      if (!handedOff) connection?.dispose();
    },
  };
}
