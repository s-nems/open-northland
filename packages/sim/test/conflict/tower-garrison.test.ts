import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  addPerson,
  Building,
  CurrentAtomic,
  DeferredOrder,
  Engagement,
  EquipOrder,
  Garrison,
  Health,
  JobAssignment,
  MoveGoal,
  Owner,
  Position,
  Projectile,
  Resting,
  Settler,
  Stance,
  Stockpile,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { fx, nodeOfPosition, ONE, Simulation } from '../../src/index.js';
import type { NodeId } from '../../src/nav/terrain/index.js';
import { TOWER_RANGE_BONUS_NODES } from '../../src/systems/conflict/tower-post.js';
import { plannerSystem } from '../../src/systems/index.js';
import { MILITARY_MODE } from '../../src/systems/readviews/index.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf, grassMap } from '../settlers/needs/support.js';

/**
 * The tower garrison: a bow soldier posted to a watchtower walks in, holds it, and shoots from cover at
 * the tower's extended reach without ever stepping out. `houses.ini` gives the towers exactly these posts
 * (`logicworker 40 3`/`41 3` on `tower 00`, 4/4 on `tower 01`); what manning one DOES - the shelter, the
 * reach bonus - is the approximation the feature names (see `systems/conflict/tower-post.ts`).
 *
 * The fixture mirrors that shape at fixture scale: a `tower` kind employing the base soldier class plus a
 * hauler, and a bow for that class whose plain reach is short enough that the +8 is what decides.
 */

const VIKING = 1;
const HUMAN = 0;
const ENEMY = 1;
const CIVILIST_JOB = 6;
const CARRIER_JOB = 24;
const SOLDIER_JOB = 31;
const TOWER_TYPE = 92;
const HEADQUARTERS_TYPE = 1;
const FOOD_GOOD = 3;
/** The garrison bow: `maxRange 4` plain, so a target at 10 nodes is reachable only from the tower
 *  (4 + {@link TOWER_RANGE_BONUS_NODES} = 12) - the bonus, not the bow, is what lands the shot. */
const GARRISON_BOW_RANGE = 4;
const ARROW_MUNITION = 1;
/** Well over the drive threshold - a garrison this hungry leaves the tower for the larder. */
const STARVING = fx.div(fx.fromInt(9), fx.fromInt(10));
/** Over the drive threshold, with hunger left at zero so the sleep rung is the one that fires. */
const EXHAUSTED = fx.div(fx.fromInt(9), fx.fromInt(10));
const SLEEP_ATOMIC = 8;
/** Long enough for the walk to the door plus the step inside. */
const WALK_TICKS = 120;

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
        // The real shape: the fighting-class posts plus the haulers that keep the tower stocked.
        workers: [
          { jobType: SOLDIER_JOB, count: 1 },
          { jobType: CARRIER_JOB, count: 1 },
        ],
        stock: [{ goodType: FOOD_GOOD, capacity: 25, initial: 0 }],
        // A door two nodes off the anchor: without it the interaction cell IS the tower tile and every
        // "he stands on the post, not the doorstep" assertion below would hold vacuously.
        footprint: { blocked: [{ dx: 0, dy: 0 }], door: { dx: 2, dy: 0 } },
      },
    ],
    weapons: [
      ...base.weapons,
      {
        typeId: 20,
        id: 'test_garrison_bow',
        tribeType: VIKING,
        jobType: SOLDIER_JOB,
        munitionType: ARROW_MUNITION,
        speed: 8,
        minRange: 2,
        maxRange: GARRISON_BOW_RANGE,
        // Column 7 is the vs-building one, so an attacker that cannot reach the garrison can still
        // batter the tower it hides in.
        damage: { '0': 400, '7': 400 },
      },
    ],
  });
}

function simWithTower(): Simulation {
  return new Simulation({ seed: 1, content: towerContent(), map: grassMap(24, 8) });
}

