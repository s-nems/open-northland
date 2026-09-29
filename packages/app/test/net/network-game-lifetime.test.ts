import type { GameSession } from '@open-northland/lockstep';
import { expect, it, vi } from 'vitest';
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
      client: {},
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
      client: {},
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
