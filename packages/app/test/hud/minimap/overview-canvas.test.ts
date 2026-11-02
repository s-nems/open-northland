// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { createOverviewCanvas } from '../../../src/hud/minimap/overview-canvas.js';

const destroy = vi.hoisted(() => vi.fn());

vi.mock('@open-northland/render', () => ({
  createPixiApp: async () => ({ stage: {}, renderer: {}, destroy }),
}));

it("closing the canvas leaves Pixi's global pools to the game's live renderer", async () => {
  const overview = await createOverviewCanvas();

  overview.dispose();

  expect(destroy.mock.calls).toEqual([[{ removeView: true }]]);
});
