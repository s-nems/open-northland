import { describe, expect, it } from 'vitest';
import {
  Building,
  Carrying,
  CurrentAtomic,
  Fleeing,
  GroundDrop,
  MoveGoal,
  Owner,
  PathFollow,
  PlayerOrder,
  Position,
  Settler,
  Stockpile,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { cellAnchorNode, fx, nodeOfPosition, positionOfNode, Simulation } from '../../src/index.js';
import { DROP_ATOMIC_ID } from '../../src/systems/agents/actions.js';
import { dropCarriedLoad } from '../../src/systems/agents/effects-goods/index.js';
import { combatSystem } from '../../src/systems/index.js';
import { MOVE_SPEED_PER_TICK } from '../../src/systems/movement/movement.js';
import { MILITARY_MODE } from '../../src/systems/readviews/index.js';
import { MAX_GROUND_STACK } from '../../src/systems/stores/index.js';
import { combatant } from '../conflict/stances/support.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassCellMap as grassMap } from '../fixtures/terrain.js';

/**
 * When a settler's carrying is interrupted — a profession change, an enemy scaring it, a move order — it sets
 * its load down (the {@link DROP_ATOMIC_ID} drop atomic, so a drop animation plays) and only then does the
 * interrupting thing, instead of carrying the good onward. The drop is stacking-aware: the
 * whole load lands on the settler's own tile, spilling any remainder over {@link MAX_GROUND_STACK} to the
 * nearest free hexes. A move order on a carrying settler is honoured too — it sets the load down first, then
 * walks off empty-handed (never hauling it to the ordered spot). Fixture: good 1 = wood, job 1 = woodcutter
 * (a civilian, default FLEE), tribe 1 = viking.
 */

const WOOD = 1;
const WOODCUTTER = 1;
const CARPENTER = 2;
const VIKING = 1;
const HUMAN_PLAYER = 0;
const ENEMY_PLAYER = 1;

function freshSim(width = 12, height = 4): Simulation {
  return new Simulation({ seed: 1, content: testContent(), map: grassMap(width, height) });
}

/** An owned viking woodcutter at visual cell (x,y), carrying `amount` of wood. */
function carryingWoodcutter(sim: Simulation, x: number, y: number, amount = 1): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Settler, {
    tribe: VIKING,
    jobType: WOODCUTTER,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map(),
  });
  sim.world.add(e, Owner, { player: HUMAN_PLAYER });
  sim.world.add(e, Carrying, { goodType: WOOD, amount });
  return e;
}

/** The tile Position a settler at (x,y) drops onto — its half-cell node snapped to the lattice. */
function dropTileOf(x: number, y: number): { x: number; y: number } {
  const node = nodeOfPosition(fx.fromInt(x), fx.fromInt(y));
  return positionOfNode(node.hx, node.hy);
}

/** Every loose ground heap (bare Stockpile+Position — no building/trunk marker) and its wood count. */
function looseWoodPiles(sim: Simulation): { pile: Entity; wood: number }[] {
  const out: { pile: Entity; wood: number }[] = [];
  for (const e of sim.world.query(Stockpile, Position)) {
    if (sim.world.has(e, Building) || sim.world.has(e, GroundDrop)) continue;
    out.push({ pile: e, wood: sim.world.get(e, Stockpile).amounts.get(WOOD) ?? 0 });
  }
  return out;
}

describe('dropCarriedLoad — set the whole load on the ground', () => {
  it('places the entire load on the own tile and clears Carrying', () => {
    const sim = freshSim();
    const e = carryingWoodcutter(sim, 3, 1, 1);

    const placed = dropCarriedLoad(sim.world, sim.terrain, e);

    expect(placed).toBe(1);
    expect(sim.world.has(e, Carrying)).toBe(false);
    const piles = looseWoodPiles(sim);
    expect(piles).toHaveLength(1);
    expect(piles[0]?.wood).toBe(1);
    const at = dropTileOf(3, 1);
    const p = sim.world.get(piles[0]?.pile as Entity, Position);
    expect([p.x, p.y]).toEqual([at.x, at.y]); // dropped where its feet are
  });

  it('spills the remainder to the nearest free hex when the own tile is a full stack', () => {
    const sim = freshSim();
    const e = carryingWoodcutter(sim, 3, 1, 2);
    // Saturate the own tile with a full loose heap of wood so the load can't land there.
    const at = dropTileOf(3, 1);
    const full = sim.world.create();
    sim.world.add(full, Position, { x: at.x, y: at.y });
    sim.world.add(full, Stockpile, { amounts: new Map([[WOOD, MAX_GROUND_STACK]]) });

    const placed = dropCarriedLoad(sim.world, sim.terrain, e);

    expect(placed).toBe(2); // both units reached the ground (nothing lost)
    expect(sim.world.has(e, Carrying)).toBe(false);
    // The own heap stays capped; the spill made a fresh neighbour heap holding the 2 units.
    expect(sim.world.get(full, Stockpile).amounts.get(WOOD)).toBe(MAX_GROUND_STACK);
    const totalWood = looseWoodPiles(sim).reduce((sum, p) => sum + p.wood, 0);
    expect(totalWood).toBe(MAX_GROUND_STACK + 2);
    const spill = looseWoodPiles(sim).find((p) => p.pile !== full);
    expect(spill?.wood).toBe(2);
  });
});

