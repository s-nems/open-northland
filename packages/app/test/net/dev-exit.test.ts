import type { RelayClient, RelaySocket } from '@open-northland/net-client';
import { expect, it, vi } from 'vitest';
import type { AssembledMapWorld } from '../../src/entries/map/boot.js';

const swap = vi.hoisted(() => vi.fn(async (_search: string, teardown: () => void) => teardown()));
vi.mock('../../src/launch.js', () => ({ swapToEntry: swap }));
vi.mock('../../src/view/params.js', () => ({ menuSearch: () => '?menu=1' }));

import { devRelayExit } from '../../src/entries/relay/dev-exit.js';

it('leaves explicitly and replaces the canvas while safely finishing a pending presentation', async () => {
  const leaveRoom = vi.fn();
  const receive = vi.fn();
  const close = vi.fn();
  const cleanup = vi.fn();
  const destroy = vi.fn();
  const nextCanvas = {};
  const canvas = { cloneNode: () => nextCanvas, replaceWith: vi.fn() };
  let finish: () => void = () => undefined;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const exit = devRelayExit({
    canvas: canvas as unknown as HTMLCanvasElement,
    client: { room: {}, leaveRoom, receive } as unknown as RelayClient,
    socket: { connected: true, close } as unknown as RelaySocket,
    world: () => ({ app: { destroy } }) as unknown as AssembledMapWorld,
    presentation: () => pending,
    cleanup,
    onFailure: vi.fn(),
  });
  exit.quit();
  expect(leaveRoom).toHaveBeenCalledOnce();
  expect(receive).toHaveBeenCalledWith({ kind: 'left' });
  expect(close).toHaveBeenCalledOnce();
  expect(cleanup).toHaveBeenCalledOnce();
  expect(canvas.replaceWith).toHaveBeenCalledWith(nextCanvas);
  expect(destroy).not.toHaveBeenCalled();
  finish();
  await pending;
  expect(destroy).toHaveBeenCalledWith(false, { children: true });
  exit.quit();
  exit.dispose();
  expect(leaveRoom).toHaveBeenCalledOnce();
});