/** The tower's life pool - deep enough to outlast the exchanges below, so no test's tower is razed
 *  out from under its garrison mid-run. */
const TOWER_HITPOINTS = 1_000_000;

function towerAt(sim: Simulation, x: number, y: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Building, { buildingType: TOWER_TYPE, tribe: VIKING, built: ONE, level: 0 });
  sim.world.add(e, Health, { hitpoints: TOWER_HITPOINTS, max: TOWER_HITPOINTS });
  sim.world.add(e, Owner, { player: HUMAN });
  return e;
}

/** A built headquarters stocked with food - the larder a hungry garrison walks out to. */
function larderAt(sim: Simulation, x: number, y: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Building, { buildingType: HEADQUARTERS_TYPE, tribe: VIKING, built: ONE, level: 0 });
  sim.world.add(e, Owner, { player: HUMAN });
  sim.world.add(e, Stockpile, { amounts: new Map([[FOOD_GOOD, 5]]) });
  return e;
}

function settlerAt(
  sim: Simulation,
  jobType: number,
  x: number,
  y: number,
  owner = HUMAN,
  hitpoints = 2000,
): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  addPerson(sim.world, e, {
    tribe: VIKING,
    jobType,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map<number, number>(),
  });
  sim.world.add(e, Health, { hitpoints, max: hitpoints });
  sim.world.add(e, Owner, { player: owner });
  sim.world.add(e, Stance, { mode: MILITARY_MODE.ATTACK, anchorCell: null });
  return e;
}

/** Deep enough that a two-hundred-tick exchange wounds but never kills - a reaped corpse would take its
 *  Health component with it and the assertions could not read the wound. */
const TOUGH = 1_000_000;

function run(sim: Simulation, ticks: number): void {
  for (let i = 0; i < ticks; i++) sim.step();
}

/** The lowest `hitpoints` of `e` over `ticks` ticks. A fed settler heals between volleys, so the wound is
 *  read as it lands rather than off the end state. */
function lowestHitpoints(sim: Simulation, ticks: number, e: Entity): number {
  let lowest = sim.world.get(e, Health).hitpoints;
  for (let i = 0; i < ticks; i++) {
    sim.step();
    lowest = Math.min(lowest, sim.world.get(e, Health).hitpoints);
  }
  return lowest;
}

/** Post `soldier` to `tower` and run until he is up there (or the walk budget runs out). */
function manTheTower(sim: Simulation, soldier: Entity, tower: Entity): void {
  sim.enqueueSetup({ kind: 'assignWorker', entity: soldier, building: tower, jobPriority: [SOLDIER_JOB] });
  run(sim, WALK_TICKS);
}

/** The terrain node id under tile `(x, y)` - the id space an order's `returnTo` is compared in. */
function terrainNodeAt(sim: Simulation, x: number, y: number): NodeId {
  const n = nodeOfPosition(fx.fromInt(x), fx.fromInt(y));
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('mapped sim expected');
  return terrain.nodeAtClamped(n.hx, n.hy);
}

function tileOf(sim: Simulation, e: Entity): { x: number; y: number } {
  const p = sim.world.get(e, Position);
  return { x: fx.toInt(p.x), y: fx.toInt(p.y) };
}

