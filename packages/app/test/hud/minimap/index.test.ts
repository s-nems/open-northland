// @vitest-environment jsdom
import { Container } from 'pixi.js';
import { afterEach, expect, it, vi } from 'vitest';
import { type MinimapOptions, mountMinimap } from '../../../src/hud/minimap/index.js';
import * as overviewCanvas from '../../../src/hud/minimap/overview-canvas.js';

afterEach(() => {
  vi.restoreAllMocks();
});

it("a map that fails to mount frees the overview's renderer", async () => {
  const dispose = vi.fn();
  vi.spyOn(overviewCanvas, 'createOverviewCanvas').mockResolvedValue({
    canvas: document.createElement('canvas'),
    stage: new Container(),
    render: vi.fn(),
    dispose,
  });
  const unusable = {} as MinimapOptions;

  await expect(mountMinimap(unusable)).rejects.toThrow();

  expect(dispose).toHaveBeenCalledOnce();
});
