// @vitest-environment jsdom
import {
  type HallChatLine,
  type OnlinePlayer,
  PROTOCOL_VERSION,
  type RecentPlayer,
  type RoomSummary,
  type RoomView,
  type ServerMessage,
} from '@open-northland/net-protocol';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  type NetworkScreenServices,
  networkScreen,
} from '../../../../src/entries/main-menu/network/index.js';
import { messages } from '../../../../src/i18n/index.js';
import type { ConnectionEvent, NetworkConnection } from '../../../../src/net/connection.js';

const NICK = 'Astrid';

function room(state: RoomView['state']): RoomView {
  return {
    id: 'room1',
    creator: NICK,
    state,
    settings: {
      name: 'Expedition',
      world: { kind: 'map', mapId: 'forest' },
      seed: 1,
      rules: {
        fog: null,
        progression: null,
        needs: null,
        weather: null,
        dayNight: null,
        alliedVision: null,
        peace: null,
      },
      speed: 1,
      kickedSeatMode: 'idle',
    },
    seats: [{ player: 0, mode: 'human', claimable: true, offers: [], color: 0, nick: NICK, ready: true }],
    members: [
      {
        nick: NICK,
        seat: 0,
        connected: true,
        compatibility: { content: 'a', map: 'b', client: 'test', protocol: PROTOCOL_VERSION },
        load: null,
        loading: null,
        roundTripMs: null,
        delayTicks: null,
        behindTicks: 0,
      },
    ],
  };
}

/** A connection the test speaks for as the relay. */
function fakeConnection() {
  let listener: ((event: ConnectionEvent) => void) | undefined;
  const client = {
    nick: NICK,
    welcomed: true,
    room: null as RoomView | null,
    rooms: [] as readonly RoomSummary[],
    online: [] as readonly OnlinePlayer[],
    recent: [] as readonly RecentPlayer[],
    hallChat: [] as readonly HallChatLine[],
    chat: [],
    listRooms: vi.fn(),
    sayInHall: vi.fn(),
    leaveRoom: vi.fn(),
    requestMap: vi.fn(),
  };
  const connection = {
    url: 'ws://relay.test/',
    connected: true,
    client,
    subscribe(next: (event: ConnectionEvent) => void) {
      listener = next;
      return () => undefined;
    },
    dispose: vi.fn(),
  };
  const relay = (message: ServerMessage): void => {
    if (message.kind === 'room') client.room = message.room;
    if (message.kind === 'rooms') client.rooms = message.rooms;
    if (message.kind === 'presence') {
      client.online = message.online;
      client.recent = message.recent;
    }
    if (message.kind === 'hallChat') client.hallChat = [...client.hallChat, message];
    listener?.({ kind: 'message', message });
  };
  return {
    connection: connection as unknown as NetworkConnection,
    client,
    relay,
    dispose: connection.dispose,
  };
}

const fakeAssets = (() => ({
  prepare: vi.fn(),
  observe: vi.fn(),
  observeMessage: vi.fn(),
  retry: vi.fn(),
  verifiedMap: () => null,
  mapSlots: () => null,
  initialSave: () => null,
  savedRoster: () => null,
  dispose: vi.fn(),
})) as unknown as NetworkScreenServices['assets'];

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      disconnect(): void {}
    },
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

/** The multiplayer screen connected through `fake` and welcomed by the relay. */
function connectedScreen(
  fake: ReturnType<typeof fakeConnection>,
  startGame: NetworkScreenServices['startGame'],
): ReturnType<typeof networkScreen> {
  const screen = networkScreen(
    vi.fn(),
    vi.fn(),
    new URLSearchParams({ relay: 'ws://relay.test/' }),
    { cue: vi.fn() } as unknown as Parameters<typeof networkScreen>[3],
    { connect: () => fake.connection, assets: fakeAssets, startGame, ping: async () => null },
  );
  document.body.append(screen.element);
  const nick = screen.element.querySelector<HTMLInputElement>('input[autocomplete="nickname"]');
  if (nick === null) throw new Error('no nick field');
  nick.value = NICK;
  screen.element.querySelector('form')?.requestSubmit();
  fake.relay({ kind: 'welcome', nick: NICK } as ServerMessage);
  return screen;
}

