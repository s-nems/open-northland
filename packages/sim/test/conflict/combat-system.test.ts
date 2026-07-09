import { beforeEach, describe, expect, it } from 'vitest';
import {
  Anger,
  Armor,
  CurrentAtomic,
  Health,
  MoveGoal,
  PathFollow,
  PathRequest,
  Position,
  Settler,
  Weapon,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import {
  type Fixed,
  Simulation,
  type TerrainMap,
  fx,
  halfCellMapFromCells,
  positionOfNode,
} from '../../src/index.js';
import { type SystemContext, atomicSystem, combatSystem } from '../../src/systems/index.js';
import { testContent } from '../fixtures/content.js';

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
const BOAR = 12; // a PASSIVE-but-PROVOKABLE animal tribe (getAngry, NOT aggressive; angryGameTime 10; test_tusk)
const COW = 13; // a CATCHABLE prey animal tribe (catchable, fully passive — not aggressive, not getAngry)
const DEER = 14; // a CATCHABLE-and-PROVOKABLE prey animal tribe (catchable + getAngry; angryGameTime 10; test_antler)
const WOODCUTTER = 1; // job 1 — the test_axe binds to this (tribe 1, job 1)
const HUNTER = 15; // job 15 (JOB_TYPE_HUMAN_HUNTER) — the test_spear binds to this (tribe 1, job 15)
const ATTACK_ATOMIC = 81;

beforeEach(() => {
  Position.store.clear();
  Settler.store.clear();
  Health.store.clear();
  CurrentAtomic.store.clear();
  MoveGoal.store.clear();
  PathFollow.store.clear();
  PathRequest.store.clear();
  Anger.store.clear();
  Armor.store.clear();
  Weapon.store.clear();
});

function grassMap(width: number, height: number): TerrainMap {
  return halfCellMapFromCells({ width, height, typeIds: new Array(width * height).fill(0) });
}

/** A combatant: a settler with a Health pool at visual cell (x,y). `tribe`/`jobType` decide its weapon. */
function fighterAt(
  sim: Simulation,
  x: number,
  y: number,
  tribe: number,
  jobType: number | null,
  hitpoints = 1000,
): Entity {
  return fighterAtPosition(sim, { x: fx.fromInt(x), y: fx.fromInt(y) }, tribe, jobType, hitpoints);
}

/** A combatant standing exactly on half-cell node (hx, hy) — reach geometry a whole cell (2 nodes on a
 *  row) cannot express, e.g. an ODD node distance from a cell-anchored fighter. */
function fighterAtNode(
  sim: Simulation,
  hx: number,
  hy: number,
  tribe: number,
  jobType: number | null,
  hitpoints = 1000,
): Entity {
  return fighterAtPosition(sim, positionOfNode(hx, hy), tribe, jobType, hitpoints);
}

function fighterAtPosition(
  sim: Simulation,
  position: { x: Fixed; y: Fixed },
  tribe: number,
  jobType: number | null,
  hitpoints: number,
): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: position.x, y: position.y });
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
    const enemy = fighterAt(sim, 1, 0, FRANK, WOODCUTTER); // 2 nodes away — at the axe's maxRange 2

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

