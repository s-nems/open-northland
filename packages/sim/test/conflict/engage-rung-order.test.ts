import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  Anger,
  AttackOrder,
  addCurrentAtomic,
  Building,
  Carrying,
  CurrentAtomic,
  Engagement,
  Fleeing,
  Health,
  HuntFocus,
  HuntRest,
  JobAssignment,
  MoveGoal,
  Owner,
  PlayerOrder,
  Position,
  Stance,
  Weapon,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { cellAnchorNode, fx, ONE, Simulation } from '../../src/index.js';
import type { NodeId } from '../../src/nav/terrain/index.js';
import { attackerWeapon } from '../../src/systems/conflict/weapons.js';
import { combatSystem } from '../../src/systems/index.js';
import { MILITARY_MODE, type MilitaryMode } from '../../src/systems/readviews/index.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf, fleeCheckCtxOf } from '../fixtures/context.js';
import { addSettlerOfTribe } from '../fixtures/settler.js';
import { grassCellMap } from '../fixtures/terrain.js';

/**
 * `engageCombatant` resolves one combatant through an ordered ladder of gates whose order is behavior. Each
 * case here makes an adjacent pair of rungs - or the nearest separable pair - true at once and asserts the
 * upper one's outcome, so a rung that moves fails here rather than in a golden hash.
 *
 * Three pairs cannot be separated and are deliberately absent. `busyOrFelled` / `suppressedByMoveOrder`
 * both bench silently with no side effect, so each is pinned against the flee rung instead.
 * `ignoresCombat` / `carriesKillHome` cannot hold together, since the first exempts hunters and the second
 * requires one. The empty-search rung and the swing rung are split by a data dependency, not a policy: one
 * needs a resolved target and the other needs none.
 *
 * Building the stance is not a rung, but `liveAttackOrder` mutates as it reads, so where the bench rungs
 * sit relative to it is behavior too and is pinned the same way.
 */

const VIKING = 1;
/** Another civilization, so an unowned pair is hostile by tribe alone. */
const FRANK = 2;
/** Passive, provokable, and armed (`test_tusk`) - the animal that reaches the weapon rung armed. */
const BOAR = 12;
/** Passive livestock and the one animal tribe the fixture arms with nothing. */
const COW = 13;
const WOODCUTTER = 1;
const HUNTER = 15;
/** The fighter class a tower post binds; `isFighterJob` reads the role off the `soldier_unarmed` slug. */
const SOLDIER = 31;
const MEAT = 21;
const HARVEST_ATOMIC = 24;
/** No weapon row carries this id, so a settler wearing it resolves to unarmed. */
const UNKNOWN_WEAPON_TYPE = 999;
const P0 = 0;
const P1 = 1;
const TOWER_TYPE = 92;

interface PersonOpts {
  readonly tribe?: number;
  readonly owner?: number;
  readonly mode?: MilitaryMode;
}

function personAt(sim: Simulation, x: number, y: number, jobType: number, opts: PersonOpts = {}): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  addSettlerOfTribe(sim, e, {
    tribe: opts.tribe ?? VIKING,
    jobType,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
  });
  sim.world.add(e, Health, { hitpoints: 2000, max: 2000 });
  if (opts.owner !== undefined) sim.world.add(e, Owner, { player: opts.owner });
  if (opts.mode !== undefined) sim.world.add(e, Stance, { mode: opts.mode, anchorCell: null });
  return e;
}

function beastAt(sim: Simulation, x: number, y: number, tribe: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  addSettlerOfTribe(sim, e, {
    tribe,
    jobType: null,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
  });
  sim.world.add(e, Health, { hitpoints: 500, max: 500 });
  return e;
}

function nodeOfCell(sim: Simulation, x: number, y: number): NodeId {
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('mapped sim expected');
  const n = cellAnchorNode(x, y);
  return terrain.nodeAtClamped(n.hx, n.hy);
}

/** A busy settler: any running atomic benches the combat drive for its whole length. The clip is the
 *  fixture's wood harvest, chosen only because the ladder never reads which atomic is running. */
function startAtomic(sim: Simulation, e: Entity): void {
  addCurrentAtomic(sim.world, e, {
    atomicId: HARVEST_ATOMIC,
    duration: 8,
    effect: { kind: 'idle' },
    targetEntity: null,
    targetTile: null,
  });
}

