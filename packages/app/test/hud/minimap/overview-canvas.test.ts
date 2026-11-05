// @vitest-environment jsdom
import * as render from '@open-northland/render';
import type { Application } from 'pixi.js';
import { afterEach, expect, it, vi } from 'vitest';
import { createOverviewCanvas } from '../../../src/hud/minimap/overview-canvas.js';

afterEach(() => {
  vi.restoreAllMocks();
});

it("closing the canvas leaves Pixi's global pools to the game's live renderer", async () => {
  const destroy = vi.fn();
  vi.spyOn(render, 'createPixiApp').mockResolvedValue({ stage: {}, destroy } as unknown as Application);
  const overview = await createOverviewCanvas();

  overview.dispose();

  expect(destroy.mock.calls).toEqual([[{ removeView: true }]]);
});
