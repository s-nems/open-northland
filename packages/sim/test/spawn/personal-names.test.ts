import { type PersonalNamePool, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { Female, NameIdentity, Position, Settler, setSettlerJob } from '../../src/components/index.js';
import { fx } from '../../src/core/fixed.js';
import { PersonalNames } from '../../src/core/personal-names.js';
import { World } from '../../src/ecs/world.js';
import {
  diffDigestInputs,
  exportSaveGame,
  parseSaveGame,
  restoreSimulation,
  Simulation,
  serializeSaveGame,
} from '../../src/index.js';
import { spawnNewborn } from '../../src/systems/spawn/newborn.js';
import { testContent } from '../fixtures/content.js';

const pools: PersonalNamePool[] = [
  { id: 'test-male', tribe: 1, sex: 'male', names: ['Erik', 'Leif', 'Ulf', 'Ivar'] },
  { id: 'test-female', tribe: 1, sex: 'female', names: ['Astrid', 'Sigrid'] },
  { id: 'test-neutral', tribe: 5, sex: 'neutral', names: ['Ssarakh', 'Zessir'] },
];
function take(
  names: PersonalNames,
  world: World,
  tribe = 1,
  sex: 'male' | 'female' = 'male',
): string | undefined {
  const e = world.create();
  names.assign(world, e, tribe, sex);
  return world.tryGet(e, NameIdentity)?.name;
}
function content() {
  const source = testContent();
  return parseContentSet({ ...source, personalNames: pools.filter((pool) => pool.tribe === 1) });
}
function spawn(sim: Simulation, owner = 0): void {
  sim.enqueueSetup({ kind: 'spawnSettler', tribe: 1, jobType: 0, owner, x: 0, y: 0 });
  sim.step();
}

describe('personal name decks', () => {
  it('deals the full pool without replacement and repeats only after exhaustion', () => {
    const names = new PersonalNames(77, pools);
    const world = new World();
    const first = Array.from({ length: 4 }, () => take(names, world));
    expect(new Set(first).size).toBe(4);
    expect(Array.from({ length: 4 }, () => take(names, world))).toEqual(first);
  });
  it('has independent sex and tribe decks, a neutral creature deck and no foreign fallback', () => {
    const names = new PersonalNames(8, pools);
    const world = new World();
    expect(pools[1]?.names).toContain(take(names, world, 1, 'female'));
    const a = take(names, world, 5, 'female');
    const b = take(names, world, 5, 'male');
    expect(a).not.toBe(b);
    expect(take(names, world, 99)).toBeUndefined();
  });
  it('uses the world seed while keeping deterministic repeat runs', () => {
    const draw = (seed: number) => {
      const names = new PersonalNames(seed, pools);
      const world = new World();
      return Array.from({ length: 4 }, () => take(names, world));
    };
    expect(draw(8)).toEqual(draw(8));
    expect(draw(8)).not.toEqual(draw(24));
  });
  it('shares a pool across owners and does not draw gameplay randomness', () => {
    const a = new Simulation({ seed: 12, content: content() });
    const b = new Simulation({ seed: 12, content: testContent() });
    for (const owner of [0, 1, 0, 1]) {
      spawn(a, owner);
      spawn(b, owner);
    }
    expect(new Set([...a.world.query(NameIdentity)].map((e) => a.world.get(e, NameIdentity).name)).size).toBe(
      4,
    );
    expect(a.rng.getState()).toBe(b.rng.getState());
    expect(a.world.nextEntityId).toBe(b.world.nextEntityId);
  });
  it('preserves identity through a job change and continues the deck after save/load and deaths', () => {
    const sim = new Simulation({ seed: 13, content: content() });
    spawn(sim);
    const e = [...sim.world.query(NameIdentity)][0];
    if (e === undefined) throw new Error('missing person');
    const before = sim.world.get(e, NameIdentity);
    setSettlerJob(sim.world, e, 1);
    expect(sim.world.get(e, NameIdentity)).toEqual(before);
    sim.world.destroy(e);
    const restored = restoreSimulation(exportSaveGame(sim), { content: sim.content });
    spawn(sim);
    spawn(restored);
    expect(restored.hashState()).toBe(sim.hashState());
    expect(exportSaveGame(restored)).toEqual(exportSaveGame(sim));
    expect(
      [...sim.world.query(NameIdentity)].map((id) => sim.world.get(id, NameIdentity).name),
    ).not.toContain(before.name);
  });
  it('names a newborn from its tribe and ordered sex, independently of its parent name', () => {
    const sim = new Simulation({ seed: 14, content: content() });
    spawn(sim);
    const mother = [...sim.world.query(Settler)][0];
    if (mother === undefined) throw new Error('missing parent');
    sim.world.add(mother, Female, { female: true });
    sim.world.mut(mother, Position).x = fx.fromInt(1);
    const baby = spawnNewborn(sim.world, sim.content, mother, sim.world.create(), 'female', sim.names);
    expect(pools[1]?.names).toContain(sim.world.get(baby, NameIdentity).name);
  });
  it('persists a living identity and its next allocation through JSON', () => {
    const sim = new Simulation({ seed: 13, content: content() });
    spawn(sim);
    const saved = parseSaveGame(JSON.parse(serializeSaveGame(exportSaveGame(sim))));
    const restored = restoreSimulation(saved, { content: sim.content });
    expect(restored.snapshot().entities).toEqual(sim.snapshot().entities);
    expect(restored.names.snapshot()).toEqual(sim.names.snapshot());
    spawn(sim);
    spawn(restored);
    expect(restored.hashState()).toBe(sim.hashState());
  });

  it('rejects saved cursor corruption and a missing stored identity', () => {
    const sim = new Simulation({ seed: 4, content: content() });
    spawn(sim);
    const save = exportSaveGame(sim);
    for (const cursor of [
      { pool: 'absent', next: 0 },
      { pool: 'test-male', next: 4 },
    ]) {
      const corrupt = {
        ...save,
        sections: save.sections.map((section) =>
          section.id === 'names' ? { ...section, cursors: [cursor] } : section,
        ),
      };
      expect(() => restoreSimulation(parseSaveGame(corrupt), { content: sim.content })).toThrow(/cursor/);
    }
    const duplicate = {
      ...save,
      sections: save.sections.map((section) =>
        section.id === 'names' ? { ...section, cursors: [...section.cursors, ...section.cursors] } : section,
      ),
    };
    expect(() => parseSaveGame(duplicate)).toThrow(/ascend/);
    const person = [...sim.world.query(NameIdentity)][0];
    if (person === undefined) throw new Error('missing person');
    sim.world.remove(person, NameIdentity);
    expect(() => restoreSimulation(exportSaveGame(sim), { content: sim.content })).toThrow(
      /Missing personal name/,
    );
  });

  it('includes future name allocation in state hashes and multiplayer diagnostics', () => {
    const a = new Simulation({ seed: 9, content: content() });
    const b = new Simulation({ seed: 9, content: content() });
    a.names.restore([{ pool: 'test-male', next: 1 }]);
    b.names.restore([{ pool: 'test-male', next: 2 }]);
    expect(a.hashState()).not.toBe(b.hashState());
    for (const sim of [a, b]) {
      sim.setSyncDigest(true, { captureInputs: true });
      sim.step();
    }
    expect(a.syncDigest()?.domains.settlers).not.toBe(b.syncDigest()?.domains.settlers);
    const left = a.syncDigestInputs();
    const right = b.syncDigestInputs();
    if (left === null || right === null) throw new Error('missing digest');
    expect(diffDigestInputs(left, right)?.kind).toBe('names');
  });

  it('rejects corrupt or unknown cursors and detects future-allocation divergence', () => {
    const names = new PersonalNames(3, pools);
    expect(() => names.restore([{ pool: 'missing', next: 0 }])).toThrow();
    expect(() => names.restore([{ pool: 'test-male', next: 4 }])).toThrow();
    expect(() => names.restore([{ pool: 'test-male', next: NaN }])).toThrow();
    const before = names.digest();
    names.restore([{ pool: 'test-male', next: 2 }]);
    expect(names.digest()).not.toBe(before);
  });
});