describe('combatSystem — hunter strike on catchable prey (animaltypes.ini catchable)', () => {
  it('a HUNTER strikes catchable prey (a cow) in its bow band, with the hunter weapon damage', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    const hunter = fighterAt(sim, 0, 0, VIKING, HUNTER); // a viking hunter (job 15) — bow minRange 3
    const cow = fighterAt(sim, 3, 0, COW, null); // catchable prey, 6 nodes away (inside the bow band 3..17)

    combatSystem(sim.world, ctxOf(sim));

    const atomic = sim.world.get(hunter, CurrentAtomic);
    expect(atomic.atomicId).toBe(ATTACK_ATOMIC);
    expect(atomic.duration).toBe(4); // hunter setatomic 81 -> viking_hunter_attack length 4
    expect(atomic.effect).toEqual({ kind: 'attack', target: cow, damage: 70 }); // test_spear damage["0"]
  });

  it('a hunter CANNOT fire its bow on prey closer than minRange (an adjacent cow is too near)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    const hunter = fighterAt(sim, 0, 0, VIKING, HUNTER); // bow minRange 3
    fighterAtNode(sim, 1, 0, COW, null); // catchable prey, but only 1 node away — INSIDE the bow's near reach

    combatSystem(sim.world, ctxOf(sim));

    // The cow is a valid prey AND within maxRange, but closer than minRange 3 — a bow can't fire on it.
    expect(sim.world.has(hunter, CurrentAtomic)).toBe(false);
  });

  it('minRange is exclusive at the boundary: prey at minRange-1 (2 nodes) is still too near', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    const hunter = fighterAt(sim, 0, 0, VIKING, HUNTER); // bow band 3..17
    fighterAt(sim, 1, 0, COW, null); // 2 nodes away — one inside the near reach (minRange 3)

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(hunter, CurrentAtomic)).toBe(false); // dist 2 < minRange 3 — no shot
  });

  it('a NON-hunter civilian (woodcutter) leaves catchable prey alone (hunting is the hunter trade)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    const woodcutter = fighterAt(sim, 0, 0, VIKING, WOODCUTTER); // armed, but not a hunter
    fighterAt(sim, 1, 0, COW, null); // catchable prey, adjacent

    combatSystem(sim.world, ctxOf(sim));

    // The woodcutter has a weapon but is not a hunter, so prey is not its target (no swing).
    expect(sim.world.has(woodcutter, CurrentAtomic)).toBe(false);
  });

  it('a hunter does NOT hunt a non-catchable wild animal (a passive wolf — no catchable flag)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    const hunter = fighterAt(sim, 0, 0, VIKING, HUNTER);
    fighterAt(sim, 3, 0, WOLVES, null); // a wild animal with no `catchable` flag — not huntable prey

    combatSystem(sim.world, ctxOf(sim));

    // The wolf is not catchable (and not aggressive), so even a hunter leaves it alone.
    expect(sim.world.has(hunter, CurrentAtomic)).toBe(false);
  });

  it('catchable prey (a cow) does NOT hunt the hunter back (predation is one direction)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    fighterAt(sim, 0, 0, VIKING, HUNTER);
    const cow = fighterAt(sim, 3, 0, COW, null); // passive prey — never picks a fight

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(cow, CurrentAtomic)).toBe(false); // prey doesn't fight the hunter
  });

  it('a hunter still cannot strike a cannotBeAttacked animal (the exemption holds for hunting too)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    const hunter = fighterAt(sim, 0, 0, VIKING, HUNTER);
    fighterAt(sim, 3, 0, BEES, null); // cannotBeAttacked (and not catchable anyway)

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(hunter, CurrentAtomic)).toBe(false);
  });
});

