import type { GameSession } from '@open-northland/lockstep';
import { describe, expect, it, vi } from 'vitest';
import type { HostedRelayedWorld, NetWorldPort } from '../../src/net/connection.js';
import type { NetworkHandover } from '../../src/net/handover.js';

const mocks = vi.hoisted(() => ({ assemble: vi.fn(), present: vi.fn(), mountHud: vi.fn() }));
vi.mock('../../src/entries/map/boot.js', () => ({
  assembleMapWorld: mocks.assemble,
  presentMapWorld: mocks.present,
}));
vi.mock('../../src/view/fullscreen.js', () => ({ bindDisplayMode: vi.fn() }));
vi.mock('../../src/entries/relay/net-hud.js', () => ({ mountNetHud: mocks.mountHud }));

import { renderNetworkGame } from '../../src/entries/relay/network-game.js';

const session: GameSession = {
  world: { kind: 'map', mapId: 'forest' },
  seed: 1,
  seats: [{ player: 0, color: 0, mode: 'human' }],
  localSeat: 0,
  rules: { fog: null, progression: null, needs: null, weather: null },
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
      linkState: null as { state: string; reason?: string } | null,
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
  handover.connection.linkState = { state: 'closed', reason: CLOSE_REASON };
  onWorld?.({ worldId: 1, session: worker } as unknown as HostedRelayedWorld);
  await vi.waitFor(() => expect(link).toHaveBeenCalled());
  expect(link).toHaveBeenCalledWith('closed', CLOSE_REASON);
});

describe('the start wait under the loading card', () => {
  const WORLD_ID = 1;

  function presentedGame() {
    const client: { nick: string; room: null; clockState: unknown; waitingFor: readonly unknown[] } = {
      nick: 'Ania',
      room: null,
      clockState: null,
      waitingFor: [],
    };
    let listener: ((event: unknown) => void) | undefined;
    let port: NetWorldPort | undefined;
    let onWorld: ((world: HostedRelayedWorld) => void) | undefined;
    const progress = { reached: false, started: false };
    const worker = { dispose: vi.fn(), driver: {}, host: {}, offThreadTickCost: vi.fn() };
    mocks.assemble.mockResolvedValue({ app: { destroy: vi.fn() }, loaded: {}, hosted: { worker } });
    mocks.mountHud.mockReturnValue({ link: vi.fn(), observe: vi.fn(), dispose: vi.fn() });
    mocks.present.mockImplementation(async (_world, runtime: { untilStart: () => Promise<void> }) => {
      progress.reached = true;
      await runtime.untilStart();
      progress.started = true;
      return { destroy: vi.fn() };
    });
    const handover = {
      connection: {
        client,
        connected: true,
        linkState: { state: 'ok' },
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
    const relay = (message: { kind: string }) => listener?.({ kind: 'message', message });
    const show = async () => {
      await port?.open(session, null, vi.fn());
      onWorld?.({ worldId: WORLD_ID, session: worker } as unknown as HostedRelayedWorld);
      await vi.waitFor(() => expect(progress.reached).toBe(true));
    };
    return { client, relay, show, progress, open: () => port?.open(session, null, vi.fn()) };
  }

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

  it('lets a waiting world through once another world replaces it', async () => {
    const game = presentedGame();
    await game.show();
    void game.open();
    await vi.waitFor(() => expect(game.progress.started).toBe(true));
  });
});
