import { describe, expect, it } from 'vitest';
import { Owner, Position, Settler, WorkFlag } from '../../src/components/index.js';
import type { Command } from '../../src/core/commands/index.js';
import { fx } from '../../src/core/fixed.js';
import type { Entity } from '../../src/ecs/world.js';
import type { Simulation } from '../../src/index.js';
import { setWorkFlag, workFlagPlacementBlocks } from '../../src/systems/index.js';
import { ctxOf } from '../fixtures/context.js';
import { mappedSim, terrainOf, VIKING } from './building-placement/support.js';

/**
 * The work-flag blocked set feeds command gates and the auto-flag plant, so its memo key must see
 * every input change: a flag ADD, REMOVE and — the one `componentGeneration` alone cannot see — an
 * in-place MOVE must each rebuild the set, while a stretch of unchanged ticks reuses one build
 * (instance identity proves it).
 */

const WOODCUTTER = 1;
const P0 = 0;

function ownedGatherer(sim: Simulation, x: number, y: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Settler, {
    tribe: VIKING,
    jobType: WOODCUTTER,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map<number, number>(),
  });
  sim.world.add(e, Owner, { player: P0 });
  return e;
}

const flagCmd = (entity: Entity, x: number, y: number): Extract<Command, { kind: 'setWorkFlag' }> => ({
  kind: 'setWorkFlag',
  entity,
  x,
  y,
});

function blocksOf(sim: Simulation): ReadonlySet<number> {
  return workFlagPlacementBlocks(sim.world, sim.content, terrainOf(sim));
}

describe('workFlagPlacementBlocks memo', () => {
  it('reuses one build while blockers stand still, and a flag add/MOVE/remove each rebuild it', () => {
    const sim = mappedSim();
    const terrain = terrainOf(sim);
    const g = ownedGatherer(sim, 12, 12);
    const A = { x: 4, y: 4 };
    const B = { x: 20, y: 8 };

    const idle = blocksOf(sim);
    for (let t = 0; t < 3; t++) sim.step();
    expect(blocksOf(sim)).toBe(idle); // unchanged world — one build serves the stretch

    setWorkFlag(sim.world, ctxOf(sim), flagCmd(g, A.x, A.y)); // ADD (a fresh flag entity)
    const added = blocksOf(sim);
    expect(added).not.toBe(idle);
    expect(added.has(terrain.nodeAt(A.x, A.y))).toBe(true);

    setWorkFlag(sim.world, ctxOf(sim), flagCmd(g, B.x, B.y)); // MOVE (in-place Position write)
    const moved = blocksOf(sim);
    expect(moved).not.toBe(added);
    expect(moved.has(terrain.nodeAt(B.x, B.y))).toBe(true);
    expect(moved.has(terrain.nodeAt(A.x, A.y))).toBe(false);

    sim.world.destroy(sim.world.get(g, WorkFlag).flag); // REMOVE
    const removed = blocksOf(sim);
    expect(removed).not.toBe(moved);
    expect(removed.has(terrain.nodeAt(B.x, B.y))).toBe(false);
  });

  it('keeps the ignoreFlag variant fresh and un-memoized', () => {
    const sim = mappedSim();
    const terrain = terrainOf(sim);
    const g = ownedGatherer(sim, 12, 12);
    setWorkFlag(sim.world, ctxOf(sim), flagCmd(g, 4, 4));
    const flag = sim.world.get(g, WorkFlag).flag;

    const withFlag = blocksOf(sim);
    const ignoring = workFlagPlacementBlocks(sim.world, sim.content, terrainOf(sim), flag);
    expect(withFlag.has(terrain.nodeAt(4, 4))).toBe(true);
    expect(ignoring.has(terrain.nodeAt(4, 4))).toBe(false); // its own cell must not block a re-place
    expect(blocksOf(sim)).toBe(withFlag); // the ignore path never overwrote the shared memo
  });
});
