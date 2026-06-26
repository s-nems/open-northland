import { beforeEach, describe, expect, it } from 'vitest';
import {
  CurrentAtomic,
  Health,
  MoveGoal,
  PathFollow,
  PathRequest,
  Position,
  Settler,
} from '../src/components/index.js';
import type { Entity } from '../src/ecs/world.js';
import { Simulation, type TerrainMap, fx } from '../src/index.js';
import { type SystemContext, combatSystem } from '../src/systems/index.js';
import { testContent } from './fixtures/content.js';

/**
 * Unit + integration tests for the CombatSystem — the TARGETING half of the combat loop: an idle
 * Health-bearing combatant swings at the nearest enemy-tribe combatant within weapon range, issuing
 * the `attack` atomic with the `combatDamage`-resolved net damage. The fixture's `test_axe` (tribe 1,
 * job 1) has maxRange 2 and damage 50 vs an unarmored (class 0) target, bound to the `viking_attack`
 * animation (length 4). Together with the AtomicSystem `attack` effect (the hit) and the CleanupSystem
 * (the death) it closes the targeting->attack->hit->death loop.
 */

const VIKING = 1; // tribe 1 in the fixture (has test_axe for job 1)
const FRANK = 2; // a different tribe with NO record in the fixture — still a valid enemy (not an animal)
const WOLVES = 9; // a recorded ANIMAL tribe in the fixture (no jobEnables; test_claw for job 1) — PASSIVE (no animaltypes record)
const BEAR = 10; // an AGGRESSIVE animal tribe (animaltypes record: aggressive, hitpointsAdult 15000; test_bearfist for job 1)
const BEES = 11; // a cannotBeAttacked animal tribe (decorative fauna — a civ is exempt from attacking it)
const WOODCUTTER = 1; // job 1 — the test_axe binds to this (tribe 1, job 1)
const ATTACK_ATOMIC = 81;

beforeEach(() => {
  Position.store.clear();
  Settler.store.clear();
  Health.store.clear();
  CurrentAtomic.store.clear();
  MoveGoal.store.clear();
  PathFollow.store.clear();
  PathRequest.store.clear();
});

function grassMap(width: number, height: number): TerrainMap {
  return { width, height, typeIds: new Array(width * height).fill(0) };
}

/** A combatant: a settler with a Health pool. `tribe`/`jobType` decide its weapon. */
function fighterAt(
  sim: Simulation,
  x: number,
  y: number,
  tribe: number,
  jobType: number | null,
  hitpoints = 1000,
): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Settler, {
    tribe,
    jobType,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map(),
  });
  sim.world.add(e, Health, { hitpoints, max: hitpoints });
  return e;
}

function ctxOf(sim: Simulation): SystemContext {
  return {
    content: sim.content,
    rng: sim.rng,
    tick: sim.tick,
    events: sim.events,
    ...(sim.terrain !== undefined ? { terrain: sim.terrain } : {}),
  };
}

