import { describe, expect, it } from 'vitest';
import { BerryBush, Position } from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { Simulation } from '../../../src/index.js';
import { positionOfNode } from '../../../src/nav/halfcell.js';
import { dueForGrowth, LANDSCAPE_GROWTH_PERIOD_TICKS } from '../../../src/systems/landscape/growth-clock.js';
import { bushesNearNode } from '../../../src/systems/spatial/bushes.js';
import { testContent } from '../../fixtures/content.js';
import { ctxOf } from '../../fixtures/context.js';
import { grassNodeMap } from '../../fixtures/terrain.js';

const GROWTH_RUN_TICKS = 24;
const SECTIONS_PER_SIDE = 20;
/** Two nodes wide and one tall per section. */
const MAP_W = 2 * SECTIONS_PER_SIDE;
const MAP_H = SECTIONS_PER_SIDE;

describe('landscape growth clock', () => {
  it('runs over one section of a 20 x 20 grid every 24 ticks in row order, each point once per period', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassNodeMap(MAP_W, MAP_H) });
    const at = (hx: number, hy: number): Entity => {
      const e = sim.world.create();
      sim.world.add(e, Position, positionOfNode(hx, hy));
      sim.world.add(e, BerryBush, { stage: 'bare' });
      return e;
    };
    const first = at(0, 0);
    const left = at(6, 2);
    const right = at(7, 2);
    const due = new Map<Entity, number[]>([
      [first, []],
      [left, []],
      [right, []],
    ]);
    for (let tick = 1; tick <= 2 * LANDSCAPE_GROWTH_PERIOD_TICKS; tick++) {
      for (const e of dueForGrowth(sim.world, { ...ctxOf(sim), tick }, bushesNearNode))
        due.get(e)?.push(tick);
    }
    const sectionOf = (column: number, row: number) => row * SECTIONS_PER_SIDE + column;
    const runOf = (column: number, row: number) => GROWTH_RUN_TICKS * sectionOf(column, row);
    expect(due.get(first)).toEqual([LANDSCAPE_GROWTH_PERIOD_TICKS, 2 * LANDSCAPE_GROWTH_PERIOD_TICKS]);
    const sharedRun = [runOf(3, 2), runOf(3, 2) + LANDSCAPE_GROWTH_PERIOD_TICKS];
    expect(due.get(left)).toEqual(sharedRun);
    expect(due.get(right)).toEqual(sharedRun);
  });
});