it('shows the games, players and chat the relay pushes to the hall, and says a line to it', () => {
  const fake = fakeConnection();
  const screen = connectedScreen(fake, vi.fn());
  const world = { kind: 'map', mapId: 'forest' } as const;
  fake.relay({
    kind: 'rooms',
    rooms: [
      { id: 'r1', name: 'Open', state: 'lobby', members: ['Bjorn'], seats: 4, world, playedMs: null },
      { id: 'r2', name: 'Battle', state: 'running', members: ['Emil'], seats: 2, world, playedMs: 3_661_000 },
    ],
  });
  fake.relay({
    kind: 'presence',
    online: [
      { nick: NICK, room: null },
      { nick: 'Emil', room: 'r2' },
    ],
    recent: [{ nick: 'Space', at: Date.now() - 3 * 60 * 60 * 1000 }],
  });
  fake.relay({ kind: 'hallChat', from: 'Emil', text: 'gg', at: Date.now() });
  const text = screen.element.textContent ?? '';
  for (const shown of ['Open', 'Bjorn', 'Battle', '1:01:01', 'Space', 'gg']) expect(text).toContain(shown);
  const copy = messages().network;
  expect(text).toContain(copy.playingIn.replace('{room}', 'Battle'));
  const input = screen.element.querySelector<HTMLInputElement>('.network-hall__chat-form input');
  if (input === null) throw new Error('no chat field');
  input.value = ' hej ';
  input.form?.requestSubmit();
  expect(fake.client.sayInHall).toHaveBeenCalledExactlyOnceWith('hej');
  screen.dispose();
});

it('keeps a started room up when the game it hands over to never loads, instead of leaving it', async () => {
  const fake = fakeConnection();
  // The handover is staged; the menu's load of the game's module then fails.
  const startGame: NetworkScreenServices['startGame'] = async (
    _connection,
    _assets,
    launch,
    _current,
    abandoned,
  ) => {
    launch('?relay');
    abandoned(new Error('the game module failed to load'));
  };
  const screen = connectedScreen(fake, startGame);
  fake.relay({ kind: 'room', room: room('lobby') });
  fake.relay({ kind: 'room', room: room('running') });
  fake.relay({ kind: 'start' } as ServerMessage);
  await vi.waitFor(() => expect(screen.element.textContent).toContain('the game module failed to load'));
  expect(fake.client.leaveRoom).not.toHaveBeenCalled();
  const labels = [...screen.element.querySelectorAll('button')].map((button) => button.textContent);
  expect(labels).toContain(messages().networkRoom.rejoin);
  // Leaving the screen now keeps the seat, which the room hands over if the player never returns.
  screen.dispose();
  expect(fake.dispose).toHaveBeenCalledExactlyOnceWith(false);
});

it('serves a started room the relay kept map when this browser lost its own', async () => {
  const fake = fakeConnection();
  let delivered: Promise<string> | null = null;
  const startGame: NetworkScreenServices['startGame'] = async (...args) => {
    delivered = args[5]();
  };
  const screen = connectedScreen(fake, startGame);
  fake.relay({ kind: 'room', room: room('running') });
  const rejoin = [...screen.element.querySelectorAll('button')].find(
    (button) => button.textContent === messages().networkRoom.rejoin,
  );
  rejoin?.click();
  expect(fake.client.requestMap).toHaveBeenCalledOnce();
  fake.relay({ kind: 'blob', type: 'map', from: NICK, tick: null, bytes: 'map text' });
  await expect(delivered).resolves.toBe('map text');
  screen.dispose();
});

it('words the relay refusal of the kept map instead of showing its code', async () => {
  const fake = fakeConnection();
  const startGame: NetworkScreenServices['startGame'] = async (...args) => {
    await args[5]();
  };
  const screen = connectedScreen(fake, startGame);
  fake.relay({ kind: 'room', room: room('running') });
  const rejoin = [...screen.element.querySelectorAll('button')].find(
    (button) => button.textContent === messages().networkRoom.rejoin,
  );
  rejoin?.click();
  fake.relay({ kind: 'rejected', of: 'requestMap', reason: { code: 'mapNotKept' } });
  await vi.waitFor(() =>
    expect(screen.element.textContent).toContain(messages().networkRelay.reasons.mapNotKept),
  );
  expect(screen.element.textContent).not.toContain('mapNotKept');
  screen.dispose();
});
