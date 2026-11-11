import { ONE, type WorldSnapshot } from '@open-northland/sim';
import type { Sprite } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { type TempleGlowFrame, TempleGlowLayer } from '../../../src/gpu/overlays/temple-glow-layer.js';
import { drawnGeometry } from '../../support/fixtures.js';

const BLESSING = 1;
const DARK = 2;
const VIEW = { minX: -1000, maxX: 1000, minY: -1000, maxY: 1000 };
const ANCHOR = { x: 40, y: 30 };
const BOUNDS = { minX: 0, minY: -60, maxX: 80, maxY: 50 };

function temple(id: number, blessing: boolean) {
  return {
    id,
    components: { Position: { x: ONE, y: ONE }, TempleFire: { burnedSeconds: 0, blessing } },
  };
}

const snapshot: WorldSnapshot = {
  tick: 0,
  events: [],
  entities: [temple(BLESSING, true), temple(DARK, false)],
};

function frame(fogVisible?: () => boolean): TempleGlowFrame {
  return {
    snapshot,
    drawn: drawnGeometry({ anchorOf: () => ANCHOR, boundsOf: () => BOUNDS }),
    viewport: VIEW,
    fogVisible,
    seconds: 0,
  };
}

describe('TempleGlowLayer', () => {
  it('glows on the ground before a blessing temple alone', () => {
    const layer = new TempleGlowLayer();
    layer.draw(frame());
    const glows = layer.container.children as Sprite[];
    expect(glows).toHaveLength(1);
    expect(glows[0]?.position).toMatchObject({
      x: (BOUNDS.minX + BOUNDS.maxX) / 2,
      y: (ANCHOR.y + BOUNDS.maxY) / 2,
    });
    expect(glows[0]?.alpha).toBeGreaterThan(0);
  });

  it('shows no glow on a temple the viewer does not see', () => {
    const layer = new TempleGlowLayer();
    layer.draw(frame());
    layer.draw(frame(() => false));
    expect(layer.container.children).toHaveLength(0);
  });
});
