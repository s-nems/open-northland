import { ONE, type WorldSnapshot } from '@open-northland/sim';
import type { Sprite } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { type TempleGlowFrame, TempleGlowLayer } from '../../../src/gpu/overlays/temple-glow-layer.js';
import { drawnGeometry } from '../../support/fixtures.js';

const BLESSING = 1;
const DARK = 2;
const VIEW = { minX: -1000, maxX: 1000, minY: -1000, maxY: 1000 };
const ANCHOR = { x: 40, y: 30 };
const ELLIPSE = { cx: 4, cy: -2, rx: 50, ry: 25 };

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
    drawn: drawnGeometry({ anchorOf: () => ANCHOR, selectionOf: () => ELLIPSE }),
    viewport: VIEW,
    fogVisible,
    seconds: 0,
  };
}

describe('TempleGlowLayer', () => {
  it('glows on the ground ellipse of a blessing temple alone', () => {
    const layer = new TempleGlowLayer();
    layer.draw(frame());
    const glows = layer.container.children as Sprite[];
    expect(glows).toHaveLength(1);
    expect(glows[0]?.position).toMatchObject({ x: ANCHOR.x + ELLIPSE.cx, y: ANCHOR.y + ELLIPSE.cy });
    expect(glows[0]?.alpha).toBeGreaterThan(0);
  });

  it('shows no glow on a temple the viewer does not see', () => {
    const layer = new TempleGlowLayer();
    layer.draw(frame());
    layer.draw(frame(() => false));
    expect(layer.container.children).toHaveLength(0);
  });
});
