import { describe, expect, it } from 'vitest';
import {
  Building,
  Chat,
  CurrentAtomic,
  LostWay,
  MoveGoal,
  Owner,
  Palisade,
  Position,
  SettlerNeeds,
  Stockpile,
} from '../../src/components/index.js';
import { ONE } from '../../src/core/fixed.js';
import type { Entity } from '../../src/ecs/world.js';
import { positionOfNode, Simulation } from '../../src/index.js';
import { placePalisade } from '../../src/systems/palisades/index.js';
import { UNREACHABLE_GOAL_MEMO_TICKS } from '../../src/systems/settlers/unreachable-goals.js';
import { ownedWoodcutter, woodAt } from '../conflict/orders/support.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassNodeMap } from '../fixtures/terrain.js';
import { justAbove, NEED_DRIVE_THRESHOLD, needsSettlerAt } from '../settlers/needs/support.js';

/**
 * A woodcutter walled in by a closed gate with every tree outside: each tree's route fails in turn. The
 * player is told once and the mark stands until the gate opens and the woodcutter is felling again. The
 * enclosure is wider than a provable pocket, as a walled settlement is, so the walks are tried.
 */

const SIZE = 64;
const WALL_ROW = 32;
const GATE_X = 32;
const GATE_HALF_SPAN = 2;
const WALL = 691;
const CLOSED_GATE = 696;
const OPEN_GATE = 700;
const TREE_XS = [20, 32, 44];
const TREE_ROW = 56;
/** The test content's wood good, the wall's construction material. */
const WOOD = 5;
const WALL_HITPOINTS = 100;
/** The test content's passive store and its food good. */
const HEADQUARTERS = 1;
const FOOD = 3;
const STORE_X = 20;
const STORE_ROW = 8;
/** The test content's sawmill trade: with no mill on this map, a carpenter stands idle as a chat partner. */
const CARPENTER = 2;
/** Node rows of a chat partner inside and outside the wall, both within the company search radius. */
const PARTNER_INSIDE_ROW = 12;
const PARTNER_OUTSIDE_ROW = 36;

function walledIn(needs = false): { sim: Simulation; woodcutter: Entity; gate: Entity } {
  const span = [-2, -1, 0, 1, 2].map((dx) => ({ dx, dy: 0 }));
  const wall = {
    maxHitpoints: WALL_HITPOINTS,
    repairPerStrike: 1,
    construction: [{ goodType: WOOD, amount: 1 }],
  };
  const sim = new Simulation({
    seed: 1,
    content: testContent(),
    map: {
      ...grassNodeMap(SIZE, SIZE),
      landscapes: {
        placements: [],
        types: [
          { typeId: WALL, walk: [{ dx: 0, dy: 0 }], build: [{ dx: 0, dy: 0 }], groups: [], wall },
          {
            typeId: CLOSED_GATE,
            walk: span,
            build: span,
            groups: [],
            wall: { ...wall, gate: { open: false, counterpartGfxIndex: OPEN_GATE } },
          },
          {
            typeId: OPEN_GATE,
            walk: [
              { dx: -GATE_HALF_SPAN, dy: 0 },
              { dx: GATE_HALF_SPAN, dy: 0 },
            ],
            build: span,
            groups: [],
            wall: { ...wall, gate: { open: true, counterpartGfxIndex: CLOSED_GATE } },
          },
        ],
      },
    },
  });
  sim.enqueueSetup({ kind: 'setNeedsEnabled', enabled: needs });
  const ctx = ctxOf(sim);
  for (let x = 0; x < SIZE; x++) {
    if (Math.abs(x - GATE_X) <= GATE_HALF_SPAN) continue;
    placePalisade(sim.world, ctx, {
      kind: 'placePalisade',
      gfxIndex: WALL,
      x,
      y: WALL_ROW,
      tribe: 1,
      owner: 0,
    });
  }
  placePalisade(sim.world, ctx, {
    kind: 'placePalisade',
    gfxIndex: CLOSED_GATE,
    x: GATE_X,
    y: WALL_ROW,
    tribe: 1,
    owner: 0,
  });
  const gate = [...sim.world.query(Palisade)].find((e) => sim.world.get(e, Palisade).gate !== null);
  if (gate === undefined) throw new Error('expected a gate');
  const woodcutter = ownedWoodcutter(sim, 0, 0);
  sim.world.add(woodcutter, Position, positionOfNode(GATE_X, 8));
  for (const x of TREE_XS) {
    const tree = woodAt(sim, 0, 0);
    sim.world.add(tree, Position, positionOfNode(x, TREE_ROW));
  }
  return { sim, woodcutter, gate };
}

