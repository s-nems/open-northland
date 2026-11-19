import { describe, expect, it } from 'vitest';
import { DeliveryFlag, MoveGoal, Position, WorkFlag } from '../../../../../src/components/index.js';
import { cellAnchorNode, positionOfNode } from '../../../../../src/index.js';
import { plannerSystem } from '../../../../../src/systems/index.js';
import { ctxOf } from '../../../../fixtures/context.js';
import {
  ACROSS_CELL,
  AWAY_CELL,
  nodeOfCell,
  ORIGIN_CELL,
  RIVER_CELLS,
  riverSim,
  settlerOn,
  UP_THE_BANK_CELL,
} from '../../../../fixtures/river-bank.js';
import { placeFellableTree } from '../gatherer-flag/support.js';

const WOODCUTTER = 1;
/** A flag radius in nodes holding both trees. */
const FLAG_RADIUS = 30;

describe("a flag gatherer's tree across a river", () => {
  /** The bank of the tree a woodcutter flagged at the origin sets out for after one planner pass. */
  function bankWalkedTo(confined: boolean): 'east' | 'west' | null {
    const { sim, terrain } = riverSim(confined);
    const cutter = settlerOn(sim, AWAY_CELL, WOODCUTTER);
    const flag = sim.world.create();
    const at = cellAnchorNode(ORIGIN_CELL.x, ORIGIN_CELL.y);
    sim.world.add(flag, Position, positionOfNode(at.hx, at.hy));
    sim.world.add(flag, DeliveryFlag, {});
    sim.world.add(cutter, WorkFlag, { flag, radius: FLAG_RADIUS });
    for (const cell of [ACROSS_CELL, UP_THE_BANK_CELL]) {
      const tree = placeFellableTree(sim, 0, 0);
      const anchor = cellAnchorNode(cell.x, cell.y);
      const p = sim.world.mut(tree, Position);
      ({ x: p.x, y: p.y } = positionOfNode(anchor.hx, anchor.hy));
    }
    plannerSystem(sim.world, ctxOf(sim));
    const goal = sim.world.tryGet(cutter, MoveGoal)?.cell;
    if (goal === undefined) return null;
    const river = nodeOfCell(terrain, { x: RIVER_CELLS.river, y: ORIGIN_CELL.y });
    return terrain.xOf(goal) > terrain.xOf(river) ? 'east' : 'west';
  }

  it("fells the tree up the flag's own bank, which the line from the flag ranks second", () => {
    expect(bankWalkedTo(true)).toBe('east');
    // With no walk measured the line decides.
    expect(bankWalkedTo(false)).toBe('west');
  });
});
