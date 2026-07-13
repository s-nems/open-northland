import { describe, expect, it } from 'vitest';
import { Building, Settler } from '../../../src/components/index.js';
import type { Command } from '../../../src/index.js';
import { clearComponentStores } from '../../fixtures/stores.js';

import { fresh, HEADQUARTERS, nthEntity, VIKING, WOODCUTTER } from './support.js';

describe('CommandSystem — dispatch and logging', () => {
  it('records applied commands in the log stamped with the tick they were applied on', () => {
    const sim = fresh();
    sim.enqueue({ kind: 'spawnSettler', jobType: WOODCUTTER, x: 0, y: 0, tribe: VIKING });
    sim.step(); // tick 1
    sim.enqueue({ kind: 'placeBuilding', buildingType: HEADQUARTERS, x: 1, y: 1, tribe: VIKING });
    sim.step(); // tick 2

    const log = sim.commands.log;
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({ tick: 1, command: { kind: 'spawnSettler' } });
    expect(log[1]).toMatchObject({ tick: 2, command: { kind: 'placeBuilding' } });
  });

  it('applies commands in FIFO enqueue order within one tick', () => {
    const sim = fresh();
    // Two placements; the entity ids must reflect enqueue order (first enqueued = lower id).
    sim.enqueue({ kind: 'placeBuilding', buildingType: HEADQUARTERS, x: 5, y: 0, tribe: VIKING });
    sim.enqueue({ kind: 'spawnSettler', jobType: WOODCUTTER, x: 6, y: 0, tribe: VIKING });
    sim.step();

    expect(sim.world.canonicalEntities()).toHaveLength(2);
    // First enqueued (the building) got the lower id.
    expect(sim.world.has(nthEntity(sim, 0), Building)).toBe(true);
    expect(sim.world.has(nthEntity(sim, 1), Settler)).toBe(true);
  });

  it('is deterministic: same seed + same commands on the same ticks => byte-identical state', () => {
    const cmds: Command[] = [
      { kind: 'placeBuilding', buildingType: HEADQUARTERS, x: 2, y: 2, tribe: VIKING },
      { kind: 'spawnSettler', jobType: WOODCUTTER, x: 3, y: 3, tribe: VIKING },
    ];

    const runA = fresh(7);
    for (const c of cmds) runA.enqueue(c);
    runA.run(50);
    const hashA = runA.hashState();

    clearComponentStores();
    const runB = fresh(7);
    for (const c of cmds) runB.enqueue(c);
    runB.run(50);
    const hashB = runB.hashState();

    expect(hashB).toBe(hashA);
  });
});