describe('combatSystem — provoked anger (getAngry/angryGameTime)', () => {
  /**
   * Land one completed `attack` of `damage` on `target` via the real AtomicSystem (the provocation
   * point): give `attacker` a 1-tick `attack` CurrentAtomic at it and run `atomicSystem` once. This
   * drains the target's Health AND, for a provokable animal, stamps the `Anger` timer.
   */
  function strike(sim: Simulation, attacker: Entity, target: Entity, damage: number): void {
    sim.world.add(attacker, CurrentAtomic, {
      atomicId: ATTACK_ATOMIC,
      elapsed: 0,
      progress: fx.fromInt(0),
      duration: 1,
      effect: { kind: 'attack', target, damage },
      targetEntity: target,
      targetTile: null,
    });
    atomicSystem(sim.world, ctxOf(sim));
  }

  it('a passive boar (not yet struck) neither attacks nor is attacked', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const viking = fighterAt(sim, 0, 0, VIKING, WOODCUTTER);
    const boar = fighterAt(sim, 1, 0, BOAR, null); // getAngry but UNPROVOKED — passive like a wolf

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(viking, CurrentAtomic)).toBe(false); // a civ leaves an unprovoked boar alone
    expect(sim.world.has(boar, CurrentAtomic)).toBe(false); // an unprovoked boar picks no fight
  });

  it('striking a provokable boar stamps an Anger timer (and drains its HP)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const viking = fighterAt(sim, 0, 0, VIKING, WOODCUTTER);
    const boar = fighterAt(sim, 1, 0, BOAR, null, 1000);

    strike(sim, viking, boar, 50);

    expect(sim.world.get(boar, Health).hitpoints).toBe(950); // the hit landed
    // angryGameTime 10, struck at tick 0 -> hostile until tick 10.
    expect(sim.world.get(boar, Anger)).toEqual({ until: sim.tick + 10 });
  });

  it('an ANGRY boar fights a nearby civilization back (the provoked-aggression drive)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const viking = fighterAt(sim, 0, 0, VIKING, WOODCUTTER);
    const boar = fighterAt(sim, 1, 0, BOAR, null, 1000);
    sim.world.add(boar, Anger, { until: sim.tick + 10 }); // already provoked, still angry

    combatSystem(sim.world, ctxOf(sim));

    const atomic = sim.world.get(boar, CurrentAtomic);
    expect(atomic.atomicId).toBe(ATTACK_ATOMIC);
    expect(atomic.effect).toEqual({ kind: 'attack', target: viking, damage: 30 }); // test_tusk damage["0"]
  });

  it('a civilization may target an ANGRY boar (the mayTarget anger override)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const viking = fighterAt(sim, 0, 0, VIKING, WOODCUTTER);
    const boar = fighterAt(sim, 1, 0, BOAR, null, 1000);
    sim.world.add(boar, Anger, { until: sim.tick + 10 }); // the boar is harassing the viking

    combatSystem(sim.world, ctxOf(sim));

    // The viking strikes back at the angry boar (a passive boar it would have left alone).
    expect(sim.world.get(viking, CurrentAtomic).effect).toMatchObject({ kind: 'attack', target: boar });
  });

  it('a LAPSED anger timer reverts the boar to passive and is reaped on the attacker pass', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const viking = fighterAt(sim, 0, 0, VIKING, WOODCUTTER);
    const boar = fighterAt(sim, 1, 0, BOAR, null, 1000);
    sim.world.add(boar, Anger, { until: sim.tick }); // already expired (until == current tick)

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(boar, CurrentAtomic)).toBe(false); // cooled off — no longer attacks
    expect(sim.world.has(boar, Anger)).toBe(false); // the stale timer was reaped on the attacker scan
    expect(sim.world.has(viking, CurrentAtomic)).toBe(false); // a lapsed boar is no longer a target either
  });

  it('a re-strike refreshes the anger timer (latest provocation extends hostility)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const viking = fighterAt(sim, 0, 0, VIKING, WOODCUTTER);
    const boar = fighterAt(sim, 1, 0, BOAR, null, 1000);
    sim.world.add(boar, Anger, { until: sim.tick + 3 }); // an older, nearly-spent timer

    strike(sim, viking, boar, 50); // struck again at the current tick

    // Refreshed to tick+10 (the new provocation), not left at the older tick+3.
    expect(sim.world.get(boar, Anger).until).toBe(sim.tick + 10);
  });

  it('a non-provokable animal (wolf, no animaltypes record) gets no Anger when struck', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const viking = fighterAt(sim, 0, 0, VIKING, WOODCUTTER);
    const wolf = fighterAt(sim, 1, 0, WOLVES, null, 1000); // passive, NOT getAngry (no record)

    strike(sim, viking, wolf, 50);

    expect(sim.world.get(wolf, Health).hitpoints).toBe(950); // the hit landed
    expect(sim.world.has(wolf, Anger)).toBe(false); // but a non-getAngry animal is never provoked
  });

  it('a struck civilization is never provoked (anger is animals-only)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const bear = fighterAt(sim, 0, 0, BEAR, null);
    const viking = fighterAt(sim, 1, 0, VIKING, WOODCUTTER, 1000);

    strike(sim, bear, viking, 40);

    expect(sim.world.has(viking, Anger)).toBe(false); // a civilization carries no anger timer
  });

  it('a HUNTER strike on catchable getAngry prey (a deer) provokes it — the provocation SOURCE', () => {
    // The end-to-end point of the hunter slice: a hunter, not a test or an aggressive animal, is what
    // FIRST provokes a passive getAngry animal. Run the REAL step() schedule so combatSystem picks the
    // target, atomicSystem lands the hit + stamps Anger, and the deer fights back.
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    const hunter = fighterAt(sim, 0, 0, VIKING, HUNTER, 1000);
    // 3 nodes away — inside the bow band (minRange 3) AND inside the deer's antler reach (maxRange 3),
    // so the hunter can fire and the provoked deer can strike back at this distance.
    const deer = fighterAtNode(sim, 3, 0, DEER, null, 1000); // catchable + getAngry, passive until struck

    // combatSystem runs after atomicSystem, so the hunter's swing (started tick 1) completes on tick 5
    // — the provoking hit (drains HP, stamps Anger). Run 5 ticks for it to land.
    for (let i = 0; i < 5; i++) sim.step();
    expect(sim.world.get(deer, Health).hitpoints).toBeLessThan(1000); // the hunter's strike landed
    expect(sim.world.has(deer, Anger)).toBe(true); // the strike PROVOKED the deer (the provocation source)

    // Now provoked, the deer fights the hunter back: run more ticks for its retaliating swing to land.
    for (let i = 0; i < 6; i++) sim.step();
    expect(sim.world.get(hunter, Health).hitpoints).toBeLessThan(1000); // the provoked deer struck back
  });

  it('an ALREADY-aggressive animal (bear) gets no Anger when struck (it is hostile unconditionally)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const viking = fighterAt(sim, 0, 0, VIKING, WOODCUTTER);
    // The bear is aggressive AND getAngry in the fixture; an aggressive animal needs no anger timer, so
    // none is stamped (avoiding a stale component hostileAnimalNow would never reap).
    const bear = fighterAt(sim, 1, 0, BEAR, null, 1000);

    strike(sim, viking, bear, 50);

    expect(sim.world.get(bear, Health).hitpoints).toBe(950); // the hit landed
    expect(sim.world.has(bear, Anger)).toBe(false); // no redundant anger timer on an aggressive animal
  });
});

