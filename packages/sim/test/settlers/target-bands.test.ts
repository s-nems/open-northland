import { describe, expect, it } from 'vitest';
import {
  Building,
  Position,
  Stockpile,
  setStockAmount,
  UnderConstruction,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { fx, ONE, Simulation } from '../../src/index.js';
import { collectTargets, nearestStoreHolding } from '../../src/systems/settlers/targets/index.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassCellMap as grassMap } from '../fixtures/terrain.js';

// The question-keyed band memo: one filtered index shared by every asker of the same question this
// tick, dropped whenever a tracked stock write or membership change could flip an answer.

const WOOD = 1;
const HEADQUARTERS = 1; // passive store: no recipe, so its wood is strippable
const VIKING = 1;

function hqAt(sim: Simulation, x: number, y: number, wood: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Building, { buildingType: HEADQUARTERS, tribe: VIKING, built: ONE, level: 0 });
  sim.world.add(e, Stockpile, { amounts: new Map([[WOOD, wood]]) });
  return e;
}

function fixture() {
  const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(16, 4) });
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('fixture map missing');
  const near = hqAt(sim, 2, 1, 5);
  const far = hqAt(sim, 13, 1, 5);
  const empty = hqAt(sim, 1, 2, 0);
  const targets = collectTargets(sim.world, ctxOf(sim), terrain);
  const here = terrain.nodeAtClamped(6, 2);
  return { sim, targets, here, near, far, empty };
}

describe('TargetBands', () => {
  it('shares one filtered index per question and picks the unshared winner', () => {
    const { sim, targets, here, near } = fixture();
    expect(targets.bands.holding(WOOD)).toBe(targets.bands.holding(WOOD));
    expect(nearestStoreHolding(targets.bands, sim.world, here, WOOD, undefined)).toBe(near);
  });

  it('drops the band on a tracked stock write instead of serving the stale winner', () => {
    const { sim, targets, here, near, far } = fixture();
    const before = targets.bands.holding(WOOD);
    expect(nearestStoreHolding(targets.bands, sim.world, here, WOOD, undefined)).toBe(near);
    setStockAmount(sim.world, near, WOOD, 0);
    expect(targets.bands.holding(WOOD)).not.toBe(before);
    expect(nearestStoreHolding(targets.bands, sim.world, here, WOOD, undefined)).toBe(far);
  });

  it('drops the band on a membership change that flips an answer', () => {
    const { sim, targets, here, near, far } = fixture();
    expect(nearestStoreHolding(targets.bands, sim.world, here, WOOD, undefined)).toBe(near);
    // A store that becomes a construction site mid-tick is a sink, never a source to strip.
    sim.world.add(near, UnderConstruction, { labor: fx.fromInt(0) });
    expect(nearestStoreHolding(targets.bands, sim.world, here, WOOD, undefined)).toBe(far);
  });
});
