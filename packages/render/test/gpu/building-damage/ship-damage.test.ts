import { describe, expect, it } from 'vitest';
import type { DamageOrigin } from '../../../src/gpu/building-damage/effects.js';
import { deckFiresOf, emptyHullBox, placeDeckFires } from '../../../src/gpu/building-damage/ship-damage.js';

const W = 100;
const H = 100;
const ALPHA = 3;

/** An RGBA frame whose `[x0, x1)` columns are drawn on the given row spans. */
function frame(spans: readonly (readonly [number, number])[], x0 = 0, x1 = W): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(W * H * 4);
  for (const [top, bottom] of spans)
    for (let y = top; y <= bottom; y++) for (let x = x0; x < x1; x++) pixels[(y * W + x) * 4 + ALPHA] = 255;
  return pixels;
}

describe('deck fires', () => {
  it('stand part way up the side of the hull, not on a keel tip under it', () => {
    const plain = deckFiresOf(frame([[60, 79]]), W, H, ALPHA);
    const keeled = deckFiresOf(
      frame([
        [60, 79],
        [95, 97],
      ]),
      W,
      H,
      ALPHA,
    );
    expect(plain?.[1]).toBeGreaterThan(0.6);
    expect(plain?.[1]).toBeLessThan(0.79);
    expect(keeled?.[1]).toBe(plain?.[1]);
  });

  it('stay low on a hull whose column runs on up into the mast', () => {
    const fires = deckFiresOf(frame([[0, 89]]), W, H, ALPHA);
    expect(fires?.[1]).toBeGreaterThan(0.6);
  });

  it('are not placed on a frame with an empty fire column', () => {
    expect(deckFiresOf(frame([[60, 79]], 0, 30), W, H, ALPHA)).toBeNull();
  });

  it('lean with the roll and go down with a sinking hull, never under its waterline', () => {
    const box = { ...emptyHullBox(), left: -50, top: -80, width: 100, height: 100, fires: [0.5, 0.5] };
    const origins: DamageOrigin[] = [];
    placeDeckFires(origins, box);
    expect(origins).toMatchObject([{ x: 0, y: -30 }]);
    placeDeckFires(origins, { ...box, shear: 0.1 });
    expect(origins[0]?.x).toBeCloseTo(-3);
    placeDeckFires(origins, box, 500);
    expect(origins[0]?.y).toBe(20);
  });
});
