// @vitest-environment jsdom
import type { GameSession } from '@open-northland/lockstep';
import { RelayRefusal } from '@open-northland/net-client';
import type { ServerMessage } from '@open-northland/net-protocol';
import { describe, expect, it, vi } from 'vitest';
import { messages } from '../../src/i18n/index.js';
import type { FailureSource, HostedRelayedWorld, NetWorldPort } from '../../src/net/connection.js';
import type { NetworkHandover } from '../../src/net/handover.js';

const mocks = vi.hoisted(() => ({
  assemble: vi.fn(),
  present: vi.fn(),
  mountHud: vi.fn(),
  /** Leaves for the menu at once: the teardown runs as the menu's load would run it. */
  swap: vi.fn((_search: string, teardown: () => void) => {
    teardown();
    return Promise.resolve();
  }),
}));
vi.mock('../../src/launch.js', () => ({ swapToEntry: mocks.swap }));
vi.mock('../../src/entries/map/boot.js', () => ({
  assembleMapWorld: mocks.assemble,
  presentMapWorld: mocks.present,
}));
vi.mock('../../src/view/fullscreen.js', () => ({ bindDisplayMode: vi.fn() }));
vi.mock('../../src/entries/relay/net-hud.js', () => ({ mountNetHud: mocks.mountHud }));
vi.mock('../../src/view/net/start-roster.js', async (original) => ({
  ...(await original<typeof import('../../src/view/net/start-roster.js')>()),
  mountStartRoster: () => ({ update: vi.fn(), dispose: vi.fn() }),
}));

import { renderNetworkGame } from '../../src/entries/relay/network-game.js';

const LOCAL_SEAT = 0;
const session: GameSession = {
  world: { kind: 'map', mapId: 'forest' },
  seed: 1,
  seats: [{ player: LOCAL_SEAT, color: 0, mode: 'human' }],
  localSeat: LOCAL_SEAT,
  rules: { fog: null, progression: null, needs: null, weather: null, alliedVision: null },
  speed: 1,
};

/** A client the room has not started for yet, waiting for nobody. */
const IDLE_CLIENT = { nick: 'Ania', room: null, clockState: null, waitingFor: [] };

it('replaces the canvas before a resync assembles another WebGL renderer', async () => {
  const secondCanvas = {};
  const canvas = { cloneNode: vi.fn(() => secondCanvas), replaceWith: vi.fn() };
  const destroy = vi.fn();
  const disposeWorker = vi.fn();
  mocks.assemble.mockResolvedValue({
    app: { destroy },
    loaded: {},
    hosted: { worker: { dispose: disposeWorker } },
  });
  let port: NetWorldPort | undefined;
  const handover = {
    connection: {
      client: IDLE_CLIENT,
      connected: true,
      subscribe: () => () => undefined,
      bindWorld: (next: NetWorldPort) => {
        port = next;
      },
    },
    map: { mapId: 'forest' },
    initialSave: null,
  } as unknown as NetworkHandover;
  renderNetworkGame(canvas as unknown as HTMLCanvasElement, new URLSearchParams(), handover);
  expect(port).toBeDefined();
  const host = vi.fn();
  await port?.open(session, null, host);
  expect(mocks.assemble.mock.calls.at(-1)?.[0]).toBe(canvas);
  await port?.open(session, null, host);
  expect(destroy).toHaveBeenCalledWith(false, { children: true });
  expect(disposeWorker).toHaveBeenCalledOnce();
  expect(canvas.replaceWith).toHaveBeenCalledWith(secondCanvas);
  expect(mocks.assemble.mock.calls.at(-1)?.[0]).toBe(secondCanvas);
});