describe('a settler walled in from its work', () => {
  it('is told once and stays marked lost through every refused tree', () => {
    const { sim, woodcutter } = walledIn();
    const start = sim.world.get(woodcutter, Position);
    let notes = 0;
    for (let t = 0; t < 2 * UNREACHABLE_GOAL_MEMO_TICKS; t++) {
      sim.step();
      for (const ev of sim.events.current())
        if (ev.kind === 'settlerLost' && ev.entity === woodcutter) notes++;
    }
    expect(notes).toBe(1);
    expect(sim.world.has(woodcutter, LostWay)).toBe(true);
    expect(sim.world.get(woodcutter, Position)).toEqual(start);
    // The note points at the tree the way was wanted to.
    expect(sim.world.get(woodcutter, LostWay).goal).not.toBeNull();
  });

  it('goes back to work once the gate opens, and the mark lifts', () => {
    const { sim, woodcutter, gate } = walledIn();
    for (let t = 0; t < UNREACHABLE_GOAL_MEMO_TICKS; t++) sim.step();
    expect(sim.world.has(woodcutter, LostWay)).toBe(true);

    sim.enqueueSetup({ kind: 'setPalisadeGate', palisade: gate, open: true });
    // The mark lifts with the first route found, while the walk through the gate is still ahead.
    for (let t = 0; t < 3 * UNREACHABLE_GOAL_MEMO_TICKS && sim.world.has(woodcutter, LostWay); t++)
      sim.step();
    expect(sim.world.has(woodcutter, LostWay)).toBe(false);
    expect(sim.world.has(woodcutter, MoveGoal)).toBe(true);
    expect(sim.world.get(woodcutter, Position).y).toBeLessThan(positionOfNode(GATE_X, WALL_ROW).y);
    const felling = (): boolean => sim.world.tryGet(woodcutter, CurrentAtomic)?.effect.kind === 'harvest';
    for (let t = 0; t < 3 * UNREACHABLE_GOAL_MEMO_TICKS && !felling(); t++) sim.step();
    expect(felling()).toBe(true);
    expect(sim.world.has(woodcutter, LostWay)).toBe(false);
  });
});

describe('a settler walled in from its work, with food inside the walls', () => {
  it('eats when hungry and is still told only once', () => {
    const { sim, woodcutter } = walledIn(true);
    const store = sim.world.create();
    sim.world.add(store, Position, positionOfNode(STORE_X, STORE_ROW));
    sim.world.add(store, Building, { buildingType: HEADQUARTERS, tribe: 1, built: ONE, level: 0 });
    sim.world.add(store, Stockpile, { amounts: new Map([[FOOD, 5]]) });
    let notes = 0;
    const lostNotes = (): void => {
      for (const ev of sim.events.current())
        if (ev.kind === 'settlerLost' && ev.entity === woodcutter) notes++;
    };
    for (let t = 0; t < UNREACHABLE_GOAL_MEMO_TICKS && !sim.world.has(woodcutter, LostWay); t++) {
      sim.step();
      lostNotes();
    }
    expect(notes).toBe(1);
    // Hunger strikes the lost woodcutter: the meal is in reach, and is not the way to its trees.
    sim.world.mut(woodcutter, SettlerNeeds).hunger = justAbove(NEED_DRIVE_THRESHOLD);
    let ate = false;
    for (let t = 0; t < 3 * UNREACHABLE_GOAL_MEMO_TICKS; t++) {
      sim.step();
      lostNotes();
      ate ||= sim.world.tryGet(woodcutter, CurrentAtomic)?.effect.kind === 'eat';
    }
    expect(ate).toBe(true);
    expect(notes).toBe(1);
    expect(sim.world.has(woodcutter, LostWay)).toBe(true);
  });
});

describe('a settler walled in from its work, lonely', () => {
  function lonelyWalledIn(partnerRow: number): { sim: Simulation; woodcutter: Entity; partner: Entity } {
    const { sim, woodcutter } = walledIn(true);
    const partner = needsSettlerAt(sim, 0, 0, {}, CARPENTER);
    sim.world.add(partner, Position, positionOfNode(GATE_X, partnerRow));
    sim.world.add(partner, Owner, { player: 0 });
    for (let t = 0; t < UNREACHABLE_GOAL_MEMO_TICKS && !sim.world.has(woodcutter, LostWay); t++) sim.step();
    expect(sim.world.has(woodcutter, LostWay)).toBe(true);
    sim.world.mut(woodcutter, SettlerNeeds).enjoyment = justAbove(NEED_DRIVE_THRESHOLD);
    return { sim, woodcutter, partner };
  }

  it('keeps its stand when the only company is outside the wall', () => {
    const { sim, woodcutter } = lonelyWalledIn(PARTNER_OUTSIDE_ROW);
    const start = sim.world.get(woodcutter, Position);
    let notes = 0;
    for (let t = 0; t < 2 * UNREACHABLE_GOAL_MEMO_TICKS; t++) {
      sim.step();
      for (const ev of sim.events.current())
        if (ev.kind === 'settlerLost' && ev.entity === woodcutter) notes++;
    }
    expect(sim.world.get(woodcutter, Position)).toEqual(start);
    expect(notes).toBe(0);
    expect(sim.world.has(woodcutter, LostWay)).toBe(true);
  });

  it('walks to company inside the wall and chats', () => {
    const { sim, woodcutter, partner } = lonelyWalledIn(PARTNER_INSIDE_ROW);
    const talking = (): boolean => sim.world.tryGet(woodcutter, Chat)?.talking === true;
    for (let t = 0; t < 2 * UNREACHABLE_GOAL_MEMO_TICKS && !talking(); t++) sim.step();
    expect(sim.world.get(woodcutter, Chat)).toMatchObject({ partner, seeker: true, talking: true });
  });
});