describe('the tower garrison - taking the post', () => {
  it('posts a soldier of the tower’s own fighting class and walks him inside', () => {
    const sim = simWithTower();
    const tower = towerAt(sim, 6, 3);
    const soldier = settlerAt(sim, SOLDIER_JOB, 2, 3);

    manTheTower(sim, soldier, tower);

    expect(sim.world.tryGet(soldier, JobAssignment)).toEqual({ workplace: tower });
    expect(sim.world.tryGet(soldier, Garrison)?.post).toBe(tower);
    expect(sim.world.tryGet(soldier, Resting)?.at).toBe(tower); // inside, so the render hides him
    // Manning moves him onto the tower's own tile, which is what the shot is measured and loosed from.
    expect(tileOf(sim, soldier)).toEqual(tileOf(sim, tower));
    expect(sim.world.get(soldier, Settler).jobType).toBe(SOLDIER_JOB); // still his own class
  });

  it('refuses a civilian the post and puts him on the hauler slot instead', () => {
    const sim = simWithTower();
    const tower = towerAt(sim, 6, 3);
    const civilian = settlerAt(sim, CIVILIST_JOB, 2, 3);

    // The right-click priority a tower offers a non-fighter: its own class is never on the list, so the
    // command only ever reaches the hauler slot.
    sim.enqueueSetup({
      kind: 'assignWorker',
      entity: civilian,
      building: tower,
      jobPriority: [SOLDIER_JOB, CARRIER_JOB],
    });
    run(sim, 2);

    expect(sim.world.get(civilian, Settler).jobType).toBe(CARRIER_JOB);
    expect(sim.world.has(civilian, Garrison)).toBe(false);
  });

  it('stands the garrison down when its tower is razed', () => {
    const sim = simWithTower();
    const tower = towerAt(sim, 6, 3);
    const soldier = settlerAt(sim, SOLDIER_JOB, 2, 3);
    manTheTower(sim, soldier, tower);
    const rubble = tileOf(sim, soldier);

    sim.world.destroy(tower);
    run(sim, 2);

    expect(sim.world.has(soldier, Garrison)).toBe(false);
    expect(sim.world.has(soldier, Resting)).toBe(false);
    // He keeps the tile he was standing on - the footprint went down with the tower, and there is no
    // doorstep left to put him back on.
    expect(tileOf(sim, soldier)).toEqual(rubble);
  });

  it('is byte-identical across two same-seed runs (determinism)', () => {
    const post = (): { hash: string; manned: boolean } => {
      const sim = simWithTower();
      const tower = towerAt(sim, 6, 3);
      const soldier = settlerAt(sim, SOLDIER_JOB, 2, 3);
      manTheTower(sim, soldier, tower);
      return { hash: sim.hashState(), manned: sim.world.tryGet(soldier, Garrison)?.post === tower };
    };
    const a = post();
    const b = post();
    expect(a.manned).toBe(true); // the walk and the posting really ran (not a vacuous hash)
    expect(a.hash).toBe(b.hash);
  });
});

