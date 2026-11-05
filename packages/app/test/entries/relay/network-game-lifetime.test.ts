// @vitest-environment jsdom
import type { GameSession } from '@open-northland/lockstep';
import { RelayRefusal } from '@open-northland/net-client';
import type { ServerMessage } from '@open-northland/net-protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { messages } from '../../../src/i18n/index.js';
import type { FailureSource, HostedRelayedWorld, NetWorldPort } from '../../../src/net/connection.js';
import type { NetworkHandover } from '../../../src/net/handover.js';
import * as startRoster from '../../../src/view/net/start-roster.js';
import type { SavedView } from '../../../src/view/runtime/save-load/view-state.js';
import { swapToEntry } from '../../support/swap-to-entry.js';

const mocks = vi.hoisted(() => ({
  assemble: vi.fn(),
  present: vi.fn(),
  mountHud: vi.fn(),
}));
vi.mock('../../../src/launch.js', async () => ({
  swapToEntry: (await import('../../support/swap-to-entry.js')).swapToEntry,
}));
vi.mock('../../../src/entries/map/boot.js', () => ({
  assembleMapWorld: mocks.assemble,
  presentMapWorld: mocks.present,
}));
vi.mock('../../../src/view/platform/fullscreen.js', () => ({ bindDisplayMode: vi.fn() }));
vi.mock('../../../src/entries/relay/net-hud.js', () => ({ mountNetHud: mocks.mountHud }));

beforeEach(() => {
  swapToEntry.mockClear();
  window.sessionStorage.clear();
  document.body.replaceChildren();
  vi.spyOn(startRoster, 'mountStartRoster').mockReturnValue({ update: vi.fn(), dispose: vi.fn() });
});
afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

import { renderNetworkGame } from '../../../src/entries/relay/network-game.js';

const LOCAL_SEAT = 0;
const session: GameSession = {
  world: { kind: 'map', mapId: 'forest' },
  seed: 1,
  seats: [{ player: LOCAL_SEAT, color: 0, mode: 'human' }],
  localSeat: LOCAL_SEAT,
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
  mocks.present.mockResolvedValue({ destroy: vi.fn(), viewState: () => null, presentation: () => null });
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
const RELAY_URL = 'ws://relay.test/';
const ROOM_ID = 'room1';
const RESTORED_TICK = 40;

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
  /** Whether the presented view reports its first frame shown, or ended before it; `view` is what its
   *  control groups read as when it is torn down. */
  const presented: { shown: boolean; view: SavedView | null; returnToMenu: (() => void) | null } = {
    shown: true,
    view: null,
    returnToMenu: null,
  };
  const worker = { dispose: vi.fn(), driver: {}, host: {}, offThreadTickCost: vi.fn() };
  mocks.assemble.mockResolvedValue({ app: { destroy: vi.fn() }, loaded: {}, hosted: { worker } });
  mocks.mountHud.mockReturnValue({ link: vi.fn(), observe: vi.fn(), dispose: vi.fn() });
  mocks.present.mockImplementation(
    async (
      _world,
      runtime: { untilStart: (shown: boolean) => Promise<void>; onReturnToMenu: () => void },
    ) => {
      presented.returnToMenu = runtime.onReturnToMenu;
      progress.reached = true;
      await runtime.untilStart(presented.shown);
      progress.started = true;
      return { destroy: vi.fn(), viewState: () => presented.view, presentation: () => null };
    },
  );
  const worldShown = vi.fn();
  const dispose = vi.fn();
  const handover = {
    connection: {
      client,
      url: RELAY_URL,
      identity: { token: 'token-of-ania', nick: 'Ania' },
      connected: true,
      linkState: { state: 'ok', atMs: 0 },
      dispose,
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
    new URLSearchParams({ room: ROOM_ID }),
    handover as unknown as NetworkHandover,
  );
  /** A relay message the worker forwarded; a bare kind stands for one whose fields the game never reads. */
  const relay = (message: ServerMessage | { readonly kind: ServerMessage['kind'] }) =>
    listener?.({ kind: 'message', message });
  const fail = (what: FailureSource, error: unknown) => listener?.({ kind: 'failure', what, error });
  const link = (state: string, reason?: string) => listener?.({ kind: 'link', state, reason, atMs: 0 });
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
    dispose,
    relay,
    fail,
    link,
    show,
    start,
    progress,
    worldShown,
    presented,
    open: () => port?.open(session, null, vi.fn()),
    restore: () => port?.restore(session, { tick: RESTORED_TICK, mapId: 'forest', view: null }, vi.fn()),
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
      mode: 'computer',
      cause: 'vote',
      tick: 2,
    });
    expect(panel()?.textContent).toContain(messages().net.gameEndedTitle);
    expect(panel()?.textContent).toContain(messages().net.youWereKicked);
    backButton().click();
    expect(swapToEntry).toHaveBeenCalled();
    expect(document.body.childElementCount).toBe(before);
  });

  it('tells a player whose seat the room handed over for a slow load why, not that it was voted out', async () => {
    const game = presentedGame();
    await game.start();
    game.relay({
      kind: 'kicked',
      player: LOCAL_SEAT,
      nick: 'Ania',
      mode: 'idle',
      cause: 'loadingTimedOut',
      tick: 2,
    });
    expect(panel()?.textContent).toContain(messages().net.youTimedOut.idle);
    expect(panel()?.textContent).not.toContain(messages().net.youWereKicked);
    backButton().click();
  });

  it('offers the held seat back when the relay closes the link of a running game for good', async () => {
    const game = presentedGame();
    await game.start();
    game.link('closed', 'trafficLimit');
    expect(game.dispose).toHaveBeenCalledExactlyOnceWith(false);
    const labels = [...document.body.querySelectorAll('button')].map((button) => button.textContent);
    expect(labels).toEqual([messages().networkRelay.retry, messages().networkRelay.leaveGame]);
  });

  it('leaves a link another connection took over to the in-game screen', async () => {
    const game = presentedGame();
    await game.start();
    game.link('closed', 'replaced');
    expect(game.dispose).not.toHaveBeenCalled();
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
  });
});

