import { describe, expect, it } from 'vitest';
import { AttackOrder, Health } from '../../../src/components/index.js';
import { Simulation } from '../../../src/index.js';
import { testContent } from '../../fixtures/content.js';
import { BEE, COW, fighterAt, grassMap, P0, VIKING, WOODCUTTER } from './support.js';

/**
 * The "Attack Animal" order: the original offers it to every adult man and to heroes, so an ordered
 * strike at a wild creature must survive the predation rule that keeps a non-hunter from picking prey
 * on its own. The decorative-fauna exemption is a property of the creature and still holds.
 */
describe('attackUnit - an ordered strike at wildlife', () => {
  it('keeps a plain woodcutter swinging at prey only a hunter would pick on its own', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const civilian = fighterAt(sim, 0, 0, VIKING, WOODCUTTER, { owner: P0 });
    const cow = fighterAt(sim, 1, 0, COW, null, { hitpoints: 1000 });

    sim.enqueueSetup({ kind: 'attackUnit', entity: civilian, target: cow });
    for (let i = 0; i < 20 && sim.world.get(cow, Health).hitpoints === 1000; i++) sim.step();

    expect(sim.world.has(civilian, AttackOrder)).toBe(true);
    expect(sim.world.get(cow, Health).hitpoints).toBeLessThan(1000);
  });

  it('still drops an order at a creature no one may attack', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const civilian = fighterAt(sim, 0, 0, VIKING, WOODCUTTER, { owner: P0 });
    const bee = fighterAt(sim, 1, 0, BEE, null);

    sim.enqueueSetup({ kind: 'attackUnit', entity: civilian, target: bee });
    sim.step();

    expect(sim.world.has(civilian, AttackOrder)).toBe(false);
  });
});
