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
 * The work-flag blocked set feeds command gates and the auto-flag plant, so the incremental state
 * must see every input change: a flag ADD, REMOVE and — the one `componentGeneration` alone cannot
 * see — an in-place MOVE must each land in the set. The state is ONE live set per world (identity
 * stable across changes, contents caught up on read); the `verifyCaches` verifier proves it equal
 * to a full re-derive under the fuzz/invariant runs.
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

describe('workFlagPlacementBlocks incremental state', () => {
  it('tracks a flag add/MOVE/remove in the one shared live set', () => {
    const sim = mappedSim();
    const terrain = terrainOf(sim);
    const g = ownedGatherer(sim, 12, 12);
    const A = { x: 4, y: 4 };
    const B = { x: 20, y: 8 };

    const idle = blocksOf(sim);
    for (let t = 0; t < 3; t++) sim.step();
    expect(blocksOf(sim)).toBe(idle); // the state is one live set per world — identity holds

    setWorkFlag(sim.world, ctxOf(sim), flagCmd(g, A.x, A.y)); // ADD (a fresh flag entity)
    const added = blocksOf(sim);
    expect(added.has(terrain.nodeAt(A.x, A.y))).toBe(true);

    setWorkFlag(sim.world, ctxOf(sim), flagCmd(g, B.x, B.y)); // MOVE (in-place Position write)
    const moved = blocksOf(sim);
    expect(moved.has(terrain.nodeAt(B.x, B.y))).toBe(true);
    expect(moved.has(terrain.nodeAt(A.x, A.y))).toBe(false);

    sim.world.destroy(sim.world.get(g, WorkFlag).flag); // REMOVE
    const removed = blocksOf(sim);
    expect(removed.has(terrain.nodeAt(B.x, B.y))).toBe(false);
  });

  it('keeps the ignoreFlag variant separate from the shared live set', () => {
    const sim = mappedSim();
    const terrain = terrainOf(sim);
    const g = ownedGatherer(sim, 12, 12);
    setWorkFlag(sim.world, ctxOf(sim), flagCmd(g, 4, 4));
    const flag = sim.world.get(g, WorkFlag).flag;

    const withFlag = blocksOf(sim);
    const ignoring = workFlagPlacementBlocks(sim.world, sim.content, terrainOf(sim), flag);
    expect(withFlag.has(terrain.nodeAt(4, 4))).toBe(true);
    expect(ignoring.has(terrain.nodeAt(4, 4))).toBe(false); // its own cell must not block a re-place
    expect(blocksOf(sim).has(terrain.nodeAt(4, 4))).toBe(true); // the ignore path never mutated the shared set
  });
});
