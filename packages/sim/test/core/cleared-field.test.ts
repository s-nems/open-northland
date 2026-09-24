import { describe, expect, it } from 'vitest';
import { defineComponent, World } from '../../src/ecs/world.js';
import { exportSaveGame, Simulation } from '../../src/index.js';
import { SyncDigestRecorder } from '../../src/simulation/sync-digest.js';
import { testContent } from '../fixtures/content.js';

/**
 * A component clears an optional field by assigning `undefined`, never `delete`, so its value stays in
 * V8's fast mode. Every walk over stored state must then read the cleared key exactly like a missing one.
 */

const Probe = defineComponent<{
  kept: number;
  nested: { cleared?: number | undefined };
  cleared?: number | undefined;
}>('ClearedFieldProbe', 'economy');

type ProbeValue = NonNullable<(typeof Probe)['__value']>;
const ABSENT: ProbeValue = { kept: 1, nested: {} };
const CLEARED: ProbeValue = { kept: 1, nested: { cleared: undefined }, cleared: undefined };

function simWith(value: ProbeValue): Simulation {
  const sim = new Simulation({ seed: 1, content: testContent() });
  sim.world.add(sim.world.create(), Probe, structuredClone(value));
  return sim;
}

/** The economy-domain word one tick's digest folds from a single write of `value`. */
function digestOf(value: ProbeValue): number {
  const world = new World();
  const recorder = new SyncDigestRecorder();
  world.setMutationSink(recorder);
  recorder.beginTick();
  world.add(world.create(), Probe, structuredClone(value));
  return recorder.seal(world, 0, 0, undefined).domains.economy;
}

const absent = () => simWith(ABSENT);
const cleared = () => simWith(CLEARED);

describe('a record key holding undefined', () => {
  it('hashes and digests like the same record without the key', () => {
    expect(cleared().hashState()).toBe(absent().hashState());
    expect(digestOf(CLEARED)).toBe(digestOf(ABSENT));
    expect(digestOf({ ...ABSENT, kept: 2 })).not.toBe(digestOf(ABSENT));
  });

  it('snapshots and saves without the key', () => {
    const snapshotOf = (sim: Simulation) => sim.snapshot().entities[0]?.components.ClearedFieldProbe;
    expect(snapshotOf(cleared())).toStrictEqual(snapshotOf(absent()));
    expect(snapshotOf(cleared())).toStrictEqual({ kept: 1, nested: {} });
    const saved = (sim: Simulation) =>
      exportSaveGame(sim).sections.find((s) => s.id === 'component' && s.name === 'ClearedFieldProbe');
    expect(saved(cleared())).toStrictEqual(saved(absent()));
  });
});
