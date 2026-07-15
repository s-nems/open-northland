import { describe, expect, it } from 'vitest';
import { CurrentAtomic, MoveGoal, Position, Settler } from '../../../src/components/index.js';
import { fx, Simulation } from '../../../src/index.js';
import { combatSystem } from '../../../src/systems/index.js';
import { testContent } from '../../fixtures/content.js';

import {
  ATTACK_ATOMIC,
  ctxOf,
  FRANK,
  fighterAt,
  fighterAtNode,
  grassMap,
  VIKING,
  WOLVES,
  WOODCUTTER,
} from './support.js';

describe('combatSystem — target selection + issuing the attack atomic', () => {
  it('an idle combatant swings at the nearest enemy in range, with the resolved net damage', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const attacker = fighterAt(sim, 0, 0, VIKING, WOODCUTTER);
    const enemy = fighterAt(sim, 1, 0, FRANK, WOODCUTTER); // 2 nodes away — at the axe's maxRange 2

    combatSystem(sim.world, ctxOf(sim));

    const atomic = sim.world.get(attacker, CurrentAtomic);
    expect(atomic.atomicId).toBe(ATTACK_ATOMIC);
    expect(atomic.duration).toBe(4); // resolved via viking setatomic 81 -> viking_attack length 4
    expect(atomic.effect).toEqual({ kind: 'attack', target: enemy, damage: 50, maxRange: 2 }); // damage["0"], unarmored; melee reach carried for the hit-frame re-check
    expect(atomic.targetEntity).toBe(enemy);
  });

  it('does NOT target a same-tribe settler (friendly fire is off)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const attacker = fighterAt(sim, 0, 0, VIKING, WOODCUTTER);
    fighterAt(sim, 1, 0, VIKING, WOODCUTTER); // same tribe, adjacent — never a target

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(attacker, CurrentAtomic)).toBe(false);
  });

  it('does NOT swing at an enemy out of weapon range', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const attacker = fighterAt(sim, 0, 0, VIKING, WOODCUTTER);
    fighterAt(sim, 5, 0, FRANK, WOODCUTTER); // 10 nodes away — beyond maxRange 2

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(attacker, CurrentAtomic)).toBe(false);
  });

  it('picks the NEAREST enemy when several are in range, tie-broken by ascending entity id', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const attacker = fighterAt(sim, 1, 0, VIKING, WOODCUTTER); // node (2, 0)
    const far = fighterAt(sim, 2, 0, FRANK, WOODCUTTER); // 2 nodes away — in range
    const near = fighterAtNode(sim, 3, 0, FRANK, WOODCUTTER); // 1 node away — nearest

    combatSystem(sim.world, ctxOf(sim));

    void far;
    expect(sim.world.get(attacker, CurrentAtomic).effect).toMatchObject({ kind: 'attack', target: near });
  });

  it('a non-combatant settler (no Health) is never an attacker and never a target', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    // The attacker has Health; the "enemy" is a plain settler (no Health) — not a combatant.
    const attacker = fighterAt(sim, 0, 0, VIKING, WOODCUTTER);
    const civilian = sim.world.create();
    sim.world.add(civilian, Position, { x: fx.fromInt(1), y: fx.fromInt(0) });
    sim.world.add(civilian, Settler, {
      tribe: FRANK,
      jobType: WOODCUTTER,
      hunger: fx.fromInt(0),
      fatigue: fx.fromInt(0),
      piety: fx.fromInt(0),
      enjoyment: fx.fromInt(0),
      experience: new Map(),
    });

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(attacker, CurrentAtomic)).toBe(false); // no Health-bearing enemy to hit
  });

  it('a settler with no resolvable weapon (wrong job) does not attack', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    // job 2 (carpenter) has no weapon in the fixture (only tribe 1 / job 1 does).
    const unarmed = fighterAt(sim, 0, 0, VIKING, 2);
    fighterAt(sim, 1, 0, FRANK, WOODCUTTER); // an enemy in range, but the attacker is unarmed

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(unarmed, CurrentAtomic)).toBe(false);
  });

  it('skips a combatant already mid-swing or travelling', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const busy = fighterAt(sim, 0, 0, VIKING, WOODCUTTER);
    fighterAt(sim, 1, 0, FRANK, WOODCUTTER);
    sim.world.add(busy, MoveGoal, { cell: 4 }); // travelling — leave it to play out

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(busy, CurrentAtomic)).toBe(false);
  });

  it('a 0-HP attacker (dead, not yet reaped) gets no free swing', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const corpse = fighterAt(sim, 0, 0, VIKING, WOODCUTTER, 0); // hitpoints 0
    fighterAt(sim, 1, 0, FRANK, WOODCUTTER);

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(corpse, CurrentAtomic)).toBe(false);
  });

  it('does NOT target a recorded ANIMAL tribe — civ-vs-animal is a separate aggression model', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const viking = fighterAt(sim, 0, 0, VIKING, WOODCUTTER);
    fighterAt(sim, 1, 0, WOLVES, WOODCUTTER); // a wolf adjacent — a DIFFERENT tribe, but an animal

    combatSystem(sim.world, ctxOf(sim));

    // The wolf is a known animal tribe, so the player-vs-player drive leaves it alone (no swing).
    expect(sim.world.has(viking, CurrentAtomic)).toBe(false);
  });

  it('an ANIMAL-tribe combatant does not run the player-vs-player drive (even armed, vs a civ)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    // The wolf IS armed (test_claw, tribe 9/job 1) — so it is skipped for being an animal, not unarmed.
    const wolf = fighterAt(sim, 0, 0, WOLVES, WOODCUTTER);
    fighterAt(sim, 1, 0, VIKING, WOODCUTTER); // a viking adjacent

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(wolf, CurrentAtomic)).toBe(false);
  });

  it('still targets a different-tribe combatant that has NO record (not reclassified as an animal)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const viking = fighterAt(sim, 0, 0, VIKING, WOODCUTTER);
    const frank = fighterAt(sim, 1, 0, FRANK, WOODCUTTER); // tribe 2 — no record in the fixture

    combatSystem(sim.world, ctxOf(sim));

    // FRANK has no `[tribetype]` record, so it is NOT an animal — it stays a valid player-vs-player enemy.
    expect(sim.world.get(viking, CurrentAtomic).effect).toMatchObject({ kind: 'attack', target: frank });
  });
});