function engage(sim: Simulation): void {
  combatSystem(sim.world, ctxOf(sim));
}

describe('engage ladder - the post rung sits above the busy rung', () => {
  /** A tower whose only worker slot is the fighting class, so `towerPostFor` binds a soldier assigned to it. */
  function towerContent(): ContentSet {
    const base = testContent();
    return parseContentSet({
      ...base,
      buildings: [
        ...base.buildings,
        {
          typeId: TOWER_TYPE,
          id: 'tower',
          kind: 'tower',
          workers: [{ jobType: SOLDIER, count: 1 }],
          footprint: { blocked: [{ dx: 0, dy: 0 }], door: { dx: 2, dy: 0 } },
        },
      ],
    });
  }

  /** A soldier posted to a tower but standing away from it - entitled to the post, not yet holding it. */
  function soldierClimbingToPost(): { sim: Simulation; soldier: Entity } {
    const sim = new Simulation({ seed: 1, content: towerContent(), map: grassCellMap(12, 4) });
    const tower = sim.world.create();
    sim.world.add(tower, Position, { x: fx.fromInt(8), y: fx.fromInt(1) });
    sim.world.add(tower, Building, { buildingType: TOWER_TYPE, tribe: VIKING, built: ONE, level: 0 });
    sim.world.add(tower, Health, { hitpoints: 5000, max: 5000 });
    sim.world.add(tower, Owner, { player: P0 });
    const soldier = personAt(sim, 2, 1, SOLDIER, { owner: P0, mode: MILITARY_MODE.ATTACK });
    sim.world.add(soldier, JobAssignment, { workplace: tower });
    sim.world.add(soldier, Engagement, { repathAt: sim.tick });
    return { sim, soldier };
  }

  it('releases the engagement of a soldier still walking to its post, even mid-atomic', () => {
    const { sim, soldier } = soldierClimbingToPost();
    startAtomic(sim, soldier);

    engage(sim);

    expect(sim.world.has(soldier, Engagement)).toBe(false);
  });

  it('keeps the engagement of a mid-atomic soldier that holds no post', () => {
    const { sim, soldier } = soldierClimbingToPost();
    sim.world.remove(soldier, JobAssignment);
    startAtomic(sim, soldier);

    engage(sim);

    expect(sim.world.has(soldier, Engagement)).toBe(true);
  });
});

describe('engage ladder - the two silent bench rungs sit above the flee rung', () => {
  /** A FLEE-stance civilian with a rival player's unit close enough to run from. Each pass below runs on its
   *  flee-check tick, so a missing flee is the rung's doing, not the stride's. */
  function threatenedCiv(): { sim: Simulation; civ: Entity } {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(40, 1) });
    const civ = personAt(sim, 20, 0, WOODCUTTER, { owner: P0, mode: MILITARY_MODE.FLEE });
    personAt(sim, 25, 0, WOODCUTTER, { owner: P1, mode: MILITARY_MODE.IGNORE });
    return { sim, civ };
  }

  it('stamps the flee when nothing benches the civilian first', () => {
    const { sim, civ } = threatenedCiv();

    combatSystem(sim.world, fleeCheckCtxOf(sim, civ));

    expect(sim.world.has(civ, Fleeing)).toBe(true);
  });

  it('does not stamp the flee on a mid-atomic civilian', () => {
    const { sim, civ } = threatenedCiv();
    startAtomic(sim, civ);

    combatSystem(sim.world, fleeCheckCtxOf(sim, civ));

    expect(sim.world.has(civ, Fleeing)).toBe(false);
  });

  it('does not stamp the flee on a civilian under a plain move order', () => {
    const { sim, civ } = threatenedCiv();
    sim.world.add(civ, PlayerOrder, {});

    combatSystem(sim.world, fleeCheckCtxOf(sim, civ));

    expect(sim.world.has(civ, Fleeing)).toBe(false);
  });
});

