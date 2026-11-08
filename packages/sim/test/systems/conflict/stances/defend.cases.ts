import { describe, expect, it, vi } from 'vitest';
import {
  Building,
  CurrentAtomic,
  Engagement,
  MoveGoal,
  PathRequest,
  Position,
  Resource,
  Rider,
  Stance,
  StandIn,
  Stockpile,
  seatPassenger,
  Weapon,
} from '../../../../src/components/index.js';
import { type Fixed, fx, ONE } from '../../../../src/core/fixed.js';
import type { Entity } from '../../../../src/ecs/world.js';
import { hexDistanceBetween, positionOfNode, Simulation } from '../../../../src/index.js';
import { mayEngage } from '../../../../src/systems/conflict/acting.js';
import { breakOff, guardPost } from '../../../../src/systems/conflict/chase.js';
import { CombatIndex } from '../../../../src/systems/conflict/combat-index.js';
import {
  anchorOnlyFootprint,
  combatSystem,
  DEFEND_LEASH_NODES,
  DEFEND_RADIUS_NODES,
  NEED_DRIVE_THRESHOLD,
  stampResourceFootprintData,
} from '../../../../src/systems/index.js';
import { MILITARY_MODE } from '../../../../src/systems/readviews/index.js';
import { entityNode } from '../../../../src/systems/spatial/nodes.js';
import { boardRider, createVehicle } from '../../../../src/systems/vehicles/index.js';
import { testContent } from '../../../fixtures/content.js';
import { setNeeds } from '../../../fixtures/settler.js';

const CART = 5; // the fixture's vehicle type the boarding case seats the enemy in
const VIKING_TRIBE = 1;
const SOLDIER = 31; // `soldier_unarmed`: a fighter, so routing stands it in beside an occupied node
const TEST_AXE = 7; // the fixture's weapon, worn so the soldier fights at all

import {
  cell,
  combatant,
  combatantAtNode,
  ctxOf,
  grassMap,
  HARVEST_ATOMIC,
  P0,
  P1,
  tileOf,
  WOOD,
  WOODCUTTER,
} from './support.js';

