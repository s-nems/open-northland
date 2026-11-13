import { describe, expect, it } from 'vitest';
import {
  ARC_DOTS,
  ARC_FRAME_PX,
  type ArcDot,
  arcDot,
  arcDotStrip,
} from '../../../src/data/effects/amulet-arcs.js';

const SEED = 7;
const dotAt = (time: number, arc: number, arcs: number, dot = 0): ArcDot => {
  const out: ArcDot = { x: 0, y: 0, scale: 0, alpha: 0, front: false };
  arcDot(time, SEED, arc, arcs, dot, out);
  return out;
};

describe('amulet arcs', () => {
  it('paints a dot over the wearer below the feet line and under it above', () => {
    for (let time = 0; time < 60; time++) {
      const head = dotAt(time, 0, 1);
      expect(head.front).toBe(head.y >= 0);
    }
  });

  it('spaces two arcs opposite each other on the ring', () => {
    const first = dotAt(12, 0, 2);
    const second = dotAt(12, 1, 2);
    expect(second.x).toBeCloseTo(-first.x);
    expect(second.y).toBeCloseTo(-first.y);
  });

  it('thins and fades the tail behind the head', () => {
    const head = dotAt(5, 0, 1);
    const tip = dotAt(5, 0, 1, ARC_DOTS - 1);
    expect(tip.scale).toBeLessThan(head.scale);
    expect(tip.alpha).toBeLessThan(head.alpha);
  });

  it('paints each colour a frame that is brightest in the middle and empty at the corner', () => {
    const RGBA = 4;
    const strip = arcDotStrip([0xff0000, 0x0000ff]);
    const width = ARC_FRAME_PX * 2;
    const texel = (frame: number, x: number, y: number) => {
      const at = (y * width + frame * ARC_FRAME_PX + x) * RGBA;
      return [...strip.subarray(at, at + RGBA)];
    };
    const middle = ARC_FRAME_PX / 2;
    expect(texel(0, 0, 0)[3]).toBe(0);
    expect(texel(0, middle, middle)[3]).toBe(255);
    // The middle is lightened toward white but keeps its colour's lead.
    const [r, , b] = texel(1, middle, middle);
    expect(b).toBe(255);
    expect(r).toBeGreaterThan(0);
    expect(r).toBeLessThan(255);
  });
});