describe('the tower garrison - calling the posting off', () => {
  it('a walk order releases the garrison, and he stays off the wall', () => {
    const sim = simWithTower();
    const tower = towerAt(sim, 6, 3);
    const soldier = settlerAt(sim, SOLDIER_JOB, 2, 3);
    manTheTower(sim, soldier, tower);

    sim.enqueueSetup({ kind: 'moveUnit', entity: soldier, x: 2, y: 6 });
    run(sim, 40);

    expect(sim.world.has(soldier, JobAssignment)).toBe(false); // the posting is cancelled outright
    expect(sim.world.has(soldier, Garrison)).toBe(false); // off the wall, so no reach bonus, no cover
    expect(sim.world.has(soldier, Resting)).toBe(false); // and drawn again
    expect(tileOf(sim, soldier)).not.toEqual(tileOf(sim, tower));

    // Without the release the post would pull him straight back the tick the order retires.
    run(sim, 400);
    expect(sim.world.has(soldier, JobAssignment)).toBe(false);
    expect(sim.world.has(soldier, Garrison)).toBe(false);
    expect(tileOf(sim, soldier)).not.toEqual(tileOf(sim, tower));
  });

  it('an explicit unassignWorker releases him exactly as the walk order does', () => {
    const sim = simWithTower();
    const tower = towerAt(sim, 6, 3);
    const soldier = settlerAt(sim, SOLDIER_JOB, 2, 3);
    manTheTower(sim, soldier, tower);

    sim.enqueueSetup({ kind: 'unassignWorker', entity: soldier });
    sim.step();

    expect(sim.world.has(soldier, JobAssignment)).toBe(false);
    expect(sim.world.has(soldier, Garrison)).toBe(false);
    expect(sim.world.has(soldier, Resting)).toBe(false);
    expect(tileOf(sim, soldier)).not.toEqual(tileOf(sim, tower)); // back on the doorstep, not the post
    expect(sim.world.get(soldier, Settler).jobType).toBe(SOLDIER_JOB); // still a soldier

    run(sim, 400);
    expect(sim.world.has(soldier, JobAssignment)).toBe(false); // and the post never reclaims him
  });

  it('releases a garrison still on his way to the tower', () => {
    const sim = simWithTower();
    const tower = towerAt(sim, 6, 3);
    const soldier = settlerAt(sim, SOLDIER_JOB, 2, 3);
    sim.enqueueSetup({ kind: 'assignWorker', entity: soldier, building: tower, jobPriority: [SOLDIER_JOB] });
    run(sim, 4); // walking to the door, not up there yet

    sim.enqueueSetup({ kind: 'moveUnit', entity: soldier, x: 2, y: 6 });
    run(sim, 400);

    expect(sim.world.has(soldier, JobAssignment)).toBe(false);
    expect(sim.world.has(soldier, Garrison)).toBe(false);
  });

  it('leaves an ordinary worker of the same tower his job', () => {
    // The release is post-scoped: sending a hauler somewhere is the old "go there, then back to work",
    // and only the man whose work IS the watch loses his workplace.
    const sim = simWithTower();
    const tower = towerAt(sim, 6, 3);
    const hauler = settlerAt(sim, CARRIER_JOB, 2, 3);
    sim.enqueueSetup({ kind: 'assignWorker', entity: hauler, building: tower, jobPriority: [CARRIER_JOB] });
    run(sim, 4);

    sim.enqueueSetup({ kind: 'moveUnit', entity: hauler, x: 2, y: 6 });
    run(sim, 40);

    expect(sim.world.tryGet(hauler, JobAssignment)).toEqual({ workplace: tower });
  });

  it('an order parked behind a meal takes him off the tile the tick it finally fires', () => {
    // A deferred order re-dispatches AFTER the planner has run, so a release that left the tile to the
    // re-plan would leave a man standing on a post he no longer holds - and that same tick's combat pass
    // would still read him as sheltered, untargetable out in the open.
    const sim = simWithTower();
    const tower = towerAt(sim, 6, 3);
    sim.world.add(tower, Stockpile, { amounts: new Map([[FOOD_GOOD, 5]]) });
    const soldier = settlerAt(sim, SOLDIER_JOB, 2, 3);
    manTheTower(sim, soldier, tower);
    sim.world.mut(soldier, Settler).hunger = STARVING;
    for (let i = 0; i < WALK_TICKS && !sim.world.has(soldier, CurrentAtomic); i++) sim.step();
    expect(sim.world.has(soldier, CurrentAtomic)).toBe(true); // eating at his post

    sim.enqueueSetup({ kind: 'moveUnit', entity: soldier, x: 2, y: 6 });
    sim.step();
    expect(sim.world.has(soldier, DeferredOrder)).toBe(true); // parked behind the meal, not discarded
    for (let i = 0; i < WALK_TICKS && sim.world.has(soldier, DeferredOrder); i++) sim.step();

    expect(sim.world.has(soldier, DeferredOrder)).toBe(false); // it fired this tick
    expect(sim.world.has(soldier, JobAssignment)).toBe(false);
    expect(sim.world.has(soldier, Garrison)).toBe(false);
    expect(tileOf(sim, soldier)).not.toEqual(tileOf(sim, tower));
  });
});