describe('DEFEND - hold an anchor, don’t chase past the leash', () => {
  it('ignores an enemy OUTSIDE the defend radius (holds its post)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(30, 1) });
    const guard = combatant(sim, 10, 0, P0, MILITARY_MODE.DEFEND);
    sim.world.mut(guard, Stance).anchorCell = cell(sim, 10, 0);
    // 1 node outside the radius: the anchor is node (20, 0), the enemy DEFEND_RADIUS_NODES+1 nodes east.
    combatantAtNode(sim, 20 + DEFEND_RADIUS_NODES + 1, 0, P1, MILITARY_MODE.IGNORE);

    combatSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(guard, CurrentAtomic)).toBe(false); // did not engage
    expect(sim.world.has(guard, Engagement)).toBe(false);
    expect(sim.world.has(guard, MoveGoal)).toBe(false); // stayed on its anchor
  });

  it('engages an enemy INSIDE the radius, and its chase never leaves the leash of the anchor', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(30, 1) });
    const guard = combatant(sim, 10, 0, P0, MILITARY_MODE.DEFEND);
    const anchor = cell(sim, 10, 0);
    sim.world.mut(guard, Stance).anchorCell = anchor;
    // An enemy 6 nodes out: inside the radius (8), beyond reach (2) → chase, but leashed.
    const enemy = combatant(sim, 13, 0, P1, MILITARY_MODE.IGNORE);

    combatSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(guard, Engagement)).toBe(true); // engaged the in-radius enemy
    const goal = sim.world.get(guard, MoveGoal).cell;
    const g = sim.terrain?.coordsOf(goal);
    const a = sim.terrain?.coordsOf(anchor);
    const distToAnchor = Math.abs((g?.x ?? 0) - (a?.x ?? 0)) + Math.abs((g?.y ?? 0) - (a?.y ?? 0));
    expect(distToAnchor).toBeLessThanOrEqual(DEFEND_LEASH_NODES); // the chase stayed within the leash
    expect(enemy).toBeDefined();
  });

  it('drops a held enemy that boarded a vehicle, which leaves it with no position to measure the leash from', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(30, 1) });
    const ctx = ctxOf(sim);
    const guard = combatant(sim, 10, 0, P0, MILITARY_MODE.DEFEND);
    sim.world.mut(guard, Stance).anchorCell = cell(sim, 10, 0);
    const enemy = combatant(sim, 13, 0, P1, MILITARY_MODE.IGNORE);
    combatSystem(sim.world, ctx);
    expect(sim.world.get(guard, Engagement).target).toBe(enemy);

    const vehicle = createVehicle(sim.world, ctx, {
      vehicleType: CART,
      tribe: VIKING_TRIBE,
      x: 20,
      y: 0,
      owner: P1,
    });
    if (vehicle === null || !seatPassenger(sim.world, vehicle, enemy))
      throw new Error('setup: no vehicle seat');
    boardRider(sim.world, enemy, vehicle);
    expect(sim.world.has(enemy, Position)).toBe(false);

    expect(() => combatSystem(sim.world, ctx)).not.toThrow();
    expect(sim.world.tryGet(guard, Engagement)?.target).not.toBe(enemy);
  });

  it('over a run past a nearby enemy, the defender stays within the leash of its anchor', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 1) });
    const guard = combatant(sim, 10, 0, P0, MILITARY_MODE.DEFEND, { hitpoints: 100000 });
    const anchorX = 10;
    sim.world.mut(guard, Stance).anchorCell = cell(sim, anchorX, 0);
    // A tough enemy that marches in (ATTACK) - it reaches the defend radius during the run, so the guard
    // engages and chases; both are far too tough to die, so the fight lasts the whole run.
    combatant(sim, 16, 0, P1, MILITARY_MODE.ATTACK, { hitpoints: 100000 });

    sim.run(120);
    const gx = tileOf(sim, guard).x;
    // The leash is a NODE Manhattan bound; a same-row cell offset is 2 nodes, so double the cell delta.
    expect(Math.abs(gx - anchorX) * 2).toBeLessThanOrEqual(DEFEND_LEASH_NODES);
  });

  it('holds its post against the economy - a militia-job guard does not wander off to work', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(10, 1) });
    // A DEFEND unit on a CIVILIAN job (woodcutter) - without the economy-skip it would walk off to harvest.
    const guard = combatant(sim, 5, 0, P0, MILITARY_MODE.DEFEND, { jobType: WOODCUTTER });
    // A wood node it could harvest, off to the side.
    const wood = sim.world.create();
    sim.world.add(wood, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
    sim.world.add(wood, Resource, { goodType: WOOD, remaining: 100, harvestAtomic: HARVEST_ATOMIC });
    stampResourceFootprintData(sim.world, wood, anchorOnlyFootprint());

    sim.run(30);
    expect(tileOf(sim, guard)).toEqual({ x: 5, y: 0 }); // stayed on its post, never walked to the wood
  });

  it('walks to a meal, eats it and returns to its post while an enemy stands in sight beyond the defend radius', () => {
    const FOOD = 3; // the fixture's `food_simple`
    const HEADQUARTERS = 1; // the fixture building with a food slot
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 1) });
    const guard = combatant(sim, 10, 0, P0, MILITARY_MODE.DEFEND);
    sim.world.mut(guard, Stance).anchorCell = cell(sim, 10, 0);
    setNeeds(sim, guard, { hunger: fx.add(NEED_DRIVE_THRESHOLD, fx.div(ONE, fx.fromInt(100))) });
    const store = sim.world.create();
    sim.world.add(store, Position, { x: fx.fromInt(16), y: fx.fromInt(0) });
    sim.world.add(store, Building, { buildingType: HEADQUARTERS, tribe: 1, built: ONE, level: 0 });
    sim.world.add(store, Stockpile, { amounts: new Map([[FOOD, 5]]) });
    // In sight from the store, past the defend radius measured from the anchor: nothing the guard may strike.
    const anchorToEnemyCells = DEFEND_RADIUS_NODES / 2 + 1;
    combatant(sim, 10 + anchorToEnemyCells, 0, P1, MILITARY_MODE.IGNORE, { hitpoints: 100000 });

    let ate = false;
    for (let t = 0; t < 600 && !ate; t++) {
      sim.run(1);
      ate = sim.world.tryGet(guard, CurrentAtomic)?.effect.kind === 'eat';
    }
    expect(ate).toBe(true);
    sim.run(300);
    expect(tileOf(sim, guard)).toEqual({ x: 10, y: 0 }); // fed, back on its post
  });

  it('walks back beside an anchor a resource stands on, and settles there', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 3) });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('mapped sim expected');
    const [anchorX, row] = [15, 1];
    const anchor = cell(sim, anchorX, row);
    const guard = combatant(sim, anchorX - 7, row, P0, MILITARY_MODE.DEFEND, { jobType: SOLDIER });
    sim.world.add(guard, Weapon, { weaponTypeId: TEST_AXE }); // armed, as a walking-back class soldier is
    sim.world.mut(guard, Stance).anchorCell = anchor;
    // A deposit on the anchor, as a map places a unit on one: no route can end there.
    const deposit = sim.world.create();
    sim.world.add(deposit, Position, { x: fx.fromInt(anchorX), y: fx.fromInt(row) });
    sim.world.add(deposit, Resource, { goodType: WOOD, remaining: 100, harvestAtomic: HARVEST_ATOMIC });
    stampResourceFootprintData(sim.world, deposit, { walk: [{ dx: 0, dy: 0 }], build: [], work: [] });
    const post = { anchorCell: anchor, leash: DEFEND_LEASH_NODES, hold: true };

    breakOff(sim.world, ctxOf(sim), guard, cell(sim, anchorX - 7, row), post);
    const goal = sim.world.get(guard, MoveGoal).cell;
    expect(goal).not.toBe(anchor);
    const [ax, ay] = [terrain.xOf(anchor), terrain.yOf(anchor)];
    expect(hexDistanceBetween(terrain.xOf(goal), terrain.yOf(goal), ax, ay)).toBe(1);
    sim.run(200);
    const here = entityNode(sim.world, terrain, guard);
    expect(here).toBe(goal);
    breakOff(sim.world, ctxOf(sim), guard, here, post);
    expect(sim.world.has(guard, MoveGoal)).toBe(false);
    // Home for the combat pass too: with nobody near, it neither acts nor walks again.
    const ctx = ctxOf(sim);
    expect(mayEngage(sim.world, ctx, terrain, new CombatIndex(sim.world, ctx, terrain), guard, false)).toBe(
      false,
    );
    let walks = 0;
    for (let tick = 0; tick < 100; tick++) {
      sim.step();
      if (sim.world.has(guard, PathRequest) || sim.world.has(guard, MoveGoal)) walks++;
    }
    expect(walks).toBe(0);
    expect(entityNode(sim.world, terrain, guard)).toBe(goal);
  });

  it('leaves a guard seated in a vehicle to walk to its door instead of back to its post', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(30, 1) });
    const ctx = ctxOf(sim);
    const guard = combatant(sim, 20, 0, P0, MILITARY_MODE.DEFEND, { jobType: SOLDIER });
    sim.world.mut(guard, Stance).anchorCell = cell(sim, 5, 0);
    const vehicle = createVehicle(sim.world, ctx, {
      vehicleType: CART,
      tribe: VIKING_TRIBE,
      x: 24,
      y: 0,
      owner: P0,
    });
    if (vehicle === null || !seatPassenger(sim.world, vehicle, guard))
      throw new Error('setup: no vehicle seat');
    sim.world.add(guard, Rider, { vehicle, boarding: true, leaving: null });

    breakOff(sim.world, ctx, guard, cell(sim, 20, 0), {
      anchorCell: cell(sim, 5, 0),
      leash: DEFEND_LEASH_NODES,
      hold: true,
    });
    expect(sim.world.has(guard, MoveGoal)).toBe(false);
  });

  it('holds the post beside a covered anchor without searching again until a walk block changes', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 3) });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('mapped sim expected');
    const [anchorX, row] = [15, 1];
    const anchor = cell(sim, anchorX, row);
    const cover = (x: Fixed, y: Fixed): Entity => {
      const deposit = sim.world.create();
      sim.world.add(deposit, Position, { x, y });
      sim.world.add(deposit, Resource, { goodType: WOOD, remaining: 100, harvestAtomic: HARVEST_ATOMIC });
      stampResourceFootprintData(sim.world, deposit, { walk: [{ dx: 0, dy: 0 }], build: [], work: [] });
      return deposit;
    };
    const anchorDeposit = cover(fx.fromInt(anchorX), fx.fromInt(row));
    const ctx = ctxOf(sim);
    const first = guardPost(sim.world, ctx, terrain, anchor, anchor);
    expect(first).not.toBe(anchor);
    const guard = combatantAtNode(sim, terrain.xOf(first), terrain.yOf(first), P0, MILITARY_MODE.DEFEND, {
      jobType: SOLDIER,
    });
    sim.world.mut(guard, Stance).anchorCell = anchor;
    const here = entityNode(sim.world, terrain, guard);
    expect(guardPost(sim.world, ctx, terrain, anchor, here)).toBe(first);

    const searches = vi.spyOn(terrain, 'componentOf');
    const index = new CombatIndex(sim.world, ctx, terrain);
    for (let pass = 0; pass < 10; pass++) {
      expect(mayEngage(sim.world, ctx, terrain, index, guard, false)).toBe(false);
    }
    expect(guardPost(sim.world, ctx, terrain, anchor, here)).toBe(first);
    expect(searches).not.toHaveBeenCalled();

    // A deposit on the held post moves it; clearing the anchor makes the anchor itself the post again.
    const at = positionOfNode(terrain.xOf(first), terrain.yOf(first));
    cover(at.x, at.y);
    const moved = guardPost(sim.world, ctx, terrain, anchor, here);
    expect(moved).not.toBe(first);
    expect(moved).not.toBe(anchor);
    expect(searches).toHaveBeenCalled();
    sim.world.destroy(anchorDeposit);
    expect(guardPost(sim.world, ctx, terrain, anchor, here)).toBe(anchor);
    searches.mockRestore();
  });

  it('never takes a post beside a covered anchor that it cannot reach', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 5) });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('mapped sim expected');
    const block = (hx: number, hy: number): void => {
      const stone = sim.world.create();
      sim.world.add(stone, Position, positionOfNode(hx, hy));
      sim.world.add(stone, Resource, { goodType: WOOD, remaining: 100, harvestAtomic: HARVEST_ATOMIC });
      stampResourceFootprintData(sim.world, stone, { walk: [{ dx: 0, dy: 0 }], build: [], work: [] });
    };
    // The anchor (20, 4) and its western side are covered; east of it, (21, 4) and (22, 4) are sealed in,
    // so the anchor's one open neighbour is a pocket no walk enters.
    const [ax, ay] = [20, 4];
    const covered = [
      [ax, ay],
      [19, 4],
      [19, 3],
      [19, 5],
      [20, 2],
      [20, 6],
      [20, 3],
      [20, 5],
      [21, 3],
      [21, 5],
      [22, 3],
      [22, 5],
      [21, 2],
      [21, 6],
      [22, 2],
      [22, 6],
      [23, 4],
    ] as const;
    for (const [hx, hy] of covered) block(hx, hy);
    const guard = combatantAtNode(sim, 8, ay, P0, MILITARY_MODE.DEFEND, { jobType: SOLDIER });
    sim.world.add(guard, Weapon, { weaponTypeId: TEST_AXE }); // armed, as a walking-back class soldier is
    const anchor = terrain.nodeAt(ax, ay);
    sim.world.mut(guard, Stance).anchorCell = anchor;

    const here = entityNode(sim.world, terrain, guard);
    const post = guardPost(sim.world, ctxOf(sim), terrain, anchor, here);
    expect([terrain.xOf(post), terrain.yOf(post)]).not.toEqual([21, 4]);
    expect(post).not.toBe(anchor);
    breakOff(sim.world, ctxOf(sim), guard, here, {
      anchorCell: anchor,
      leash: DEFEND_LEASH_NODES,
      hold: true,
    });
    expect(sim.world.get(guard, MoveGoal).cell).toBe(post);
    sim.run(300);
    expect(entityNode(sim.world, terrain, guard)).toBe(post);
  });

  it('settles beside an anchor another unit stands on instead of re-aiming at it every pass', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 3) });
    const [anchorX, row] = [15, 1];
    const anchor = cell(sim, anchorX, row);
    const [holder, guard] = [
      combatant(sim, anchorX, row, P0, MILITARY_MODE.DEFEND, { jobType: SOLDIER }),
      combatant(sim, anchorX - 7, row, P0, MILITARY_MODE.DEFEND, { jobType: SOLDIER }),
    ];
    for (const e of [holder, guard]) {
      sim.world.mut(e, Stance).anchorCell = anchor;
      sim.world.add(e, Weapon, { weaponTypeId: TEST_AXE });
    }
    // In sight, past the defend radius: it keeps the combat pass breaking both guards off every pass.
    const anchorToEnemyCells = DEFEND_RADIUS_NODES / 2 + 2;
    combatant(sim, anchorX + anchorToEnemyCells, row, P1, MILITARY_MODE.IGNORE, { hitpoints: 100000 });

    sim.run(200);
    const stand = tileOf(sim, guard);
    let walkTicks = 0;
    for (let t = 0; t < 100; t++) {
      sim.run(1);
      if (sim.world.has(guard, MoveGoal) || sim.world.has(guard, PathRequest)) walkTicks++;
    }
    expect(walkTicks).toBe(0);
    expect(tileOf(sim, guard)).toEqual(stand);
    expect(sim.world.tryGet(guard, StandIn)?.goal).toBe(anchor);
    expect(Math.abs(stand.x - anchorX) + Math.abs(stand.y - row)).toBeLessThanOrEqual(1); // beside the anchor

    // The holder takes another post: the anchor frees, and the guard walks onto it.
    const holderPostCells = 3;
    sim.world.mut(holder, Stance).anchorCell = cell(sim, anchorX - holderPostCells, row);
    sim.run(200);
    expect(tileOf(sim, holder)).toEqual({ x: anchorX - holderPostCells, y: row });
    expect(tileOf(sim, guard)).toEqual({ x: anchorX, y: row });
  });
});