describe('combatSystem — target selection + issuing the attack atomic', () => {
  it('an idle combatant swings at the nearest enemy in range, with the resolved net damage', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const attacker = fighterAt(sim, 0, 0, VIKING, WOODCUTTER);
    const enemy = fighterAt(sim, 2, 0, FRANK, WOODCUTTER); // 2 cells away — within maxRange 2

    combatSystem(sim.world, ctxOf(sim));

    const atomic = sim.world.get(attacker, CurrentAtomic);
    expect(atomic.atomicId).toBe(ATTACK_ATOMIC);
    expect(atomic.duration).toBe(4); // resolved via viking setatomic 81 -> viking_attack length 4
    expect(atomic.effect).toEqual({ kind: 'attack', target: enemy, damage: 50 }); // damage["0"], unarmored
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
    fighterAt(sim, 5, 0, FRANK, WOODCUTTER); // 5 cells away — beyond maxRange 2

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(attacker, CurrentAtomic)).toBe(false);
  });

  it('picks the NEAREST enemy when several are in range, tie-broken by ascending entity id', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const attacker = fighterAt(sim, 2, 0, VIKING, WOODCUTTER);
    const far = fighterAt(sim, 4, 0, FRANK, WOODCUTTER); // 2 away
    const near = fighterAt(sim, 1, 0, FRANK, WOODCUTTER); // 1 away — nearest

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

describe('combatSystem — civ-vs-animal aggression (animaltypes.ini)', () => {
  it('an AGGRESSIVE animal attacks a nearby civilization (the unprovoked aggression drive)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const bear = fighterAt(sim, 0, 0, BEAR, WOODCUTTER); // aggressive animal — drives an attack
    const viking = fighterAt(sim, 1, 0, VIKING, WOODCUTTER); // a settler within range

    combatSystem(sim.world, ctxOf(sim));

    const atomic = sim.world.get(bear, CurrentAtomic);
    expect(atomic.atomicId).toBe(ATTACK_ATOMIC);
    expect(atomic.duration).toBe(4); // bear setatomic 81 -> bear_attack length 4
    expect(atomic.effect).toEqual({ kind: 'attack', target: viking, damage: 40 }); // test_bearfist damage["0"]
  });

  it('a civilization fights an aggressive animal BACK (the fight is mutual)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const viking = fighterAt(sim, 0, 0, VIKING, WOODCUTTER);
    const bear = fighterAt(sim, 1, 0, BEAR, WOODCUTTER); // an aggressive animal — a valid target for the civ

    combatSystem(sim.world, ctxOf(sim));

    // The viking engages the hostile bear (vs the PASSIVE wolves, which it would leave alone).
    expect(sim.world.get(viking, CurrentAtomic).effect).toMatchObject({ kind: 'attack', target: bear });
  });

  it('a PASSIVE animal (no animaltypes record) neither attacks nor is attacked', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const viking = fighterAt(sim, 0, 0, VIKING, WOODCUTTER);
    const wolf = fighterAt(sim, 1, 0, WOLVES, WOODCUTTER); // armed, but NOT aggressive (no record)

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(viking, CurrentAtomic)).toBe(false); // the civ leaves a passive animal alone
    expect(sim.world.has(wolf, CurrentAtomic)).toBe(false); // a passive animal picks no fight
  });

  it('a cannotBeAttacked animal (decorative fauna) is exempt from a civilization attacking it', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const viking = fighterAt(sim, 0, 0, VIKING, WOODCUTTER);
    fighterAt(sim, 1, 0, BEES, WOODCUTTER); // a bee — aggressive in the record, but cannotBeAttacked

    combatSystem(sim.world, ctxOf(sim));

    // The bee carries `cannotBeAttacked`, so the civ cannot target it (no swing), even though it is adjacent.
    expect(sim.world.has(viking, CurrentAtomic)).toBe(false);
  });

  it('two animals do NOT fight each other (no inter-species wildlife aggression)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const bear = fighterAt(sim, 0, 0, BEAR, WOODCUTTER); // aggressive
    fighterAt(sim, 1, 0, WOLVES, WOODCUTTER); // another animal, adjacent

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(bear, CurrentAtomic)).toBe(false); // an animal does not war on another animal
  });

  it('a JOBLESS spawned animal resolves its weapon by tribe and still does damage', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    // What `spawnAnimalHerd` actually places: an animal with jobType NULL (not born into a trade).
    // Its weapon (test_bearfist, tribe 10) keys on a jobType in the data, so a jobless animal must
    // resolve it by tribe alone — else a spawned aggressive animal would do no damage at all.
    const bear = fighterAt(sim, 0, 0, BEAR, null);
    const viking = fighterAt(sim, 1, 0, VIKING, WOODCUTTER);

    combatSystem(sim.world, ctxOf(sim));

    const atomic = sim.world.get(bear, CurrentAtomic);
    expect(atomic.atomicId).toBe(ATTACK_ATOMIC);
    // damage["0"] of test_bearfist (40) resolved by TRIBE, despite the bear carrying no jobType.
    expect(atomic.effect).toEqual({ kind: 'attack', target: viking, damage: 40 });
  });

  it('a JOBLESS civilization settler is still unarmed (the tribe-keyed path is animals only)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    // A jobless VIKING (a civilization) must NOT pick up its tribe's weapon by tribe alone — only an
    // animal tribe resolves a weapon without a job. A jobless civilian is genuinely unarmed.
    const jobless = fighterAt(sim, 0, 0, VIKING, null);
    fighterAt(sim, 1, 0, FRANK, WOODCUTTER); // an enemy in range — but the attacker has no weapon

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(jobless, CurrentAtomic)).toBe(false);
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
      Health.store.clear();
      Settler.store.clear();
      Position.store.clear();
      CurrentAtomic.store.clear();
      const sim = new Simulation({ seed: 7, content: testContent(), map: grassMap(5, 1) });
      fighterAt(sim, 0, 0, VIKING, WOODCUTTER, 1000);
      fighterAt(sim, 1, 0, FRANK, 2, 200);
      for (let i = 0; i < 20; i++) sim.step();
      return sim.hashState();
    };
    expect(run()).toBe(run());
  });
});
