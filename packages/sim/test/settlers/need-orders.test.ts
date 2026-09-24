import { describe, expect, it } from 'vitest';
import {
  Building,
  CurrentAtomic,
  MISSION_BEHAVIOUR,
  MoveGoal,
  NeedOrder,
  NoRegeneration,
  Owner,
  Position,
  Settler,
  Stockpile,
  setMissionBehaviour,
  setSettlerJob,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { type Fixed, fx, ONE, Simulation } from '../../src/index.js';
import { plannerSystem } from '../../src/systems/index.js';
import { testContent } from '../fixtures/content.js';
import { cellOf, ctxOf, grassMap, type NeedLevels, needsSettlerAt } from './needs/support.js';

/**
 * The four "answer this need now" orders (the original's eat/sleep/talk/pray buttons) and the
 * regeneration toggle that decides whether a soldier leaves its post to answer one at all.
 */

const FOOD = 3;
const VIKING = 1;
const HEADQUARTERS = 1;
const TEMPLE = 3;
const EAT_ATOMIC = 10;
const PRAY_ATOMIC = 12;
const HERO_JOB = 45;
/** Well under the ¾·ONE eat threshold: nothing but an order sends this settler to a larder. */
const FED: Fixed = fx.div(ONE, fx.fromInt(4));
/** Just over it, so the drive fires on its own. */
const HUNGRY: Fixed = fx.div(fx.fromInt(9), fx.fromInt(10));

/** The player these cases command for: only an owned settler takes a player order. */
const P0 = 0;

/** An owned settler with the given needs, the shape every order handler here requires. */
function ownedSettlerAt(sim: Simulation, x: number, y: number, needs: NeedLevels): Entity {
  const e = needsSettlerAt(sim, x, y, needs);
  sim.world.add(e, Owner, { player: P0 });
  return e;
}

function templeAt(sim: Simulation, x: number, y: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Building, { buildingType: TEMPLE, tribe: VIKING, built: ONE, level: 0 });
  return e;
}

function storeAt(sim: Simulation, x: number, y: number, food: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Building, { buildingType: HEADQUARTERS, tribe: VIKING, built: ONE, level: 0 });
  sim.world.add(e, Stockpile, { amounts: new Map([[FOOD, food]]) });
  return e;
}