it('shows the link as it stands on a HUD mounted after the link changed', async () => {
  const CLOSE_REASON = 'the relay shut down';
  const link = vi.fn();
  mocks.mountHud.mockReturnValue({ link, observe: vi.fn(), dispose: vi.fn() });
  const worker = { dispose: vi.fn(), driver: {}, host: {}, offThreadTickCost: vi.fn() };
  mocks.assemble.mockResolvedValue({ app: { destroy: vi.fn() }, loaded: {}, hosted: { worker } });
  mocks.present.mockResolvedValue({ destroy: vi.fn() });
  let port: NetWorldPort | undefined;
  let onWorld: ((world: HostedRelayedWorld) => void) | undefined;
  const handover = {
    connection: {
      client: IDLE_CLIENT,
      connected: false,
      // Closed while the world was rebuilt, when no HUD stood to hear it.
      linkState: null as { state: string; reason?: string; atMs: number } | null,
      subscribe: () => () => undefined,
      bindWorld: (next: NetWorldPort, shown: (world: HostedRelayedWorld) => void) => {
        port = next;
        onWorld = shown;
      },
    },
    map: { mapId: 'forest' },
    initialSave: null,
  };
  const canvas = { cloneNode: vi.fn(() => ({})), replaceWith: vi.fn() };
  renderNetworkGame(
    canvas as unknown as HTMLCanvasElement,
    new URLSearchParams(),
    handover as unknown as NetworkHandover,
  );
  await port?.open(session, null, vi.fn());
  const CLOSED_AT_MS = 1234;
  handover.connection.linkState = { state: 'closed', reason: CLOSE_REASON, atMs: CLOSED_AT_MS };
  onWorld?.({ worldId: 1, session: worker } as unknown as HostedRelayedWorld);
  await vi.waitFor(() => expect(link).toHaveBeenCalled());
  expect(link).toHaveBeenCalledWith(
    { state: 'closed', reason: CLOSE_REASON, atMs: CLOSED_AT_MS },
    CLOSED_AT_MS,
  );
});

const WORLD_ID = 1;

/** A relayed game whose world is assembled and presented behind the loading card. */
function presentedGame() {
  const client: {
    nick: string;
    room: null;
    session: GameSession;
    clockState: unknown;
    waitingFor: readonly unknown[];
  } = {
    nick: 'Ania',
    room: null,
    session,
    clockState: null,
    waitingFor: [],
  };
  let listener: ((event: unknown) => void) | undefined;
  let port: NetWorldPort | undefined;
  let onWorld: ((world: HostedRelayedWorld) => void) | undefined;
  const progress = { reached: false, started: false };
  /** Whether the presented view reports its first frame shown, or ended before it. */
  const presented = { shown: true };
  const worker = { dispose: vi.fn(), driver: {}, host: {}, offThreadTickCost: vi.fn() };
  mocks.assemble.mockResolvedValue({ app: { destroy: vi.fn() }, loaded: {}, hosted: { worker } });
  mocks.mountHud.mockReturnValue({ link: vi.fn(), observe: vi.fn(), dispose: vi.fn() });
  mocks.present.mockImplementation(
    async (_world, runtime: { untilStart: (shown: boolean) => Promise<void> }) => {
      progress.reached = true;
      await runtime.untilStart(presented.shown);
      progress.started = true;
      return { destroy: vi.fn() };
    },
  );
  const worldShown = vi.fn();
  const handover = {
    connection: {
      client,
      connected: true,
      linkState: { state: 'ok', atMs: 0 },
      dispose: vi.fn(),
      worldShown,
      subscribe: (next: (event: unknown) => void) => {
        listener = next;
        return () => undefined;
      },
      bindWorld: (next: NetWorldPort, shown: (world: HostedRelayedWorld) => void) => {
        port = next;
        onWorld = shown;
      },
    },
    map: { mapId: 'forest' },
    initialSave: null,
  };
  const canvas = { cloneNode: vi.fn(() => ({})), replaceWith: vi.fn() };
  renderNetworkGame(
    canvas as unknown as HTMLCanvasElement,
    new URLSearchParams(),
    handover as unknown as NetworkHandover,
  );
  /** A relay message the worker forwarded; a bare kind stands for one whose fields the game never reads. */
  const relay = (message: ServerMessage | { readonly kind: ServerMessage['kind'] }) =>
    listener?.({ kind: 'message', message });
  const fail = (what: FailureSource, error: unknown) => listener?.({ kind: 'failure', what, error });
  const show = async () => {
    await port?.open(session, null, vi.fn());
    onWorld?.({ worldId: WORLD_ID, session: worker } as unknown as HostedRelayedWorld);
    await vi.waitFor(() => expect(progress.reached).toBe(true));
  };
  /** The room's clock runs with nobody loading: the loading card is gone. */
  const start = async () => {
    await show();
    client.clockState = { kind: 'clock', tick: 1, speed: 1, paused: false, by: null, governed: null };
    relay({ kind: 'clock' });
    await vi.waitFor(() => expect(progress.started).toBe(true));
  };
  return {
    client,
    relay,
    fail,
    show,
    start,
    progress,
    worldShown,
    presented,
    open: () => port?.open(session, null, vi.fn()),
  };
}