describe('engage ladder - the bench rungs sit above the stale attack-order reap', () => {
  /** A unit whose attack order names a corpse: reading that order is what drops it. */
  function orderedAtACorpse(): { sim: Simulation; soldier: Entity } {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(12, 1) });
    const soldier = personAt(sim, 2, 0, WOODCUTTER, { owner: P0, mode: MILITARY_MODE.ATTACK });
    const corpse = personAt(sim, 4, 0, WOODCUTTER, { owner: P1, mode: MILITARY_MODE.IGNORE });
    sim.world.mut(corpse, Health).hitpoints = 0;
    sim.world.add(soldier, AttackOrder, { target: corpse });
    return { sim, soldier };
  }

  it('leaves a mid-atomic unit’s dead attack order standing', () => {
    const { sim, soldier } = orderedAtACorpse();
    startAtomic(sim, soldier);

    engage(sim);

    expect(sim.world.has(soldier, AttackOrder)).toBe(true);
  });

  it('drops the same dead attack order once the unit is free', () => {
    const { sim, soldier } = orderedAtACorpse();

    engage(sim);

    expect(sim.world.has(soldier, AttackOrder)).toBe(false);
  });
});

describe('engage ladder - the flee rung sits above the passive-stance rung', () => {
  it('sheds the stale flee state of an IGNORE-stance civilian before standing it down', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(40, 1) });
    const civ = personAt(sim, 20, 0, WOODCUTTER, { owner: P0, mode: MILITARY_MODE.IGNORE });
    personAt(sim, 25, 0, WOODCUTTER, { owner: P1, mode: MILITARY_MODE.IGNORE });
    sim.world.add(civ, Fleeing, { repathAt: 0, calmUntil: null });
    sim.world.add(civ, Engagement, { repathAt: sim.tick });

    engage(sim);

    // The passive rung's disengage would have returned with the marker still standing.
    expect(sim.world.has(civ, Fleeing)).toBe(false);
    expect(sim.world.has(civ, Engagement)).toBe(false);
  });
});

describe('engage ladder - the carried-kill rung sits above the other-drive rung', () => {
  /** A loaded hunter walking home: travelling, unengaged, and holding the prey it just felled. */
  function loadedHunter(): { sim: Simulation; hunter: Entity } {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(20, 1) });
    const hunter = personAt(sim, 5, 0, HUNTER, { owner: P0, mode: MILITARY_MODE.IGNORE });
    const prey = beastAt(sim, 7, 0, COW);
    sim.world.add(hunter, MoveGoal, { cell: nodeOfCell(sim, 1, 0) });
    sim.world.add(hunter, HuntFocus, { target: prey });
    return { sim, hunter };
  }

  it('drops the prey hold of a travelling hunter that carries a kill', () => {
    const { sim, hunter } = loadedHunter();
    sim.world.add(hunter, Carrying, { goodType: MEAT, amount: 1 });

    engage(sim);

    expect(sim.world.has(hunter, HuntFocus)).toBe(false);
  });

  it('keeps the prey hold of the same travelling hunter with empty hands', () => {
    const { sim, hunter } = loadedHunter();

    engage(sim);

    expect(sim.world.has(hunter, HuntFocus)).toBe(true);
  });
});

describe('engage ladder - the other-drive rung sits above the passive-animal rung', () => {
  /** A boar whose provocation has run out: the passive-animal rung reaps the timer as it reads it. */
  function cooledBoar(): { sim: Simulation; boar: Entity } {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(20, 1) });
    const boar = beastAt(sim, 5, 0, BOAR);
    sim.world.add(boar, Anger, { until: sim.tick });
    return { sim, boar };
  }

  it('leaves a travelling boar’s lapsed anger unread', () => {
    const { sim, boar } = cooledBoar();
    sim.world.add(boar, MoveGoal, { cell: nodeOfCell(sim, 1, 0) });

    engage(sim);

    expect(sim.world.has(boar, Anger)).toBe(true);
  });

  it('reaps the lapsed anger of the same boar standing still', () => {
    const { sim, boar } = cooledBoar();

    engage(sim);

    expect(sim.world.has(boar, Anger)).toBe(false);
  });
});

