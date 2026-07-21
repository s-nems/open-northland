import type { Container } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import {
  DAMAGE_SMOKE_STEP,
  damageSmokeEmitters,
  EMITTER_WEDGE,
  emitterSpot,
  MAX_SMOKE_EMITTERS,
  SMOKE_PUFF_PERIOD_TICKS,
  SMOKE_RISE_PX,
  smokePuff,
} from '../src/data/effects/index.js';
import { readHpFraction } from '../src/data/scene/snapshot-readers/index.js';
import { DamageSmokeLayer } from '../src/gpu/overlays/damage-smoke-layer.js';
import type { DrawnGeometry } from '../src/gpu/sprite-pool/index.js';

/**
 * Damage smoke is a pure function of a building's CURRENT HP fraction: each fifth of the pool lost adds a
 * seeded roof plume, and an HP rise (repair, an upgrade refill) sheds them again with no event wiring.
 * The puff motion is tick-driven and seeded — reproducible for a `?shot`, distinct across emitters.
 */

describe('damageSmokeEmitters — one plume per damage step, shed on repair', () => {
  it('steps 0→max as the pool drains, and back down as it refills', () => {
    expect(damageSmokeEmitters(1)).toBe(0); // pristine
    expect(damageSmokeEmitters(1 - DAMAGE_SMOKE_STEP + 0.01)).toBe(0); // just under the first threshold
    expect(damageSmokeEmitters(1 - DAMAGE_SMOKE_STEP)).toBe(1); // first threshold crossed
    expect(damageSmokeEmitters(0.5)).toBe(2); // half the pool gone
    expect(damageSmokeEmitters(0)).toBe(MAX_SMOKE_EMITTERS); // rubble-to-be, capped
    // The "repair removes the puffs" rule IS this purity: a higher fraction simply maps to fewer plumes.
    expect(damageSmokeEmitters(0.9)).toBeLessThan(damageSmokeEmitters(0.3));
  });
});

describe('readHpFraction — the snapshot read driving the smoke', () => {
  it('reads a damaged finished building, and stays absent for undamaged / under-construction ones', () => {
    const ONE = 65536; // the sim fixed-point ONE (Building.built is a 0..ONE fraction)
    expect(readHpFraction({ Health: { hitpoints: 250, max: 1000 } })).toBeCloseTo(0.25);
    expect(readHpFraction({ Health: { hitpoints: 1000, max: 1000 } })).toBeUndefined(); // undamaged
    expect(
      readHpFraction({ Health: { hitpoints: 250, max: 1000 }, Building: { built: ONE / 2 } }),
    ).toBeUndefined(); // a site's pool ramps with the build — it must not smoke
    expect(readHpFraction({})).toBeUndefined();
    expect(readHpFraction({ Health: { hitpoints: 1, max: 0 } })).toBeUndefined(); // malformed
  });
});

describe('smokePuff — deterministic rising, swelling, thinning loop', () => {
  it('is reproducible and varies per emitter', () => {
    expect(smokePuff(7, 0, 0, 12)).toEqual(smokePuff(7, 0, 0, 12));
    expect(smokePuff(7, 0, 0, 12)).not.toEqual(smokePuff(7, 1, 0, 12));
  });

  it('rises and swells over its loop, staying between the emitter and the rise top', () => {
    // Walk one full period: y stays within [−RISE, 0], the radius tracks the rise (bigger higher up),
    // and the loop wraps exactly once (a fresh puff re-born at the emitter).
    let wraps = 0;
    let prev = smokePuff(0, 0, 0, 0);
    for (let t = 1; t <= SMOKE_PUFF_PERIOD_TICKS; t++) {
      const cur = smokePuff(0, 0, 0, t);
      expect(cur.y).toBeLessThanOrEqual(0);
      expect(cur.y).toBeGreaterThanOrEqual(-SMOKE_RISE_PX);
      expect(cur.alpha).toBeGreaterThanOrEqual(0);
      if (cur.y > prev.y + 1e-9) {
        wraps++;
      } else {
        expect(cur.radius).toBeGreaterThanOrEqual(prev.radius); // swells as it rises
      }
      prev = cur;
    }
    expect(wraps).toBe(1);
  });

  it('seeds emitter spots inside the roof band and keeps them stable across frames', () => {
    for (let e = 0; e < MAX_SMOKE_EMITTERS; e++) {
      const spot = emitterSpot(42, e);
      expect(spot).toEqual(emitterSpot(42, e)); // no per-frame jitter
      expect(spot.u).toBeGreaterThan(0);
      expect(spot.u).toBeLessThan(1);
      expect(spot.v).toBeGreaterThanOrEqual(0);
      expect(spot.v).toBeLessThanOrEqual(0.5); // the upper (roof) part of the sprite box
    }
  });

  it("spreads each building's emitters across distinct roof bands, so every step reads as a new spot", () => {
    // Stratified placement: emitters own disjoint horizontal bands, so the worst-case pair still has a
    // visible gap — the plume count works as a damage gauge instead of clumping into one cloud.
    for (const seed of [1, 42, 1337, 65535]) {
      const us = Array.from({ length: MAX_SMOKE_EMITTERS }, (_, e) => emitterSpot(seed, e).u).sort(
        (a, b) => a - b,
      );
      let prev = -1; // sentinel below the 0..1 range, so the first gap always passes
      for (const u of us) {
        expect(u - prev).toBeGreaterThan(0.05);
        prev = u;
      }
    }
  });

  it('pins every spot to the centered roof wedge, never in an empty bounds-box corner', () => {
    // Off-center spots must sit at or below the wedge's roof line — a sprite narrows toward its top,
    // so a high spot far from the center line would smoke from the air beside the roof.
    for (const seed of [1, 42, 1337, 65535]) {
      for (let e = 0; e < MAX_SMOKE_EMITTERS; e++) {
        const { u, v } = emitterSpot(seed, e);
        const centerOffset = Math.abs(u - 0.5) / EMITTER_WEDGE.halfSpread;
        expect(v).toBeGreaterThanOrEqual(EMITTER_WEDGE.topV + EMITTER_WEDGE.slope * centerOffset - 1e-9);
      }
    }
  });
});

describe('DamageSmokeLayer', () => {
  const bounds = { minX: -20, minY: -60, maxX: 20, maxY: 0 };
  const drawn: DrawnGeometry = { boundsOf: () => bounds, anchorOf: () => undefined };

  it('shows one plume per crossed damage step and sheds them when HP rises', () => {
    const layer = new DamageSmokeLayer();
    layer.draw([{ ref: 5, hpFrac: 0.5 }], drawn, 0);
    expect(layer.container.children).toHaveLength(1);
    const node = layer.container.children[0] as Container;
    const visiblePlumes = () => (node.children as Container[]).filter((c) => c.visible).length;
    expect(visiblePlumes()).toBe(2); // half the pool gone → two plumes

    layer.draw([{ ref: 5, hpFrac: 0.1 }], drawn, 1);
    expect(visiblePlumes()).toBe(MAX_SMOKE_EMITTERS); // battered → full smoke

    layer.draw([{ ref: 5, hpFrac: 0.9 }], drawn, 2);
    expect(layer.container.children).toHaveLength(0); // repaired above the first threshold — retired
  });

  it('retires the node when the building leaves the damaged list (razed or scrolled out)', () => {
    const layer = new DamageSmokeLayer();
    layer.draw([{ ref: 5, hpFrac: 0.2 }], drawn, 0);
    expect(layer.container.children).toHaveLength(1);
    layer.draw([], drawn, 1);
    expect(layer.container.children).toHaveLength(0);
  });
});
