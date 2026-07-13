import { describe, expect, it } from 'vitest';
import { Settler } from '../../../../src/components/index.js';
import { fx, Simulation } from '../../../../src/index.js';
import { atomicSystem } from '../../../../src/systems/index.js';
import {
  combatCadenceContent,
  ctxOf,
  fighterAt,
  grass,
  OTHER,
  SOLDIER_SPEAR,
  startSwing,
  VIKING,
  WOMAN,
} from '../support.js';

describe('atomicSystem — the attacker pays the swing need-drain on completion', () => {
  it('a soldier swing drains rest + hunger by the animation deltas (−20 each → same bar rise)', () => {
    const sim = new Simulation({ seed: 1, content: combatCadenceContent(), map: grass(3, 1) });
    const attacker = fighterAt(sim, 0, 0, VIKING, SOLDIER_SPEAR);
    const target = fighterAt(sim, 1, 0, OTHER, null, { hitpoints: 10_000 });
    startSwing(sim, attacker, { target, damage: 0, hitAt: 17 }, 27);

    for (let i = 0; i < 27; i++) atomicSystem(sim.world, ctxOf(sim)); // run to completion

    // −20 on the ~10000-unit reserve → +20/10000·ONE on the 0..ONE need bar (the reserve drain raises the need).
    const expected = fx.div(fx.fromInt(20), fx.fromInt(10_000));
    expect(sim.world.get(attacker, Settler).fatigue).toBe(expected);
    expect(sim.world.get(attacker, Settler).hunger).toBe(expected);
  });

  it('a woman swing drains 5× as much (−100 each) — the relative magnitude is faithful', () => {
    const sim = new Simulation({ seed: 1, content: combatCadenceContent(), map: grass(3, 1) });
    const attacker = fighterAt(sim, 0, 0, VIKING, WOMAN);
    const target = fighterAt(sim, 1, 0, OTHER, null, { hitpoints: 10_000 });
    startSwing(sim, attacker, { target, damage: 0, hitAt: 6 }, 16);

    for (let i = 0; i < 16; i++) atomicSystem(sim.world, ctxOf(sim));

    const soldierRise = fx.div(fx.fromInt(20), fx.fromInt(10_000));
    const womanRise = fx.div(fx.fromInt(100), fx.fromInt(10_000));
    expect(sim.world.get(attacker, Settler).fatigue).toBe(womanRise);
    expect(womanRise).toBe(soldierRise * 5); // a woman's swing costs 5× a soldier's — the data ratio
  });
});
