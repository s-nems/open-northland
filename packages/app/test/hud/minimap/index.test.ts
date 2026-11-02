// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { type MinimapOptions, mountMinimap } from '../../../src/hud/minimap/index.js';

const dispose = vi.hoisted(() => vi.fn());

vi.mock('../../../src/hud/minimap/overview-canvas.js', () => ({
  createOverviewCanvas: async () => ({
    canvas: document.createElement('canvas'),
    stage: {},
    render: () => {},
    dispose,
  }),
}));

it("a map that fails to mount frees the overview's renderer", async () => {
  const unusable = {} as MinimapOptions;

  await expect(mountMinimap(unusable)).rejects.toThrow();

  expect(dispose).toHaveBeenCalledOnce();
});