describe('combatSystem — armor material column (the target armor material join)', () => {
  // The fixture's test_axe lists `damage { "0": 50, "1": 60 }`; leather (armor class 1, material 1).
  // Armor selects the damage COLUMN (no blockingValue subtracted): a viking woodcutter hits an
  // UNARMORED target for 50 (material 0) and a leather-clad one for 60 (material 1); a column the
  // weapon lists no value for resolves to 0.

  it('an unarmored target (no Armor) takes the material-0 damage (unchanged behavior)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const attacker = fighterAt(sim, 0, 0, VIKING, WOODCUTTER);
    const enemy = fighterAt(sim, 1, 0, FRANK, WOODCUTTER); // no Armor -> material 0

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(attacker, CurrentAtomic).effect).toEqual({
      kind: 'attack',
      target: enemy,
      damage: 50, // test_axe damage["0"]
    });
  });

  it('an armored target takes the per-material damage column (no blockingValue subtracted)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const attacker = fighterAt(sim, 0, 0, VIKING, WOODCUTTER);
    const enemy = fighterAt(sim, 1, 0, FRANK, WOODCUTTER);
    sim.world.add(enemy, Armor, { armorClass: 1 }); // leather: selects damage["1"] = 60 (material 1)

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(attacker, CurrentAtomic).effect).toEqual({
      kind: 'attack',
      target: enemy,
      damage: 60, // test_axe damage["1"] — the material-1 column, NOT 60 − 5 (armor selects, doesn't mitigate)
    });
  });

  it('a target wearing an out-of-table armor class selects that class’s column (no record → the class is its own material)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const attacker = fighterAt(sim, 0, 0, VIKING, WOODCUTTER);
    const enemy = fighterAt(sim, 1, 0, FRANK, WOODCUTTER);
    sim.world.add(enemy, Armor, { armorClass: 2 }); // no armor record → the class value (2) is its own column

    combatSystem(sim.world, ctxOf(sim));

    // test_axe lists no `damage["2"]`, so the column is 0 — the swing connects but does this material no
    // harm (a class with no `[armortype]` record selects its own column rather than crashing).
    expect(sim.world.get(attacker, CurrentAtomic).effect).toEqual({
      kind: 'attack',
      target: enemy,
      damage: 0,
    });
  });

  it('a weapon that lists no column for the target material does 0 damage (no harm), never negative', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    // The bear's test_bearfist lists only `damage["0"]` 40. A leather-clad (material 1) target selects
    // the material-1 column, which bearfist doesn't list → 0 damage (no subtraction, never negative).
    const bear = fighterAt(sim, 0, 0, BEAR, WOODCUTTER);
    const viking = fighterAt(sim, 1, 0, VIKING, WOODCUTTER);
    sim.world.add(viking, Armor, { armorClass: 1 });

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(bear, CurrentAtomic).effect).toEqual({
      kind: 'attack',
      target: viking,
      damage: 0, // bearfist has no damage["1"] column
    });
  });
});

