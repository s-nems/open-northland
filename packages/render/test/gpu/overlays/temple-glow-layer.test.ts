import { ONE, type WorldSnapshot } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { type TempleGlowFrame, TempleGlowLayer } from '../../../src/gpu/overlays/temple-glow-layer.js';
import { drawnGeometry } from '../../support/fixtures.js';
import { useHeadlessShaderContext } from '../../support/shader-context.js';

const BLESSING = 1;
const DARK = 2;
const VIEW = { minX: -1000, maxX: 1000, minY: -1000, maxY: 1000 };
const FEET = { x: 100, y: 200 };
/** Body cells on an even anchor row: centres 0, 68 and 34 px right of the anchor, the last a row of
 *  nodes up (38 px). */
const BODY = [
  { dx: 0, dy: 0 },
  { dx: 2, dy: 0 },
  { dx: 1, dy: -2 },
];
const BODY_CENTRE = { x: 34, y: -38 / 3 };
/** One row of body cells 68 px across, and one four times as wide. */
const NARROW_BODY = [
  { dx: 0, dy: 0 },
  { dx: 2, dy: 0 },
];
const WIDE_BODY = [
  { dx: 0, dy: 0 },
  { dx: 8, dy: 0 },
];
const WIDE_OVER_NARROW = 4;
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
    drawn: drawnGeometry({ anchorOf: () => FEET }),
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

  it('spreads the aura of a blessing temple alone from the centre of its body cells', () => {
    const layer = new TempleGlowLayer();
    layer.setHouseBodies(() => BODY);
    run(layer, KINDLED_SECONDS);
    expect(layer.container.children).toHaveLength(1);
    const aura = layer.container.children[0];
    expect(aura?.position.x).toBeCloseTo(FEET.x + BODY_CENTRE.x);
    expect(aura?.position.y).toBeCloseTo(FEET.y + BODY_CENTRE.y);
    expect(aura?.alpha).toBeGreaterThan(0);
  });

  it("grows a wider temple's aura, by less than the house is wider", () => {
    const rimOn = (body: typeof NARROW_BODY): number => {
      const layer = new TempleGlowLayer();
      layer.setHouseBodies(() => body);
      run(layer, KINDLED_SECONDS);
      return layer.container.children[0]?.scale.x ?? 0;
    };
    const narrow = rimOn(NARROW_BODY);
    const wide = rimOn(WIDE_BODY);
    expect(wide).toBeGreaterThan(narrow);
    expect(wide).toBeLessThan(narrow * WIDE_OVER_NARROW);
  });

  it('centres the aura of a temple whose body the content does not give on its feet', () => {
    const layer = new TempleGlowLayer();
    run(layer, KINDLED_SECONDS);
    expect(layer.container.children[0]?.position).toMatchObject(FEET);
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
