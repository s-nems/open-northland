import { describe, expect, it } from 'vitest';
import { Stockpile } from '../../../src/components/index.js';

import { fresh, HEADQUARTERS, nthEntity, VIKING, WOOD, WOODCUTTER } from './support.js';

describe('snapshot read-view', () => {
  it('is a plain, canonical, non-aliasing copy of the world (Maps -> sorted [k,v] arrays)', () => {
    const sim = fresh();
    sim.enqueue({ kind: 'placeBuilding', buildingType: HEADQUARTERS, x: 1, y: 1, tribe: VIKING });
    sim.step();

    const snap = sim.snapshot();
    expect(snap.tick).toBe(1);
    expect(snap.entities).toHaveLength(1);
    const [ent] = snap.entities;
    if (ent === undefined) throw new Error('expected one snapshot entity');
    expect(ent.id).toBe(nthEntity(sim, 0) as number);

    // The Stockpile Map became a plain sorted [k,v] array — no live Map in the snapshot (transferable).
    const stock = ent.components.Stockpile as { amounts: Array<[number, number]> };
    expect(stock.amounts).toEqual([[WOOD, 10]]);
    expect(stock.amounts).not.toBeInstanceOf(Map);

    // Non-aliasing: mutating the snapshot must not reach the live store.
    stock.amounts.push([99, 1]);
    expect(sim.world.get(nthEntity(sim, 0), Stockpile).amounts.has(99)).toBe(false);

    // The snapshot carries the tick's events.
    expect(snap.events.some((ev) => ev.kind === 'buildingPlaced')).toBe(true);
  });

  it('snapshot entities are in canonical ascending-id order', () => {
    const sim = fresh();
    sim.enqueue({ kind: 'spawnSettler', jobType: WOODCUTTER, x: 0, y: 0, tribe: VIKING });
    sim.enqueue({ kind: 'placeBuilding', buildingType: HEADQUARTERS, x: 1, y: 0, tribe: VIKING });
    sim.step();

    const snap = sim.snapshot();
    const ids = snap.entities.map((e) => e.id);
    expect([...ids].sort((a, b) => a - b)).toEqual(ids);
  });
});
