import { describe, expect, it } from 'vitest';
import { addPerson, Settler } from '../../src/components/index.js';
import { entityDeltas, fx, Simulation } from '../../src/index.js';
import { needsSystem } from '../../src/systems/index.js';
import { testContent } from '../fixtures/content.js';
import { nextTickCtxOf } from '../fixtures/context.js';
import { needsOf } from '../fixtures/settler.js';

describe('settler need ownership', () => {
  it('drains bars while preserving identity revisions and snapshot component references', () => {
    const sim = new Simulation({ seed: 7, content: testContent() });
    const id = sim.world.create();
    const zero = fx.fromInt(0);
    const initial = { tribe: 1, jobType: 1, hunger: zero, fatigue: zero, piety: zero, enjoyment: zero };
    addPerson(sim.world, id, initial);
    const identity = sim.world.get(id, Settler);
    const revision = sim.world.revisionOf(id, Settler);
    const stream = sim.snapshotDeltas();
    stream.next();
    const before = sim.snapshot().entities[0];

    needsSystem(sim.world, nextTickCtxOf(sim));
    const delta = stream.next();
    const after = sim.snapshot().entities[0];
    expect(sim.world.get(id, Settler)).toBe(identity);
    expect(sim.world.revisionOf(id, Settler)).toBe(revision);
    expect(Object.keys(identity)).toEqual(['tribe', 'jobType']);
    expect(Object.keys((delta === null ? undefined : entityDeltas(delta)[0])?.components ?? {})).toEqual([
      'SettlerNeeds',
    ]);
    expect(after?.components.Settler).toBe(before?.components.Settler);
    expect(after?.components.SettlerNeeds).not.toBe(before?.components.SettlerNeeds);
    expect(needsOf(sim, id).hunger).toBeGreaterThan(zero);
    expect(initial.hunger).toBe(zero);
    expect(sim.world.verifyCaches()).toEqual([]);
  });
});