describe('the tower garrison - where the watch sits in the drive ladder', () => {
  it('climbs the tower even under a DEFEND stance - the post is the more specific standing order', () => {
    const sim = simWithTower();
    const tower = towerAt(sim, 6, 3);
    const soldier = settlerAt(sim, SOLDIER_JOB, 2, 3);
    sim.enqueueSetup({ kind: 'assignWorker', entity: soldier, building: tower, jobPriority: [SOLDIER_JOB] });
    run(sim, 2); // after the posting: it re-idles him, which re-stamps his stance to the class default
    sim.enqueueSetup({ kind: 'setStance', entity: soldier, mode: MILITARY_MODE.DEFEND });

    run(sim, WALK_TICKS);

    // Below the watch, the DEFEND rung would return and freeze him on the tile the stance was set on.
    expect(sim.world.get(soldier, Stance).mode).toBe(MILITARY_MODE.DEFEND);
    expect(sim.world.tryGet(soldier, Garrison)?.post).toBe(tower);
    expect(tileOf(sim, soldier)).toEqual(tileOf(sim, tower));
  });

  it('runs a player equip errand first - the watch waits for the man to come back with his gear', () => {
    const sim = simWithTower();
    const tower = towerAt(sim, 6, 3);
    const soldier = settlerAt(sim, SOLDIER_JOB, 2, 3);
    sim.enqueueSetup({ kind: 'assignWorker', entity: soldier, building: tower, jobPriority: [SOLDIER_JOB] });
    run(sim, 2);
    // The errand outranks the watch, so it holds him off the tower for as long as it lasts. Stamped
    // rather than ordered: what is under test is the rung order, not where the gear comes from.
    sim.world.add(soldier, EquipOrder, {
      group: 'weapon',
      slot: 0,
      goodType: null,
      returnTo: terrainNodeAt(sim, 2, 3),
      stage: 'acquire',
      issuer: 'player',
      queued: [],
    });

    run(sim, WALK_TICKS);

    expect(sim.world.has(soldier, Garrison)).toBe(false);
    expect(sim.world.tryGet(soldier, JobAssignment)).toEqual({ workplace: tower }); // still posted
  });
});

