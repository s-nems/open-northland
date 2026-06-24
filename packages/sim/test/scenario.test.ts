import { describe, expect, it } from 'vitest';
import { Simulation, scenario } from '../src/index.js';
import { testContent } from './fixtures/content.js';

/**
 * INTEGRATION + GAME-LEVEL (e2e) examples. These run the whole deterministic sim headless via the
 * scenario harness — the layer an agent uses to self-validate game behavior without a screen.
 * Today the systems are stubs, so these assert the harness + determinism + invariants hold; as
 * systems land, the `expect(...)` predicates become real economy assertions. See docs/TESTING.md.
 */

describe('content loads and validates', () => {
  it('test fixture passes schema + cross-reference validation', () => {
    const content = testContent();
    expect(content.buildings.length).toBeGreaterThan(0);
    expect(content.goods.find((g) => g.id === 'wood')).toBeDefined();
  });
});

describe('integration: deterministic over many ticks', () => {
  it('two sims with same seed produce identical state hashes', () => {
    const content = testContent();
    const a = new Simulation({ seed: 7, content });
    const b = new Simulation({ seed: 7, content });
    a.run(500);
    b.run(500);
    expect(a.hashState()).toBe(b.hashState());
  });

  it('a different seed is allowed to diverge (sanity: RNG is actually wired)', () => {
    const content = testContent();
    const a = new Simulation({ seed: 1, content });
    const b = new Simulation({ seed: 2, content });
    a.run(50);
    b.run(50);
    // RNG state differs even if no system consumes it yet.
    expect(a.rng.getState()).not.toBe(b.rng.getState());
  });
});

describe('e2e game-level: scenario harness', () => {
  it('core invariants hold every tick of a 1000-tick run', () => {
    const result = scenario(testContent(), 42).run(1000, { checkInvariantsEachTick: true });
    expect(result.invariantViolations).toEqual([]);
    result.assertOk();
  });

  it('scenario.expect reports a readable failure', () => {
    const result = scenario(testContent())
      .run(10)
      .expect('impossible: 5 < 0', () => 5 < 0);
    expect(result.failures).toContain('expectation failed: impossible: 5 < 0');
  });

  // TODO(Phase 2): once CommandSystem + the slice systems exist, assert real outcomes, e.g.:
  //   scenario(content)
  //     .placeBuilding('headquarters', 10, 10).spawnSettler('woodcutter')
  //     .run(2000, { checkInvariantsEachTick: true })
  //     .expect('produced planks', (sim) => totalGood(sim, PLANK) > 0)
  //     .assertOk();
});
