import { describe, expect, it } from 'vitest';
import { Simulation, scenario } from '../../src/index.js';
import { testContent } from '../fixtures/content.js';
import { grassNodeMap } from '../fixtures/terrain.js';

const WOODCUTTER = 1;
const VIKING = 1;

/**
 * INTEGRATION + GAME-LEVEL (e2e) examples. These run the whole deterministic sim headless via the
 * scenario harness — the layer an agent uses to self-validate game behavior without a screen.
 * These smoke tests prove long-run determinism, invariant checking, and readable scenario failures;
 * mechanic-specific outcomes live beside their systems and in acceptance scenes. See docs/TESTING.md.
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

  it('the seed reaches component state, not just the hashed RNG word', () => {
    // A settler's starting needs are rolled off the RNG (`NEED_INIT_MAX_DEFICIT_PERCENT`), so spawning
    // one is what makes a run consume the stream at all — a bare sim never draws, and `hashState` mixes
    // the RNG word in, so comparing seeds without a draw only ever compares the seeds themselves.
    const runWithSeed = (seed: number): Simulation => {
      const sim = new Simulation({ seed, content: testContent(), map: grassNodeMap(5, 1) });
      sim.enqueue({ kind: 'spawnSettler', jobType: WOODCUTTER, x: 0, y: 0, tribe: VIKING });
      sim.run(50);
      return sim;
    };
    const a = runWithSeed(1);
    const b = runWithSeed(2);

    expect(a.rng.getState()).not.toBe(1); // the stream advanced: the sim really drew from it
    const needsOf = (sim: Simulation) => {
      const settler = sim.snapshot().entities.find((e) => e.components.Settler !== undefined);
      return settler?.components.Settler as { hunger: number; fatigue: number } | undefined;
    };
    const [na, nb] = [needsOf(a), needsOf(b)];
    expect(na).toBeDefined();
    expect(nb).toBeDefined();
    expect([na?.hunger, na?.fatigue]).not.toEqual([nb?.hunger, nb?.fatigue]);
  });
});

describe('e2e game-level: scenario harness', () => {
  it('core invariants hold every tick of a 1000-tick run', () => {
    const result = scenario(testContent(), { seed: 42 }).run(1000, { checkInvariantsEachTick: true });
    expect(result.invariantViolations).toEqual([]);
    result.assertOk();
  });

  it('scenario.expect reports a readable failure', () => {
    const result = scenario(testContent())
      .run(10)
      .expect('impossible: 5 < 0', () => 5 < 0);
    expect(result.failures).toContain('expectation failed: impossible: 5 < 0');
  });

  it('scenario.expect works when destructured off the result (closes over the run, not `this`)', () => {
    const result = scenario(testContent()).run(2);
    const { expect: expectOn } = result;
    expectOn('sim reached tick 2', (sim) => sim.tick === 2);
    result.assertOk();
  });
});