describe('the tower garrison - shooting from cover', () => {
  /** The tower's cell, and an enemy cell one full plain-reach beyond it - `GARRISON_BOW_RANGE` CELLS out
   *  is twice that many nodes, so the plain bow falls short and only the +8 covers it. */
  const TOWER_X = 6;
  const ROW = 3;
  const ENEMY_X = TOWER_X + GARRISON_BOW_RANGE;

  /** A standing enemy that soaks the shots without dying or shooting back. */
  function standingTarget(sim: Simulation, x: number): Entity {
    const e = settlerAt(sim, SOLDIER_JOB, x, ROW, ENEMY, TOUGH);
    sim.world.mut(e, Stance).mode = MILITARY_MODE.IGNORE;
    return e;
  }

  it('shoots a target its plain bow could not reach, without leaving the tower', () => {
    const sim = simWithTower();
    const tower = towerAt(sim, TOWER_X, ROW);
    const garrison = settlerAt(sim, SOLDIER_JOB, 2, ROW);
    manTheTower(sim, garrison, tower);
    const post = tileOf(sim, garrison);
    const shotAt = standingTarget(sim, ENEMY_X);

    // The target sits GARRISON_BOW_RANGE cells - twice that many nodes - from the tower, so the plain
    // band cannot cover it. Standing still throughout is what proves the reach did, not a step forward.
    expect(lowestHitpoints(sim, 200, shotAt)).toBeLessThan(TOUGH);
    expect(tileOf(sim, garrison)).toEqual(post);
  });

  it('wakes on its post to shoot a raider who comes into range', () => {
    const sim = simWithTower();
    const tower = towerAt(sim, TOWER_X, ROW);
    const garrison = settlerAt(sim, SOLDIER_JOB, 2, ROW);
    manTheTower(sim, garrison, tower);
    // A night's sleep far longer than the run, so only the raider can have ended it.
    sim.world.add(garrison, CurrentAtomic, {
      atomicId: SLEEP_ATOMIC,
      elapsed: 0,
      progress: fx.fromInt(0),
      duration: 10_000,
      effect: { kind: 'sleep' },
      targetEntity: garrison,
      targetTile: null,
    });
    const shotAt = standingTarget(sim, ENEMY_X);

    expect(lowestHitpoints(sim, 60, shotAt)).toBeLessThan(TOUGH);
    expect(sim.world.tryGet(garrison, Garrison)?.post).toBe(tower);
  });

  it('never leaves the tower to chase - it holds the post whatever it can see', () => {
    const sim = simWithTower();
    const tower = towerAt(sim, TOWER_X, ROW);
    const soldier = settlerAt(sim, SOLDIER_JOB, 2, ROW);
    manTheTower(sim, soldier, tower);
    const post = tileOf(sim, soldier);
    // Past the boosted band (12 nodes) but inside a soldier's 16-node sight: on open ground this is
    // exactly the target an ATTACK-stance soldier marches at.
    const outOfBand = GARRISON_BOW_RANGE + TOWER_RANGE_BONUS_NODES + 2; // nodes
    standingTarget(sim, TOWER_X + outOfBand / 2); // one cell is two nodes

    run(sim, 200);

    expect(tileOf(sim, soldier)).toEqual(post);
    expect(sim.world.has(soldier, Garrison)).toBe(true);
  });

  it('shoots under a passive stance too - the post overrides IGNORE and FLEE', () => {
    // Manning a tower IS the order to hold and shoot, so the two stances that would otherwise stand the
    // soldier down (IGNORE) or run him off (FLEE) do not apply while he is up there.
    for (const mode of [MILITARY_MODE.IGNORE, MILITARY_MODE.FLEE]) {
      const sim = simWithTower();
      const tower = towerAt(sim, TOWER_X, ROW);
      const garrison = settlerAt(sim, SOLDIER_JOB, 2, ROW);
      manTheTower(sim, garrison, tower);
      sim.world.mut(garrison, Stance).mode = mode;
      const post = tileOf(sim, garrison);
      const shotAt = standingTarget(sim, ENEMY_X);

      expect(lowestHitpoints(sim, 200, shotAt)).toBeLessThan(TOUGH);
      expect(tileOf(sim, garrison)).toEqual(post); // and a FLEE garrison did not bolt
    }
  });

  it('cannot be targeted while it holds the tower - the attackers must raze it', () => {
    const sim = simWithTower();
    const tower = towerAt(sim, TOWER_X, ROW);
    const soldier = settlerAt(sim, SOLDIER_JOB, 2, ROW);
    manTheTower(sim, soldier, tower);
    // An enemy archer parked beside the tower, with reach to spare and hitpoints to survive the exchange.
    settlerAt(sim, SOLDIER_JOB, TOWER_X + 1, ROW, ENEMY, TOUGH);

    const before = sim.world.get(soldier, Health).hitpoints;
    run(sim, 200);

    expect(sim.world.get(soldier, Health).hitpoints).toBe(before);
    // Its shots went into the tower instead - the structure is the only thing it can hit here.
    for (const p of sim.world.query(Projectile)) {
      expect(sim.world.get(p, Projectile).target).not.toBe(soldier);
    }
    expect(sim.world.get(tower, Health).hitpoints).toBeLessThan(TOWER_HITPOINTS);
  });
});