describe('engage ladder - the passive-animal rung sits above the weapon rung', () => {
  it('reaps an unarmed cow’s lapsed anger instead of benching it as unarmed', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(20, 1) });
    const cow = beastAt(sim, 5, 0, COW);
    sim.world.add(cow, Anger, { until: sim.tick });

    // Non-vacuity: the cow really does reach the weapon rung unarmed, so that rung would bench it first.
    expect(attackerWeapon(ctxOf(sim), COW, null)).toBeNull();

    engage(sim);

    expect(sim.world.has(cow, Anger)).toBe(false);
  });
});

describe('engage ladder - the weapon rung sits above the hunt-rest rung', () => {
  /** A resting hunter holding prey: the hunt-rest rung benches it before any acquisition. */
  function restingHunter(): { sim: Simulation; hunter: Entity } {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(20, 1) });
    const hunter = personAt(sim, 5, 0, HUNTER, { owner: P0, mode: MILITARY_MODE.IGNORE });
    const prey = beastAt(sim, 8, 0, COW);
    sim.world.add(hunter, HuntRest, { until: sim.tick + 1 }); // live through this tick
    sim.world.add(hunter, HuntFocus, { target: prey });
    return { sim, hunter };
  }

  it('drops the prey hold of a resting hunter that cannot resolve a weapon', () => {
    const { sim, hunter } = restingHunter();
    sim.world.add(hunter, Weapon, { weaponTypeId: UNKNOWN_WEAPON_TYPE });

    engage(sim);

    expect(sim.world.has(hunter, HuntFocus)).toBe(false);
  });

  it('keeps the prey hold of the same resting hunter with its class weapon', () => {
    const { sim, hunter } = restingHunter();

    engage(sim);

    expect(sim.world.has(hunter, HuntFocus)).toBe(true);
  });
});

describe('engage ladder - the hunt-rest rung sits above the empty-search rung', () => {
  /** A hunter holding something that is not prey, with the only game far outside its sight. */
  function staleHoldHunter(): { sim: Simulation; hunter: Entity; held: Entity } {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(60, 1) });
    const hunter = personAt(sim, 2, 0, HUNTER, { owner: P0, mode: MILITARY_MODE.IGNORE });
    const held = personAt(sim, 3, 0, WOODCUTTER, { owner: P0, mode: MILITARY_MODE.IGNORE });
    beastAt(sim, 58, 0, COW);
    sim.world.add(hunter, HuntFocus, { target: held });
    return { sim, hunter, held };
  }

  it('keeps a resting hunter’s stale prey hold unexamined', () => {
    const { sim, hunter, held } = staleHoldHunter();
    sim.world.add(hunter, HuntRest, { until: sim.tick + 1 }); // live through this tick

    engage(sim);

    expect(sim.world.tryGet(hunter, HuntFocus)?.target).toBe(held);
  });

  it('reaps the same stale prey hold once the hunter is not resting', () => {
    const { sim, hunter } = staleHoldHunter();

    engage(sim);

    expect(sim.world.has(hunter, HuntFocus)).toBe(false);
  });
});

describe('engage ladder - the swing rung sits above the no-advance rung', () => {
  it('swings with an unowned civilian that would never walk toward a target', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(12, 1) });
    const civ = personAt(sim, 0, 0, WOODCUTTER);
    const enemy = personAt(sim, 1, 0, WOODCUTTER, { tribe: FRANK });

    engage(sim);

    expect(sim.world.get(civ, CurrentAtomic).effect).toMatchObject({ kind: 'attack', target: enemy });
  });

  it('benches the same unowned civilian while its enemy is in reach but it is still moving', () => {
    // In the band, so the search finds it, but mid-walk, so the swing rung declines and the no-advance
    // rung is the one that answers. The Engagement keeps the other-drive rung from taking it first.
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(12, 1) });
    const civ = personAt(sim, 0, 0, WOODCUTTER);
    personAt(sim, 1, 0, WOODCUTTER, { tribe: FRANK });
    sim.world.add(civ, Engagement, { repathAt: sim.tick });
    sim.world.add(civ, MoveGoal, { cell: nodeOfCell(sim, 8, 0) });

    engage(sim);

    expect(sim.world.has(civ, CurrentAtomic)).toBe(false); // it did not swing
    expect(sim.world.has(civ, Engagement)).toBe(false); // the no-advance rung disengaged it
    expect(sim.world.has(civ, MoveGoal)).toBe(false);
  });
});
