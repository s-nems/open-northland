import { describe, expect, it } from 'vitest';
import {
  AttackOrder,
  Building,
  Carrying,
  CurrentAtomic,
  Engagement,
  Equipment,
  type EquipmentSlot,
  Health,
  HuntFocus,
  MISC_EQUIP_SLOTS,
  MISSION_BEHAVIOUR,
  MoveGoal,
  NeedOrder,
  PathRequest,
  Position,
  Settler,
  Stockpile,
  setMissionBehaviour,
} from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { cellAnchorNode, type Fixed, fx, type NodeId, ONE, Simulation } from '../../../src/index.js';
import { plannerSystem } from '../../../src/systems/index.js';
import { testContent } from '../../fixtures/content.js';
import { ctxOf, FRANK, fighterAt, grassMap, P0, P1, VIKING, WOODCUTTER } from './support.js';

/**
 * THE NEEDS GATE ON AN ENGAGED UNIT: a fighter answers a pressing need with what it carries and never walks
 * off a chase or a siege to reach a larder or a bed.
 */

const FOOD = 3;
const MEAD = 13;
const HEADQUARTERS = 1;
/** Over the the drive threshold eat trigger and still inside the bar, so `needsSystem`'s clamp cannot mask a relief. */
const PRESSING: Fixed = fx.div(fx.fromInt(9), fx.fromInt(10));
/** Well under the drive threshold: only an order makes this bar a reason to act. */
const FED: Fixed = fx.div(ONE, fx.fromInt(4));
/** What one sip of mead takes off the hunger bar: half of it. */
const MEAD_SIP: Fixed = fx.div(ONE, fx.fromInt(2));

function hungryFighterAt(sim: Simulation, x: number, y: number): Entity {
  const e = fighterAt(sim, x, y, VIKING, WOODCUTTER, { owner: P0 });
  sim.world.mut(e, Settler).hunger = PRESSING;
  return e;
}

/** A stocked larder far enough away that reaching it can only be a walk. */
function larderAt(sim: Simulation, x: number, y: number): void {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Building, { buildingType: HEADQUARTERS, tribe: VIKING, built: ONE, level: 0 });
  sim.world.add(e, Stockpile, { amounts: new Map([[FOOD, 5]]) });
}

const FRESH_MEAD: EquipmentSlot = { goodType: MEAD, degreeOfUse: fx.fromInt(0) };

function carryMead(sim: Simulation, e: Entity): void {
  const misc = new Array<EquipmentSlot | null>(MISC_EQUIP_SLOTS).fill(null);
  misc[0] = { ...FRESH_MEAD };
  sim.world.add(e, Equipment, { boots: null, tool: null, weapon: null, armor: null, misc });
}

/** The terrain node at a visual cell anchor - a march goal must be somewhere the unit is not, or the
 *  navigation planner retires it as already satisfied. */
function cellNode(sim: Simulation, x: number, y: number): NodeId {
  const anchor = cellAnchorNode(x, y);
  const node = sim.terrain?.nodeAt(anchor.hx, anchor.hy);
  if (node === undefined) throw new Error('fixture map has no such cell');
  return node;
}

