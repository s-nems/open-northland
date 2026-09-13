import type { GameSession } from '@open-northland/lockstep';
import type { WorldPort } from '@open-northland/net-client';
import { expect, it, vi } from 'vitest';
import type { NetworkHandover } from '../../src/net/handover.js';

const mocks = vi.hoisted(() => ({ assemble: vi.fn(), present: vi.fn() }));
vi.mock('../../src/entries/map/boot.js', () => ({
  assembleMapWorld: mocks.assemble,
  presentMapWorld: mocks.present,
}));
vi.mock('../../src/view/fullscreen.js', () => ({ bindDisplayMode: vi.fn() }));
vi.mock('../../src/entries/relay/net-hud.js', () => ({ mountNetHud: vi.fn() }));

import { renderNetworkGame } from '../../src/entries/relay/network-game.js';

const session: GameSession = {
  world: { kind: 'map', mapId: 'forest' },
  seed: 1,
  seats: [{ player: 0, color: 0, mode: 'human' }],
  localSeat: 0,
  rules: { fog: null, progression: null, needs: null },
  speed: 1,
};

it('replaces the canvas before a resync assembles another WebGL renderer', async () => {
  const secondCanvas = {};
  const canvas = { cloneNode: vi.fn(() => secondCanvas), replaceWith: vi.fn() };
  const destroy = vi.fn();
  mocks.assemble.mockResolvedValue({ app: { destroy }, loaded: {}, sim: {} });
  let port: WorldPort | undefined;
  const handover = {
    connection: {
      client: {},
      socket: { connected: true },
      subscribe: () => () => undefined,
      bindWorld: (next: WorldPort) => {
        port = next;
      },
    },
    map: { mapId: 'forest' },
    initialSave: null,
  } as unknown as NetworkHandover;
  renderNetworkGame(canvas as unknown as HTMLCanvasElement, new URLSearchParams(), handover);
  expect(port).toBeDefined();
  await port?.open(session, null);
  expect(mocks.assemble.mock.calls.at(-1)?.[0]).toBe(canvas);
  await port?.open(session, null);
  expect(destroy).toHaveBeenCalledWith(false, { children: true });
  expect(canvas.replaceWith).toHaveBeenCalledWith(secondCanvas);
  expect(mocks.assemble.mock.calls.at(-1)?.[0]).toBe(secondCanvas);
});
