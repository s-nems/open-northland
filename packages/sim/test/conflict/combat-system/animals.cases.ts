import { describe, expect, it } from 'vitest';
import { Anger, CurrentAtomic, Health } from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { fx, Simulation } from '../../../src/index.js';
import { atomicSystem, combatSystem } from '../../../src/systems/index.js';
import { testContent } from '../../fixtures/content.js';

import {
  ATTACK_ATOMIC,
  BEAR,
  BEES,
  BOAR,
  COW,
  ctxOf,
  DEER,
  FRANK,
  fighterAt,
  fighterAtNode,
  grassMap,
  HUNTER,
  VIKING,
  WOLVES,
  WOODCUTTER,
} from './support.js';

describe('combatSystem — civ-vs-animal aggression (animaltypes.ini)', () => {
  it('an AGGRESSIVE animal attacks a nearby civilization (the unprovoked aggression drive)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const bear = fighterAt(sim, 0, 0, BEAR, WOODCUTTER); // aggressive animal — drives an attack
    const viking = fighterAt(sim, 1, 0, VIKING, WOODCUTTER); // a settler within range

    combatSystem(sim.world, ctxOf(sim));

    const atomic = sim.world.get(bear, CurrentAtomic);
    expect(atomic.atomicId).toBe(ATTACK_ATOMIC);
    expect(atomic.duration).toBe(4); // bear setatomic 81 -> bear_attack length 4
    expect(atomic.effect).toEqual({ kind: 'attack', target: viking, damage: 40, maxRange: 2 }); // test_bearfist damage["0"]
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
    expect(atomic.effect).toEqual({ kind: 'attack', target: viking, damage: 40, maxRange: 2 });
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
    expect(atomic.effect).toEqual({ kind: 'attack', target: cow, damage: 70, maxRange: 17 }); // test_spear damage["0"]
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
    expect(atomic.effect).toEqual({ kind: 'attack', target: viking, damage: 30, maxRange: 2 }); // test_tusk damage["0"]
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
