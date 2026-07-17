import { describe, expect, it } from 'vitest';
import { CurrentAtomic, Health } from '../../../../src/components/index.js';
import { Simulation } from '../../../../src/index.js';
import { atomicSystem, combatSystem, WEAPON_MAIN_TYPE } from '../../../../src/systems/index.js';
import {
  combatCadenceContent,
  ctxOf,
  fighterAt,
  fighterAtNode,
  grass,
  OTHER,
  SOLDIER_SABER,
  SOLDIER_SPEAR,
  startSwing,
  VIKING,
} from '../support.js';

describe('combatSystem — the swing carries the ATTACK-event hit-frame + the weapon class', () => {
  it('stamps hitAt from the animation ATTACK event and weaponMainType from the weapon', () => {
    const sim = new Simulation({ seed: 1, content: combatCadenceContent(), map: grass(3, 1) });
    const spearman = fighterAt(sim, 0, 0, VIKING, SOLDIER_SPEAR);
    fighterAt(sim, 1, 0, OTHER, null);
    combatSystem(sim.world, ctxOf(sim));
    // iron spear: ATTACK @17 of the 27-frame swing, weapon class SPEAR.
    expect(sim.world.get(spearman, CurrentAtomic).effect).toMatchObject({
      hitAt: 17,
      weaponMainType: WEAPON_MAIN_TYPE.SPEAR,
    });
    expect(sim.world.get(spearman, CurrentAtomic).duration).toBe(27);
  });

  it('omits hitAt when the attack animation carries no ATTACK event (falls back to completion)', () => {
    const sim = new Simulation({ seed: 1, content: combatCadenceContent(), map: grass(3, 1) });
    const saberer = fighterAt(sim, 0, 0, VIKING, SOLDIER_SABER); // saber animation has no `event <f> 25`
    fighterAtNode(sim, 1, 0, OTHER, null); // 1 node away — the saber's whole reach band is [1, 1]
    combatSystem(sim.world, ctxOf(sim));
    const effect = sim.world.get(saberer, CurrentAtomic).effect;
    expect('hitAt' in effect).toBe(false); // no ATTACK event -> no hitAt -> executor uses completion
    expect(effect).toMatchObject({ weaponMainType: WEAPON_MAIN_TYPE.SABER });
  });
});

describe('atomicSystem — the blow lands at the ATTACK-event frame, not at completion', () => {
  it('drains the target exactly once, at the ATTACK frame mid-animation', () => {
    const sim = new Simulation({ seed: 1, content: combatCadenceContent(), map: grass(3, 1) });
    const attacker = fighterAt(sim, 0, 0, VIKING, SOLDIER_SPEAR);
    const target = fighterAt(sim, 1, 0, OTHER, null, { hitpoints: 10_000 });
    startSwing(sim, attacker, { target, damage: 2090, hitAt: 17 }, 27);

    // Frames 1..16: the swing is winding up — the target is untouched.
    for (let i = 0; i < 16; i++) atomicSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(target, Health).hitpoints).toBe(10_000);

    // Frame 17: the blow lands.
    atomicSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(target, Health).hitpoints).toBe(10_000 - 2090);

    // Frames 18..27 (follow-through): no second hit, and the swing completes at 27 (attacker freed).
    for (let i = 0; i < 10; i++) atomicSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(target, Health).hitpoints).toBe(10_000 - 2090); // still one blow only
    expect(sim.world.has(attacker, CurrentAtomic)).toBe(false); // completed
  });

  it('falls back to the completion frame when the swing carries no hitAt', () => {
    const sim = new Simulation({ seed: 1, content: combatCadenceContent(), map: grass(3, 1) });
    const attacker = fighterAt(sim, 0, 0, VIKING, SOLDIER_SABER);
    const target = fighterAt(sim, 1, 0, OTHER, null, { hitpoints: 10_000 });
    startSwing(sim, attacker, { target, damage: 400 }, 4); // no hitAt -> resolve at completion (frame 4)

    for (let i = 0; i < 3; i++) atomicSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(target, Health).hitpoints).toBe(10_000); // untouched until the last frame

    atomicSystem(sim.world, ctxOf(sim)); // frame 4 = completion
    expect(sim.world.get(target, Health).hitpoints).toBe(10_000 - 400);
    expect(sim.world.has(attacker, CurrentAtomic)).toBe(false);
  });
});

describe('atomicSystem — repeating swings at the animation cadence', () => {
  it('a survivor is re-struck one animation-length apart (cadence IS the swing length)', () => {
    const sim = new Simulation({ seed: 1, content: combatCadenceContent(), map: grass(3, 1) });
    fighterAt(sim, 0, 0, VIKING, SOLDIER_SPEAR); // spear: 27-frame swing, ATTACK @17
    const target = fighterAt(sim, 1, 0, OTHER, null, { hitpoints: 1_000_000 });

    const hitTicks: number[] = [];
    let prevHp = sim.world.get(target, Health).hitpoints;
    for (let tick = 1; tick <= 60; tick++) {
      sim.step();
      const hp = sim.world.get(target, Health).hitpoints;
      if (hp < prevHp) hitTicks.push(tick);
      prevHp = hp;
    }

    expect(hitTicks.length).toBeGreaterThanOrEqual(2);
    // Consecutive blows land exactly one swing (27 ticks) apart — the cadence is the animation length,
    // no invented cooldown.
    const firstHit = hitTicks[0];
    const secondHit = hitTicks[1];
    if (firstHit === undefined || secondHit === undefined) throw new Error('expected two hits');
    expect(secondHit - firstHit).toBe(27);
    // Each blow took a full spear-vs-unarmored column (3800) off the pool.
    expect(1_000_000 - sim.world.get(target, Health).hitpoints).toBe(3800 * hitTicks.length);
  });
});