describe('the start wait under the loading card', () => {
  it('holds the world until the clock runs and nobody is still loading', async () => {
    const game = presentedGame();
    await game.show();
    game.client.waitingFor = [{ nick: 'Ania', reason: 'loading', voteAfterMs: 0 }];
    game.client.clockState = { kind: 'clock', tick: 1, speed: 1, paused: false, by: null, governed: null };
    game.relay({ kind: 'clock' });
    await Promise.resolve();
    expect(game.progress.started).toBe(false);
    game.client.waitingFor = [];
    game.relay({ kind: 'waiting' });
    await vi.waitFor(() => expect(game.progress.started).toBe(true));
  });

  it('tells the worker the world is shown as the card turns to the players, before the clock runs', async () => {
    const game = presentedGame();
    expect(game.worldShown).not.toHaveBeenCalled();
    await game.show();
    expect(game.worldShown).toHaveBeenCalledExactlyOnceWith(WORLD_ID);
    expect(game.progress.started).toBe(false);
  });

  it('keeps the world unshown from the worker when the view ended before its first frame', async () => {
    const game = presentedGame();
    game.presented.shown = false;
    await game.show();
    expect(game.worldShown).not.toHaveBeenCalled();
  });

  it('lets a waiting world through once another world replaces it', async () => {
    const game = presentedGame();
    await game.show();
    void game.open();
    await vi.waitFor(() => expect(game.progress.started).toBe(true));
  });
});

describe('a halt after the start', () => {
  const panel = () => document.body.lastElementChild;
  const backButton = () => {
    const button = document.body.querySelector('button');
    if (button === null) throw new Error('no way back to the menu');
    return button;
  };

  it('tells a voted-out player so over the ended game, and the way back takes the whole notice', async () => {
    const game = presentedGame();
    await game.start();
    const before = document.body.childElementCount;
    game.relay({
      kind: 'kicked',
      player: LOCAL_SEAT,
      nick: 'Ania',
      mode: 'ai',
      cause: 'vote',
      tick: 2,
    });
    expect(panel()?.textContent).toContain(messages().net.gameEndedTitle);
    expect(panel()?.textContent).toContain(messages().net.youWereKicked);
    backButton().click();
    expect(mocks.swap).toHaveBeenCalled();
    expect(document.body.childElementCount).toBe(before);
  });

  it('ends a game whose room went on without it under the ended-game title', async () => {
    const game = presentedGame();
    await game.start();
    game.fail('room', new Error(messages().net.removedWhileAway));
    expect(panel()?.textContent).toContain(messages().net.gameEndedTitle);
    expect(panel()?.textContent).toContain(messages().net.removedWhileAway);
    backButton().click();
  });

  it('keeps the title a refused world names even while the loading card is still up', async () => {
    const game = presentedGame();
    await game.show();
    game.fail('open', new RelayRefusal({ code: 'worldTickMismatch', tick: 3 }));
    const notice = document.body.querySelector('.boot-notice');
    expect(notice?.textContent).toContain(messages().networkRelay.worldRefused);
    expect(notice?.textContent).not.toContain(messages().net.startFailedTitle);
    notice?.querySelector('button')?.click();
    expect(document.body.querySelector('.boot-notice')).toBeNull();
  });
});