describe('the tower garrison - its needs', () => {
  it('sleeps at its post instead of walking home', () => {
    const sim = simWithTower();
    const tower = towerAt(sim, 6, 3);
    const soldier = settlerAt(sim, SOLDIER_JOB, 2, 3);
    manTheTower(sim, soldier, tower);
    const post = tileOf(sim, soldier);
    sim.world.mut(soldier, Settler).fatigue = EXHAUSTED;

    run(sim, 10);

    expect(sim.world.has(soldier, Garrison)).toBe(true);
    expect(tileOf(sim, soldier)).toEqual(post);
  });

  it('eats its post’s own rations without coming down', () => {
    const sim = simWithTower();
    const tower = towerAt(sim, 6, 3);
    sim.world.add(tower, Stockpile, { amounts: new Map([[FOOD_GOOD, 5]]) }); // `logicstock 16 25`
    const soldier = settlerAt(sim, SOLDIER_JOB, 2, 3);
    manTheTower(sim, soldier, tower);
    const post = tileOf(sim, soldier);
    sim.world.mut(soldier, Settler).hunger = STARVING;

    run(sim, 60);

    expect(sim.world.get(soldier, Settler).hunger).toBeLessThan(STARVING); // fed
    expect(sim.world.tryGet(soldier, Garrison)?.post).toBe(tower); // and never left the wall
    expect(tileOf(sim, soldier)).toEqual(post);
    expect(sim.world.get(tower, Stockpile).amounts.get(FOOD_GOOD)).toBeLessThan(5); // off its own shelf
  });

  it('eats its post’s rations while ENGAGED, the one meal a fighting unit can still reach', () => {
    const sim = simWithTower();
    const tower = towerAt(sim, 6, 3);
    sim.world.add(tower, Stockpile, { amounts: new Map([[FOOD_GOOD, 5]]) });
    const soldier = settlerAt(sim, SOLDIER_JOB, 2, 3);
    manTheTower(sim, soldier, tower);
    sim.world.mut(soldier, Settler).hunger = STARVING;
    sim.world.add(soldier, Engagement, { repathAt: sim.tick });

    plannerSystem(sim.world, ctxOf(sim));

    const atomic = sim.world.get(soldier, CurrentAtomic);
    expect(atomic.effect).toEqual({ kind: 'eat', goodType: FOOD_GOOD, from: tower });
    expect(sim.world.tryGet(soldier, Garrison)?.post).toBe(tower); // still on the wall
  });

  it('stays awake on its post while ENGAGED - a garrison under fire does not bed down', () => {
    const sim = simWithTower();
    const tower = towerAt(sim, 6, 3);
    const soldier = settlerAt(sim, SOLDIER_JOB, 2, 3);
    manTheTower(sim, soldier, tower);
    sim.world.mut(soldier, Settler).fatigue = EXHAUSTED;
    sim.world.add(soldier, Engagement, { repathAt: sim.tick });

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(soldier, CurrentAtomic)).toBe(false);
    expect(sim.world.tryGet(soldier, Garrison)?.post).toBe(tower);
  });

  it('holds an EMPTY tower while ENGAGED rather than climbing down to eat', () => {
    const sim = simWithTower();
    const tower = towerAt(sim, 6, 3); // no Stockpile: nothing to eat up there
    larderAt(sim, 18, 3);
    const soldier = settlerAt(sim, SOLDIER_JOB, 2, 3);
    manTheTower(sim, soldier, tower);
    sim.world.mut(soldier, Settler).hunger = STARVING;
    sim.world.add(soldier, Engagement, { repathAt: sim.tick });

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(soldier, MoveGoal)).toBe(false); // the wall outranks the larder under fire
    expect(sim.world.tryGet(soldier, Garrison)?.post).toBe(tower);
  });

  it('leaves an EMPTY tower for food, and comes back to the post once fed', () => {
    const sim = simWithTower();
    const tower = towerAt(sim, 6, 3);
    larderAt(sim, 18, 3);
    const soldier = settlerAt(sim, SOLDIER_JOB, 2, 3);
    manTheTower(sim, soldier, tower);
    sim.world.mut(soldier, Settler).hunger = STARVING;

    run(sim, 30);
    expect(sim.world.has(soldier, Garrison)).toBe(false); // off the wall, walking to the larder

    run(sim, 600);
    expect(sim.world.get(soldier, Settler).hunger).toBeLessThan(STARVING); // it ate
    expect(sim.world.tryGet(soldier, Garrison)?.post).toBe(tower); // and went back up
  });
});
