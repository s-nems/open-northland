import { describe, expect, it } from 'vitest';
import { CurrentAtomic, LostWay, Palisade, Position } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { positionOfNode, Simulation } from '../../src/index.js';
import { placePalisade } from '../../src/systems/palisades/index.js';
import { UNREACHABLE_GOAL_MEMO_TICKS } from '../../src/systems/settlers/unreachable-goals.js';
import { ownedWoodcutter, woodAt } from '../conflict/orders/support.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassNodeMap } from '../fixtures/terrain.js';

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

function walledIn(): { sim: Simulation; woodcutter: Entity; gate: Entity } {
  const span = [-2, -1, 0, 1, 2].map((dx) => ({ dx, dy: 0 }));
  const wall = { maxHitpoints: 100, repairPerStrike: 1, construction: [{ goodType: 5, amount: 1 }] };
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
  sim.enqueueSetup({ kind: 'setNeedsEnabled', enabled: false });
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
  });

  it('goes back to work once the gate opens, and the mark lifts', () => {
    const { sim, woodcutter, gate } = walledIn();
    for (let t = 0; t < UNREACHABLE_GOAL_MEMO_TICKS; t++) sim.step();
    expect(sim.world.has(woodcutter, LostWay)).toBe(true);

    sim.enqueueSetup({ kind: 'setPalisadeGate', palisade: gate, open: true });
    const felling = (): boolean => sim.world.tryGet(woodcutter, CurrentAtomic)?.effect.kind === 'harvest';
    for (let t = 0; t < 3 * UNREACHABLE_GOAL_MEMO_TICKS && !felling(); t++) sim.step();
    expect(felling()).toBe(true);
    expect(sim.world.has(woodcutter, LostWay)).toBe(false);
  });
});
