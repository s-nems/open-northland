import { ONE, type WorldSnapshot } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { TEMPLE_MOTES } from '../../../src/data/scene/temple-glow.js';
import { type TempleGlowFrame, TempleGlowLayer } from '../../../src/gpu/overlays/temple-glow-layer.js';
import { drawnGeometry } from '../../support/fixtures.js';
import { useHeadlessShaderContext } from '../../support/shader-context.js';

const BLESSING = 1;
const DARK = 2;
const VIEW = { minX: -1000, maxX: 1000, minY: -1000, maxY: 1000 };
const BOUNDS = { minX: 0, minY: -60, maxX: 80, maxY: 50 };
/** Longer than the aura takes to rise or die. */
const KINDLED_SECONDS = 10;
const STEP_SECONDS = 0.1;

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

function frame(seconds: number, seams: Partial<TempleGlowFrame> = {}): TempleGlowFrame {
  return {
    snapshot,
    drawn: drawnGeometry({ boundsOf: () => BOUNDS }),
    viewport: VIEW,
    seconds,
    motes: true,
    ...seams,
  };
}

/** Draw every frame up to `until`, so the aura kindles or dies as the clock runs. */
function run(layer: TempleGlowLayer, until: number, seams: Partial<TempleGlowFrame> = {}): void {
  for (let seconds = 0; seconds <= until; seconds += STEP_SECONDS) layer.draw(frame(seconds, seams));
}

describe('TempleGlowLayer', () => {
  useHeadlessShaderContext();

  it('spreads the aura from the wall line of a blessing temple alone', () => {
    const layer = new TempleGlowLayer();
    run(layer, KINDLED_SECONDS);
    expect(layer.container.children).toHaveLength(1);
    const aura = layer.container.children[0];
    const halfWidth = (BOUNDS.maxX - BOUNDS.minX) / 2;
    expect(aura?.position.x).toBe((BOUNDS.minX + BOUNDS.maxX) / 2);
    // Centred behind the temple's lowest row, on the house and not before it.
    expect(aura?.position.y).toBeLessThan(BOUNDS.maxY);
    expect(aura?.position.y).toBeGreaterThan(BOUNDS.maxY - halfWidth);
    expect(aura?.scale.x).toBeGreaterThan(halfWidth);
    expect(aura?.alpha).toBeGreaterThan(0);
    expect(layer.motes.children).toHaveLength(TEMPLE_MOTES);
  });

  it('kindles the aura over time and lets it die on a temple the viewer stops seeing', () => {
    const layer = new TempleGlowLayer();
    layer.draw(frame(0));
    expect(layer.container.children[0]?.alpha).toBe(0);
    run(layer, KINDLED_SECONDS);
    expect(layer.container.children[0]?.alpha).toBeGreaterThan(0);
    run(layer, KINDLED_SECONDS, { fogVisible: () => false });
    expect(layer.container.children).toHaveLength(0);
    expect(layer.motes.children).toHaveLength(0);
  });

  it('drops the motes where the view asks', () => {
    const layer = new TempleGlowLayer();
    run(layer, KINDLED_SECONDS, { motes: false });
    expect(layer.motes.children.some((mote) => mote.visible)).toBe(false);
  });
});