describe('an engaged unit answers a need in place, never by walking', () => {
  it('a hungry BESIEGER with no rations does not walk to the larder', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(12, 1) });
    const besieger = hungryFighterAt(sim, 10, 0);
    sim.world.add(besieger, Engagement, { repathAt: sim.tick });
    larderAt(sim, 0, 0);

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(besieger, MoveGoal)).toBe(false); // it holds the siege and goes hungry
    expect(sim.world.has(besieger, CurrentAtomic)).toBe(false);
    expect(sim.world.has(besieger, Engagement)).toBe(true);
  });

  it('the SAME hungry fighter walks to the larder when NOT engaged', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(12, 1) });
    const cutter = hungryFighterAt(sim, 10, 0);
    larderAt(sim, 0, 0);

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(cutter, MoveGoal)).toBe(true); // the gate above is what stopped it
  });

  it('a hungry HUNTER holding prey still walks to the larder - a hunt is an economy errand', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(12, 1) });
    const hunter = hungryFighterAt(sim, 10, 0);
    const prey = fighterAt(sim, 11, 0, FRANK, WOODCUTTER);
    sim.world.add(hunter, Engagement, { repathAt: sim.tick });
    sim.world.add(hunter, HuntFocus, { target: prey });
    larderAt(sim, 0, 0);

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(hunter, MoveGoal)).toBe(true); // the combat gate does not reach a hunter
  });

  it('a hungry BESIEGER drinks its mead where it stands and keeps the order', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(12, 1) });
    const besieger = hungryFighterAt(sim, 10, 0);
    carryMead(sim, besieger);
    const enemy = fighterAt(sim, 11, 0, FRANK, WOODCUTTER);
    sim.world.add(besieger, AttackOrder, { target: enemy });
    sim.world.add(besieger, Engagement, { repathAt: sim.tick });
    larderAt(sim, 0, 0);

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(besieger, MoveGoal)).toBe(false);
    expect(sim.world.get(besieger, Settler).hunger).toBe(fx.sub(PRESSING, MEAD_SIP));
    // The sip does not release the fight.
    expect(sim.world.has(besieger, Engagement)).toBe(true);
    expect(sim.world.has(besieger, AttackOrder)).toBe(true);
  });

  it('a hungry CHASER drinks mid-march without stopping', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(12, 1) });
    const chaser = hungryFighterAt(sim, 0, 0);
    carryMead(sim, chaser);
    sim.world.add(chaser, Engagement, { repathAt: sim.tick + 8 });
    // Travelling: the drive ladder never runs for a settler on a live route.
    sim.world.add(chaser, MoveGoal, { cell: cellNode(sim, 10, 0) });

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(chaser, Settler).hunger).toBe(fx.sub(PRESSING, MEAD_SIP));
    expect(sim.world.has(chaser, CurrentAtomic)).toBe(false);
    expect(sim.world.has(chaser, MoveGoal)).toBe(true);
    expect(sim.world.has(chaser, Engagement)).toBe(true);
  });

  it('a CHASER ordered to eat on a fed bar keeps its mead for when it is hungry', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(12, 1) });
    const chaser = fighterAt(sim, 0, 0, VIKING, WOODCUTTER, { owner: P0 });
    sim.world.mut(chaser, Settler).hunger = FED;
    carryMead(sim, chaser);
    sim.world.add(chaser, NeedOrder, { need: 'hunger' });
    sim.world.add(chaser, Engagement, { repathAt: sim.tick + 8 });
    sim.world.add(chaser, MoveGoal, { cell: cellNode(sim, 10, 0) });

    plannerSystem(sim.world, ctxOf(sim));

    // The flask answers the bar, never the order, as it does off the march.
    expect(sim.world.get(chaser, Equipment).misc[0]).toEqual(FRESH_MEAD);
    expect(sim.world.has(chaser, MoveGoal)).toBe(true);
  });

  it('a hungry BESIEGER whose needs a script froze neither eats its ration nor drinks', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(12, 1) });
    const besieger = hungryFighterAt(sim, 10, 0);
    sim.world.add(besieger, Carrying, { goodType: FOOD, amount: 2 });
    carryMead(sim, besieger);
    sim.world.add(besieger, Engagement, { repathAt: sim.tick });
    // Frozen bars never move, so a meal here would spend the ration and leave the bar pressing for the
    // next one.
    setMissionBehaviour(sim.world, besieger, MISSION_BEHAVIOUR.NEEDS_FROZEN, true);

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(besieger, CurrentAtomic)).toBe(false);
    expect(sim.world.get(besieger, Carrying).amount).toBe(2);
    expect(sim.world.get(besieger, Equipment).misc[0]).toEqual(FRESH_MEAD);
  });

  it('a hungry CHASER off the lattice drinks at its next node, not mid-leg', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(12, 1) });
    const chaser = hungryFighterAt(sim, 0, 0);
    carryMead(sim, chaser);
    sim.world.add(chaser, Engagement, { repathAt: sim.tick + 8 });
    sim.world.add(chaser, MoveGoal, { cell: cellNode(sim, 10, 0) });
    // A third of a cell along: eating here would park a body off centre, mid-lane.
    sim.world.mut(chaser, Position).x = fx.div(ONE, fx.fromInt(3));

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(chaser, Equipment).misc[0]).toEqual(FRESH_MEAD); // the sip waits for the node
    expect(sim.world.has(chaser, MoveGoal)).toBe(true);
  });

  it('a sated CHASER keeps walking its route', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(12, 1) });
    const chaser = fighterAt(sim, 0, 0, VIKING, WOODCUTTER, { owner: P0 });
    carryMead(sim, chaser);
    sim.world.add(chaser, Engagement, { repathAt: sim.tick + 8 });
    sim.world.add(chaser, MoveGoal, { cell: cellNode(sim, 10, 0) });

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(chaser, Equipment).misc[0]).toEqual(FRESH_MEAD); // no need pressing - no sip spent
    expect(sim.world.has(chaser, MoveGoal)).toBe(true);
  });

  it('a hungry attacker drinks mid-fight and goes on swinging, over real ticks', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(12, 1) });
    const attacker = fighterAt(sim, 0, 0, VIKING, WOODCUTTER, { owner: P0, hitpoints: 1_000_000 });
    carryMead(sim, attacker);
    sim.world.mut(attacker, Settler).hunger = PRESSING;
    const enemy = fighterAt(sim, 6, 0, FRANK, WOODCUTTER, { owner: P1, hitpoints: 1_000_000 });
    larderAt(sim, 0, 0);

    sim.enqueueSetup({ kind: 'attackUnit', entity: attacker, target: enemy });
    // The wound is read as it lands: a fed settler heals between blows, so this dummy is back at its
    // ceiling by the end of the run.
    let lowestEnemy = 1_000_000;
    for (let i = 0; i < 240; i++) {
      sim.step();
      lowestEnemy = Math.min(lowestEnemy, sim.world.get(enemy, Health).hitpoints);
    }

    expect(sim.world.get(attacker, Equipment).misc[0]?.degreeOfUse).toBeGreaterThan(fx.fromInt(0));
    expect(sim.world.get(attacker, Settler).hunger).toBeLessThan(PRESSING); // and the bar actually fell
    expect(sim.world.has(attacker, AttackOrder)).toBe(true); // the order survived the sip
    expect(lowestEnemy).toBeLessThan(1_000_000); // it closed and struck
  });

  it('a hungry besieger issues no route across a running siege', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(12, 1) });
    const besieger = hungryFighterAt(sim, 5, 0); // no rations: nothing to answer the need with
    const enemy = fighterAt(sim, 6, 0, FRANK, WOODCUTTER, { owner: P1, hitpoints: 1_000_000 });
    larderAt(sim, 0, 0);

    // The idle ticks between swings used to re-run the food search and issue a route on every one, which
    // combat then threw away.
    sim.enqueueSetup({ kind: 'attackUnit', entity: besieger, target: enemy });
    let routed = 0;
    for (let tick = 0; tick < 120; tick++) {
      sim.step();
      if (sim.world.has(besieger, MoveGoal) || sim.world.has(besieger, PathRequest)) routed++;
    }

    expect(routed).toBe(0);
    expect(sim.world.get(besieger, Settler).hunger).toBeGreaterThanOrEqual(PRESSING); // still unfed
  });
});