describe('combatSystem — end-to-end through the real schedule', () => {
  it('two enemies fight to a kill: attack drains HP, cleanup reaps the felled one', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const viking = fighterAt(sim, 0, 0, VIKING, WOODCUTTER, 1000);
    // The frank has a low pool and no weapon (job 2) — it can't fight back, so the viking grinds it down.
    const frank = fighterAt(sim, 1, 0, FRANK, 2, 120);

    // 50 net damage per swing, 4-tick swing -> 120 HP falls after 3 landed hits (~12+ ticks). Run enough.
    // Events are cleared each tick, so accumulate any settlerDied across the fight (the kill fires in ONE tick).
    let deaths = 0;
    for (let i = 0; i < 60 && sim.world.isAlive(frank); i++) {
      sim.step();
      deaths += sim.snapshot().events.filter((ev) => ev.kind === 'settlerDied').length;
    }

    expect(sim.world.isAlive(frank)).toBe(false); // ground down and reaped
    expect(sim.world.isAlive(viking)).toBe(true); // unharmed (the frank never attacked)
    expect(deaths).toBe(1); // exactly one death announced for render/audio (the felled frank)
  });

  it('two same-seed runs of a skirmish reach the same state hash (determinism)', () => {
    const run = (): string => {
      const sim = new Simulation({ seed: 7, content: testContent(), map: grassMap(5, 1) });
      fighterAt(sim, 0, 0, VIKING, WOODCUTTER, 1000);
      fighterAt(sim, 1, 0, FRANK, 2, 200);
      for (let i = 0; i < 20; i++) sim.step();
      return sim.hashState();
    };
    expect(run()).toBe(run());
  });
});
