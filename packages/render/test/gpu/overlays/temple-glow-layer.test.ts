import { ONE, type WorldSnapshot } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
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
/** How many times a kindled aura outshines its first frame, at the least. */
const RISE_FACTOR = 4;

function temple(id: number, blessing: boolean) {
  return {
    id,
    components: { Position: { x: ONE, y: ONE }, TempleFire: { burnedSeconds: 0, blessing } },
  };
}

function world(blessing: boolean): WorldSnapshot {
  return { tick: 0, events: [], entities: [temple(BLESSING, blessing), temple(DARK, false)] };
}

function frame(seconds: number, seams: Partial<TempleGlowFrame> = {}): TempleGlowFrame {
  return {
    snapshot: world(true),
    drawn: drawnGeometry({ boundsOf: () => BOUNDS }),
    viewport: VIEW,
    seconds,
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
  });

  it('kindles the aura when its temple starts blessing and lets it die when it stops', () => {
    const layer = new TempleGlowLayer();
    layer.draw(frame(0, { snapshot: world(false) }));
    expect(layer.container.children).toHaveLength(0);
    layer.draw(frame(STEP_SECONDS));
    const rising = layer.container.children[0]?.alpha ?? 1;
    run(layer, KINDLED_SECONDS);
    expect(layer.container.children[0]?.alpha).toBeGreaterThan(rising * RISE_FACTOR);
    layer.draw(frame(KINDLED_SECONDS + STEP_SECONDS, { snapshot: world(false) }));
    expect(layer.container.children).toHaveLength(1);
    run(layer, KINDLED_SECONDS, { snapshot: world(false) });
    expect(layer.container.children).toHaveLength(0);
  });

  it('shows a temple the viewer comes upon blessing whole, a held clock included, and drops one out of sight', () => {
    const layer = new TempleGlowLayer();
    layer.draw(frame(0, { fogVisible: () => false }));
    expect(layer.container.children).toHaveLength(0);
    layer.draw(frame(0));
    const whole = layer.container.children[0]?.alpha ?? 0;
    expect(whole).toBeGreaterThan(0);
    layer.draw(frame(0, { fogVisible: () => false }));
    expect(layer.container.children).toHaveLength(0);
  });
});
