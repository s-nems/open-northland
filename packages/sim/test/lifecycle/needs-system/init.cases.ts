import { describe, expect, it } from 'vitest';
import { Settler } from '../../../src/components/index.js';
import { Rng } from '../../../src/core/rng.js';
import { World } from '../../../src/ecs/world.js';
import { fx, ONE } from '../../../src/index.js';
import { createSettler } from '../../../src/systems/conflict/spawn/index.js';
import { NEED_INIT_MAX_DEFICIT_PERCENT, rollInitialNeed } from '../../../src/systems/index.js';
import { testContent } from '../../fixtures/content.js';

// A need is a deficit (0 = full bar, ONE = empty); a starting deficit of at most half a bar means the HUD
// opens at 50–100% satisfaction (`100 − deficit`).
const HALF = fx.div(ONE, fx.fromInt(2));
const VIKING = 1;
const IDLE_JOB = 0; // the idle sentinel — a valid createSettler input on any content

describe('rollInitialNeed — seeded random starting needs (50–100% satisfaction)', () => {
  it('never exceeds half a bar (deficit ≤ 50%) and is never negative', () => {
    const rng = new Rng(12345);
    for (let i = 0; i < 1000; i++) {
      const need = rollInitialNeed(rng);
      expect(need).toBeGreaterThanOrEqual(fx.fromInt(0));
      expect(need).toBeLessThanOrEqual(HALF);
    }
  });

  it('is deterministic for a given seed (same RNG state → same sequence)', () => {
    const a = new Rng(7);
    const b = new Rng(7);
    for (let i = 0; i < 20; i++) expect(rollInitialNeed(a)).toBe(rollInitialNeed(b));
  });

  it('varies across draws rather than pinning to one value', () => {
    const rng = new Rng(99);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) seen.add(rollInitialNeed(rng));
    expect(seen.size).toBeGreaterThan(10);
    expect(NEED_INIT_MAX_DEFICIT_PERCENT).toBe(50);
  });
});

describe('createSettler — every settler spawns with seeded random needs', () => {
  const spec = { jobType: IDLE_JOB, x: 0, y: 0, tribe: VIKING };

  it('seeds all four needs within [0, half a bar]', () => {
    const world = new World();
    const e = createSettler(world, testContent(), new Rng(3), spec);
    if (e === null) throw new Error('spawn failed');
    const s = world.get(e, Settler);
    for (const need of [s.hunger, s.fatigue, s.piety, s.enjoyment]) {
      expect(need).toBeGreaterThanOrEqual(fx.fromInt(0));
      expect(need).toBeLessThanOrEqual(HALF);
    }
  });

  it('is reproducible: same seed → identical needs on two independent worlds', () => {
    const wa = new World();
    const wb = new World();
    const ea = createSettler(wa, testContent(), new Rng(42), spec);
    const eb = createSettler(wb, testContent(), new Rng(42), spec);
    if (ea === null || eb === null) throw new Error('spawn failed');
    const a = wa.get(ea, Settler);
    const b = wb.get(eb, Settler);
    expect(a.hunger).toBe(b.hunger);
    expect(a.fatigue).toBe(b.fatigue);
    expect(a.piety).toBe(b.piety);
    expect(a.enjoyment).toBe(b.enjoyment);
  });
});