describe('setJob on a carrying settler — drop first, then re-employ', () => {
  it('starts the drop atomic instead of vanishing the load, then lands it on the ground', () => {
    const sim = freshSim();
    const e = carryingWoodcutter(sim, 3, 1, 1);

    sim.enqueue({ kind: 'setJob', entity: e, jobType: CARPENTER });
    sim.step();

    // The profession changed at once, but the load is being set down (the drop atomic), still on its back.
    expect(sim.world.get(e, Settler).jobType).toBe(CARPENTER);
    const atomic = sim.world.get(e, CurrentAtomic);
    expect(atomic.atomicId).toBe(DROP_ATOMIC_ID);
    expect(atomic.effect.kind).toBe('drop');
    expect(sim.world.has(e, Carrying)).toBe(true);

    sim.run(30); // let the drop atomic complete
    expect(sim.world.has(e, Carrying)).toBe(false); // load is on the ground now
    const totalWood = looseWoodPiles(sim).reduce((sum, p) => sum + p.wood, 0);
    expect(totalWood).toBe(1);
  });
});

describe('a move order on a carrying settler — drop first, then walk', () => {
  it('sets the load down before walking (drop atomic, no walk yet), then walks off empty-handed', () => {
    const sim = freshSim();
    const e = carryingWoodcutter(sim, 3, 1, 1);

    const dest = cellAnchorNode(8, 1);
    sim.enqueue({ kind: 'moveUnit', entity: e, x: dest.hx, y: dest.hy });
    sim.step();

    // The order is accepted but parked behind the drop: the load is being set down, not walked off with.
    expect(sim.world.has(e, PlayerOrder)).toBe(true);
    expect(sim.world.get(e, PlayerOrder).pendingGoal).toBe(sim.terrain?.nodeAtClamped(dest.hx, dest.hy)); // the ordered node parked, awaiting the drop
    expect(sim.world.get(e, CurrentAtomic).effect.kind).toBe('drop');
    expect(sim.world.has(e, MoveGoal)).toBe(false); // the walk hasn't started
    expect(sim.world.has(e, Carrying)).toBe(true);

    // Play it out: the wood is set down, then the settler walks toward the ordered spot.
    const startX = sim.world.get(e, Position).x;
    sim.run(40);
    expect(sim.world.has(e, Carrying)).toBe(false);
    const totalWood = looseWoodPiles(sim).reduce((sum, p) => sum + p.wood, 0);
    expect(totalWood).toBe(1); // dropped where it stood, not hauled to the destination
    expect(sim.world.get(e, Position).x).toBeGreaterThan(startX); // walked toward tile 8 (to the right)
  });

  it('halts a settler already walking — it stops to drop, not drops on the move', () => {
    const sim = freshSim();
    const e = carryingWoodcutter(sim, 3, 1, 1);
    // Simulate a porter mid-haul: a live walk route at full gait toward tile 9 (the drop must interrupt this,
    // not run alongside it — the non-zero speed means a surviving PathFollow would advance the settler this tick).
    sim.world.add(e, PathFollow, {
      waypoints: [{ x: fx.fromInt(9), y: fx.fromInt(1) }],
      index: 0,
      speed: MOVE_SPEED_PER_TICK,
      hx: fx.fromInt(0),
      hy: fx.fromInt(0),
    });
    const startX = sim.world.get(e, Position).x;

    const dest = cellAnchorNode(8, 1);
    sim.enqueue({ kind: 'moveUnit', entity: e, x: dest.hx, y: dest.hy });
    sim.step();

    // The walk is halted the moment the drop starts — no PathFollow ticking under the drop animation, and the
    // settler has not advanced (a surviving route would have stepped it toward tile 9 this tick).
    expect(sim.world.get(e, CurrentAtomic).effect.kind).toBe('drop');
    expect(sim.world.has(e, PathFollow)).toBe(false); // stopped to set the load down
    expect(sim.world.has(e, MoveGoal)).toBe(false);
    expect(sim.world.get(e, Position).x).toBe(startX); // stood still, did not drop on the move
  });
});

describe('an enemy interrupting a carrying settler — drop, then flee', () => {
  it('sets the load down before it runs (drop atomic first, no Fleeing yet), then flees empty-handed', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 1) });
    const civ = combatant(sim, 20, 0, HUMAN_PLAYER, MILITARY_MODE.FLEE);
    sim.world.add(civ, Carrying, { goodType: WOOD, amount: 1 });
    combatant(sim, 24, 0, ENEMY_PLAYER, MILITARY_MODE.IGNORE); // a lasting threat in sight

    // First combat pass: hands full → it drops rather than flees.
    combatSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(civ, CurrentAtomic).effect.kind).toBe('drop');
    expect(sim.world.has(civ, Fleeing)).toBe(false); // stands to drop; hasn't started running
    expect(sim.world.has(civ, Carrying)).toBe(true);

    // Play it out: the load lands on the ground and the civilian then flees the threat.
    sim.run(40);
    expect(sim.world.has(civ, Carrying)).toBe(false);
    const totalWood = looseWoodPiles(sim).reduce((sum, p) => sum + p.wood, 0);
    expect(totalWood).toBe(1); // the good was set down, not lost
    expect(sim.world.has(civ, Fleeing)).toBe(true); // now running, empty-handed
  });
});
