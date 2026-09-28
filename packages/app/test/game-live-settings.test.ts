import { terrainWorldBounds } from '@open-northland/render';
import { describe, expect, it } from 'vitest';
import { minimapLayout } from '../src/hud/minimap/model.js';
import { perfCornerForUiScale } from '../src/view/runtime/game-live-settings.js';

describe('performance overlay placement', () => {
  it('clears every minimap size when the player changes size without changing UI scale', () => {
    const bounds = terrainWorldBounds(256, 256);
    for (const scale of [1, 1.5]) {
      const corner = perfCornerForUiScale(scale);
      for (const size of ['s', 'm', 'l', 'xl'] as const) {
        const panel = minimapLayout(bounds, 900, scale, size, 1600).panel;
        expect(corner.left).toBeGreaterThan(panel.x + panel.w);
      }
    }
  });
});
