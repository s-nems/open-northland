import { describe, expect, it } from 'vitest';
import { progressionRulesEntity } from '../../src/components/index.js';
import { Simulation } from '../../src/index.js';
import { testContent } from '../fixtures/content.js';

/** The `setProfessionProgression` command through the real command path: the `ProgressionRules`
 *  singleton is created on first use, read back through the Simulation probe, and stays absent on a
 *  world that never issues the command (so untouched command streams keep their golden hashes). */
describe('setProfessionProgression — the rules command and its default', () => {
  it('defaults to enabled with NO singleton entity (an untouched stream keeps its hash)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    sim.run(5);
    expect(sim.professionProgressionEnabled()).toBe(true);
    expect(progressionRulesEntity(sim.world)).toBeNull(); // absent = default, not a stored `true`
  });

  it('flips the probe through the command seam and back', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    sim.enqueue({ kind: 'setProfessionProgression', enabled: false });
    sim.step();
    expect(sim.professionProgressionEnabled()).toBe(false);
    sim.enqueue({ kind: 'setProfessionProgression', enabled: true });
    sim.step();
    expect(sim.professionProgressionEnabled()).toBe(true);
    expect(progressionRulesEntity(sim.world)).not.toBeNull(); // re-enabling keeps the singleton
  });

  it('replays deterministically: same seed and commands produce the same state hash', () => {
    const run = (): string => {
      const sim = new Simulation({ seed: 7, content: testContent() });
      sim.enqueue({ kind: 'setProfessionProgression', enabled: false });
      sim.run(10);
      return sim.hashState();
    };
    expect(run()).toBe(run());
  });
});