describe('orderNeed - answering a need on command', () => {
  it('refuses need and regeneration orders for a hero', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const hero = ownedSettlerAt(sim, 2, 0, { hunger: HUNGRY });
    setSettlerJob(sim.world, hero, HERO_JOB);
    storeAt(sim, 2, 0, 3);

    sim.enqueueSetup({ kind: 'orderNeed', entity: hero, need: 'hunger' });
    sim.enqueueSetup({ kind: 'setRegeneration', entity: hero, enabled: false });
    sim.step();

    expect(sim.world.has(hero, NeedOrder)).toBe(false);
    expect(sim.world.has(hero, NoRegeneration)).toBe(false);
    expect(sim.world.has(hero, CurrentAtomic)).toBe(false);
    expect(sim.world.get(hero, Settler).jobType).toBe(HERO_JOB);
  });

  it('refuses a need order for a settler whose needs a script froze', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const guard = ownedSettlerAt(sim, 2, 0, { hunger: HUNGRY });
    setMissionBehaviour(sim.world, guard, MISSION_BEHAVIOUR.NEEDS_FROZEN, true);
    storeAt(sim, 2, 0, 3);

    sim.enqueueSetup({ kind: 'orderNeed', entity: guard, need: 'hunger' });
    sim.step();

    // No rung answers a frozen need, so a stamped order would stand for good and excuse the guard
    // from every battle alert.
    expect(sim.world.has(guard, NeedOrder)).toBe(false);
    expect(sim.world.has(guard, CurrentAtomic)).toBe(false);
  });

  it('drops an order stamped before a script froze the settler, which no rung can answer now', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const guard = ownedSettlerAt(sim, 0, 0, { hunger: FED });
    storeAt(sim, 4, 0, 3);
    sim.enqueueSetup({ kind: 'orderNeed', entity: guard, need: 'hunger' });
    sim.step();
    expect(sim.world.has(guard, NeedOrder)).toBe(true); // on its way to the larder

    setMissionBehaviour(sim.world, guard, MISSION_BEHAVIOUR.NEEDS_FROZEN, true);
    for (let i = 0; i < 150; i++) sim.step(); // the walk out ends on the larder's doorstep

    // A standing order would excuse the guard from every battle alert for good.
    expect(sim.world.has(guard, NeedOrder)).toBe(false);
  });

  it('sends a fed settler to the larder and clears the order once the meal lands', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const settler = ownedSettlerAt(sim, 2, 0, { hunger: FED });
    const store = storeAt(sim, 2, 0, 3);

    plannerSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(settler, CurrentAtomic)).toBe(false); // a fed settler does not eat by itself

    sim.enqueueSetup({ kind: 'orderNeed', entity: settler, need: 'hunger' });
    sim.step();

    const atomic = sim.world.get(settler, CurrentAtomic);
    expect(atomic.atomicId).toBe(EAT_ATOMIC);
    expect(atomic.effect).toEqual({ kind: 'eat', goodType: FOOD, from: store });

    for (let i = 0; i < atomic.duration + 2 && sim.world.has(settler, NeedOrder); i++) sim.step();
    expect(sim.world.has(settler, NeedOrder)).toBe(false); // the eat effect retired it
  });

  it('walks the ordered settler to the food it is not standing on', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    const settler = ownedSettlerAt(sim, 0, 0, { hunger: FED });
    storeAt(sim, 3, 0, 2);

    sim.enqueueSetup({ kind: 'orderNeed', entity: settler, need: 'hunger' });
    sim.step();

    expect(sim.world.get(settler, MoveGoal).cell).toBe(cellOf(sim, 3, 0));
  });

  it('leaves the order standing while nothing can answer it', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const settler = ownedSettlerAt(sim, 0, 0, { hunger: FED });

    sim.enqueueSetup({ kind: 'orderNeed', entity: settler, need: 'hunger' });
    for (let i = 0; i < 5; i++) sim.step();

    expect(sim.world.get(settler, NeedOrder).need).toBe('hunger');
    expect(sim.world.has(settler, CurrentAtomic)).toBe(false);
  });

  it('sends a trade that never prays of its own accord to the temple', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    // The fixture's default trade carries no `needsReligionFlag`, so only the order gives it a prayer.
    const settler = ownedSettlerAt(sim, 3, 0, { piety: FED });
    templeAt(sim, 3, 0);

    plannerSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(settler, CurrentAtomic)).toBe(false);

    sim.enqueueSetup({ kind: 'orderNeed', entity: settler, need: 'piety' });
    sim.step();

    const atomic = sim.world.get(settler, CurrentAtomic);
    expect(atomic.atomicId).toBe(PRAY_ATOMIC);
    expect(atomic.effect).toEqual({ kind: 'pray' });

    for (let i = 0; i < atomic.duration + 2 && sim.world.has(settler, NeedOrder); i++) sim.step();
    expect(sim.world.has(settler, NeedOrder)).toBe(false);
  });

  it('a walk order calls it off', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    const settler = ownedSettlerAt(sim, 0, 0, { hunger: FED });
    storeAt(sim, 3, 0, 2);

    sim.enqueueSetup({ kind: 'orderNeed', entity: settler, need: 'hunger' });
    sim.step();
    sim.enqueueSetup({ kind: 'moveUnit', entity: settler, x: 0, y: 0 });
    sim.step();

    expect(sim.world.has(settler, NeedOrder)).toBe(false);
  });
});

describe('setRegeneration - the soldier that stays put', () => {
  it('keeps a hungry settler at work while regeneration is prohibited', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    const settler = ownedSettlerAt(sim, 0, 0, { hunger: HUNGRY });
    storeAt(sim, 3, 0, 2);

    sim.enqueueSetup({ kind: 'setRegeneration', entity: settler, enabled: false });
    sim.step();

    expect(sim.world.has(settler, NoRegeneration)).toBe(true);
    plannerSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(settler, MoveGoal)).toBe(false); // it does not walk off to the larder
  });

  it('moves it anyway on an explicit meal order, and again once regeneration is allowed', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    const settler = ownedSettlerAt(sim, 0, 0, { hunger: HUNGRY });
    storeAt(sim, 3, 0, 2);
    sim.enqueueSetup({ kind: 'setRegeneration', entity: settler, enabled: false });
    sim.step();

    sim.enqueueSetup({ kind: 'orderNeed', entity: settler, need: 'hunger' });
    sim.step();
    expect(sim.world.get(settler, MoveGoal).cell).toBe(cellOf(sim, 3, 0));

    sim.enqueueSetup({ kind: 'setRegeneration', entity: settler, enabled: true });
    sim.step();
    expect(sim.world.has(settler, NoRegeneration)).toBe(false);
  });

  it('goes back to allowed when the settler changes trade', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const settler = ownedSettlerAt(sim, 0, 0, { hunger: FED });
    sim.enqueueSetup({ kind: 'setRegeneration', entity: settler, enabled: false });
    sim.enqueueSetup({ kind: 'orderNeed', entity: settler, need: 'hunger' });
    sim.step();

    sim.enqueueSetup({ kind: 'setJob', entity: settler, jobType: 2 });
    sim.step();

    expect(sim.world.has(settler, NoRegeneration)).toBe(false);
    expect(sim.world.has(settler, NeedOrder)).toBe(false);
  });
});