describe('the seat after a halt', () => {
  const buttons = () => [...document.body.querySelectorAll('button')].map((button) => button.textContent);
  const relayCopy = () => messages().networkRelay;

  it('keeps the seat when a started game fails, and offers to retry or to leave', async () => {
    const game = presentedGame();
    await game.start();
    game.fail('message', new Error('a bad frame'));
    expect(game.dispose).toHaveBeenCalledExactlyOnceWith(false);
    expect(buttons()).toEqual([relayCopy().retry, relayCopy().leaveGame]);
  });

  it('keeps the seat when the world fails under the loading card', async () => {
    const game = presentedGame();
    await game.show();
    game.fail('open', new Error('no WebGL'));
    expect(game.dispose).toHaveBeenCalledExactlyOnceWith(false);
    const notice = document.body.querySelector('.boot-notice');
    expect([...(notice?.querySelectorAll('button') ?? [])].map((button) => button.textContent)).toEqual([
      relayCopy().retry,
      relayCopy().leaveGame,
    ]);
  });

  it('gives the seat up when the player returns to the menu on purpose', async () => {
    const game = presentedGame();
    await game.start();
    game.presented.returnToMenu?.();
    expect(game.dispose).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('offers only the menu once the room has no seat for this client', async () => {
    const game = presentedGame();
    await game.start();
    game.relay({
      kind: 'kicked',
      player: LOCAL_SEAT,
      nick: 'Ania',
      mode: 'computer',
      cause: 'vote',
      tick: 2,
    });
    expect(game.dispose).toHaveBeenCalledExactlyOnceWith(false);
    expect(buttons()).toEqual([messages().hud.returnToMenu]);
  });
});

describe('a closed link before the clock runs', () => {
  it('ends the loading card with a way out instead of leaving it frozen', async () => {
    const game = presentedGame();
    await game.show();
    game.link('closed', 'malformed');
    const notice = document.body.querySelector('.boot-notice');
    expect(notice?.textContent).toContain(messages().net.startFailedTitle);
    expect(notice?.querySelectorAll('button')).toHaveLength(2);
  });

  it('offers no seat back once another connection took this token over', async () => {
    const game = presentedGame();
    await game.show();
    game.link('closed', 'replaced');
    const notice = document.body.querySelector('.boot-notice');
    expect([...(notice?.querySelectorAll('button') ?? [])].map((button) => button.textContent)).toEqual([
      messages().hud.returnToMenu,
    ]);
  });
});

describe('control groups across a relayed rebuild', () => {
  const GROUPS: SavedView = { seat: LOCAL_SEAT, controlGroups: { controlGroup1: [7, 9] } };

  it('restores the groups the torn-down view held into the world a snapshot rebuilds', async () => {
    const game = presentedGame();
    await game.start();
    game.presented.view = GROUPS;
    await game.restore();
    const plan = mocks.assemble.mock.calls.at(-1)?.[2] as { stagedSave: { header: { view: unknown } } };
    expect(plan.stagedSave.header.view).toEqual(GROUPS);
  });

  it('keeps them for a reload of the same room', async () => {
    const first = presentedGame();
    await first.start();
    first.presented.view = GROUPS;
    first.fail('message', new Error('a bad frame'));
    const reloaded = presentedGame();
    await reloaded.restore();
    const plan = mocks.assemble.mock.calls.at(-1)?.[2] as { stagedSave: { header: { view: unknown } } };
    expect(plan.stagedSave.header.view).toEqual(GROUPS);
  });

  it('forgets them once the room has no seat for this client', async () => {
    const first = presentedGame();
    await first.start();
    first.presented.view = GROUPS;
    first.relay({
      kind: 'kicked',
      player: LOCAL_SEAT,
      nick: 'Ania',
      mode: 'computer',
      cause: 'vote',
      tick: 2,
    });
    const reloaded = presentedGame();
    await reloaded.restore();
    const plan = mocks.assemble.mock.calls.at(-1)?.[2] as { stagedSave: { header: { view: unknown } } };
    expect(plan.stagedSave.header.view).not.toEqual(GROUPS);
  });
});
