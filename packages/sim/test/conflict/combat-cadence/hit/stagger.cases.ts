import { describe, expect, it } from 'vitest';
import { CurrentAtomic, Health } from '../../../../src/components/index.js';
import { Simulation } from '../../../../src/index.js';
import { atomicSystem } from '../../../../src/systems/index.js';
import {
  ATTACK_ATOMIC,
  ATTACKED_ATOMIC,
  combatCadenceContent,
  ctxOf,
  fighterAt,
  grass,
  OTHER,
  SOLDIER_SPEAR,
  SOLDIER_SWORD_SHORT,
  startSwing,
  VIKING,
  WOMAN,
} from '../support.js';

describe('atomicSystem — a struck civilian staggers (data-driven `82` ATTACKED atomic)', () => {
  it('gives a struck woman her 82 flinch (she has the setatomic 82 binding)', () => {
    const sim = new Simulation({ seed: 1, content: combatCadenceContent(), map: grass(3, 1) });
    const attacker = fighterAt(sim, 0, 0, VIKING, SOLDIER_SPEAR);
    const woman = fighterAt(sim, 1, 0, VIKING, WOMAN, { hitpoints: 10_000 }); // survives the blow
    startSwing(sim, attacker, { target: woman, damage: 2090, hitAt: 1 }, 27);

    atomicSystem(sim.world, ctxOf(sim)); // frame 1 = the blow lands

    const flinch = sim.world.get(woman, CurrentAtomic);
    expect(flinch.atomicId).toBe(ATTACKED_ATOMIC); // she is staggering
    expect(flinch.duration).toBe(50); // woman_attacked length
    expect(flinch.effect).toEqual({ kind: 'idle' }); // purely visual — no state mutation
  });

  it('does NOT stagger a struck soldier (no 82 binding for the soldier class)', () => {
    const sim = new Simulation({ seed: 1, content: combatCadenceContent(), map: grass(3, 1) });
    const attacker = fighterAt(sim, 0, 0, VIKING, SOLDIER_SPEAR);
    const soldier = fighterAt(sim, 1, 0, OTHER, SOLDIER_SWORD_SHORT, { hitpoints: 10_000 });
    startSwing(sim, attacker, { target: soldier, damage: 2090, hitAt: 1 }, 27);

    atomicSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(soldier, CurrentAtomic)).toBe(false); // soldiers don't flinch
  });

  it('does NOT re-stagger a victim already mid-uninterruptible-action', () => {
    const sim = new Simulation({ seed: 1, content: combatCadenceContent(), map: grass(3, 1) });
    const attacker = fighterAt(sim, 0, 0, VIKING, SOLDIER_SPEAR);
    const woman = fighterAt(sim, 1, 0, VIKING, WOMAN, { hitpoints: 10_000 });
    // The woman is mid-swing (her own attack 81, uninterruptible) — the blow must not cut it short.
    startSwing(sim, woman, { target: attacker, damage: 0 }, 100);
    startSwing(sim, attacker, { target: woman, damage: 2090, hitAt: 1 }, 27);

    atomicSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(woman, CurrentAtomic).atomicId).toBe(ATTACK_ATOMIC); // still her own swing, not a flinch
    expect(sim.world.get(woman, Health).hitpoints).toBe(10_000 - 2090); // but the blow still landed (damage applies)
  });
});