describe('combatSystem — worn-weapon override (the equip seed)', () => {
  // A viking woodcutter's DEFAULT weapon is test_axe (tribe 1, job 1; damage["0"] 50, maxRange 2). A worn
  // `Weapon{weaponTypeId}` overrides that with a specific weapon resolved vs the viking tribe: test_spear
  // (typeId 11, tribe 1; damage["0"] 70, minRange 3, maxRange 17 — a ranged reach).

  it('a combatant with NO Weapon fights with its class default (unchanged behavior)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const attacker = fighterAt(sim, 0, 0, VIKING, WOODCUTTER); // no Weapon -> test_axe by (tribe,job)
    const enemy = fighterAt(sim, 1, 0, FRANK, WOODCUTTER);

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(attacker, CurrentAtomic).effect).toEqual({
      kind: 'attack',
      target: enemy,
      damage: 50, // test_axe damage["0"]
    });
  });

  it('a worn Weapon overrides the default class weapon (damage + reach come from the worn one)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    const attacker = fighterAt(sim, 0, 0, VIKING, WOODCUTTER);
    sim.world.add(attacker, Weapon, { weaponTypeId: 11 }); // test_spear (tribe 1): damage 70, minRange 3
    const enemy = fighterAt(sim, 4, 0, FRANK, WOODCUTTER); // 8 nodes: in the spear's 3..17 band, beyond axe's 2

    combatSystem(sim.world, ctxOf(sim));

    // The default axe (maxRange 2) could not reach 4 cells; the worn spear (maxRange 17) does, for 70.
    expect(sim.world.get(attacker, CurrentAtomic).effect).toEqual({
      kind: 'attack',
      target: enemy,
      damage: 70, // test_spear damage["0"]
    });
  });

  it('a worn weapon respects its near reach — a spear-wielder can’t strike an adjacent target', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const attacker = fighterAt(sim, 0, 0, VIKING, WOODCUTTER);
    sim.world.add(attacker, Weapon, { weaponTypeId: 11 }); // test_spear: minRange 3
    fighterAt(sim, 1, 0, FRANK, WOODCUTTER); // adjacent — below the spear's near reach (3)

    combatSystem(sim.world, ctxOf(sim));

    // The worn spear's minRange band is honored even though the default axe could have hit at range 1.
    expect(sim.world.has(attacker, CurrentAtomic)).toBe(false);
  });

  it('a worn weapon id with no matching record leaves the combatant unarmed (no silent fallback)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const attacker = fighterAt(sim, 0, 0, VIKING, WOODCUTTER);
    sim.world.add(attacker, Weapon, { weaponTypeId: 999 }); // no (tribe 1, typeId 999) record
    fighterAt(sim, 1, 0, FRANK, WOODCUTTER); // adjacent — the default axe WOULD have hit

    combatSystem(sim.world, ctxOf(sim));

    // The bad worn id does NOT fall back to the class default; the combatant simply can't attack.
    expect(sim.world.has(attacker, CurrentAtomic)).toBe(false);
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
