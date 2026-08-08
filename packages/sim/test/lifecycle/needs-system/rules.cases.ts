import { describe, expect, it } from 'vitest';
import * as components from '../../../src/components/index.js';
import { Settler, setNeedsEnabled } from '../../../src/components/index.js';
import { fx, Simulation } from '../../../src/index.js';
import {
  chargeMilitaryPiety,
  HUNGER_RISE_PER_TICK,
  PIETY_PER_MILITARY_CYCLE,
} from '../../../src/systems/index.js';
import { testContent } from '../../fixtures/content.js';
import { settlerWithHunger } from './support.js';

describe('needsSystem - the setNeedsEnabled world rule (the dev/admin toggle)', () => {
  it('freezes every need while disabled and resumes on re-enable', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = settlerWithHunger(sim, fx.fromInt(0));

    sim.enqueueSetup({ kind: 'setNeedsEnabled', enabled: false });
    for (let i = 0; i < 50; i++) sim.step();
    const frozen = sim.world.get(e, Settler);
    expect(frozen.hunger).toBe(fx.fromInt(0));
    expect(frozen.fatigue).toBe(fx.fromInt(0));
    expect(frozen.piety).toBe(fx.fromInt(0));
    expect(frozen.enjoyment).toBe(fx.fromInt(0));

    sim.enqueueSetup({ kind: 'setNeedsEnabled', enabled: true });
    sim.step(); // the toggle applies (commandSystem) before needsSystem the same tick
    expect(sim.world.get(e, Settler).hunger).toBe(HUNGER_RISE_PER_TICK);
    expect(sim.checkInvariants()).toEqual([]);
  });

  it('refuses the forge piety charge while disabled, so nothing sends a smith off to pray', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = settlerWithHunger(sim, fx.fromInt(0));

    setNeedsEnabled(sim.world, false);
    chargeMilitaryPiety(sim.world, e);
    expect(sim.world.get(e, Settler).piety).toBe(fx.fromInt(0));

    setNeedsEnabled(sim.world, true);
    chargeMilitaryPiety(sim.world, e);
    expect(sim.world.get(e, Settler).piety).toBe(PIETY_PER_MILITARY_CYCLE);
  });

  it('reuses the one WorldRules singleton across repeated toggles', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    sim.enqueueSetup({ kind: 'setNeedsEnabled', enabled: false });
    sim.step();
    sim.enqueueSetup({ kind: 'setNeedsEnabled', enabled: true });
    sim.enqueueSetup({ kind: 'setNeedsEnabled', enabled: false });
    sim.step();
    expect([...sim.world.query(components.WorldRules)]).toHaveLength(1);
    expect(components.needsEnabled(sim.world)).toBe(false);
  });
});
