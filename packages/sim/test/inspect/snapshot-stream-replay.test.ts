import { expect, it } from 'vitest';
import { defineComponent } from '../../src/ecs/component.js';
import { type Entity, World } from '../../src/ecs/world.js';
import { diffSnapshots } from '../../src/index.js';
import { takeSnapshot } from '../../src/inspect/snapshot.js';
import { SnapshotDeltaStream } from '../../src/inspect/snapshot-clones.js';
import { SnapshotMirror } from '../../src/inspect/snapshot-mirror.js';

interface Payload {
  n: number;
  nested: Map<number, { v: number }>;
  list: number[];
}

const COMPONENTS = ['ReplayA', 'ReplayB', 'ReplayC', 'ReplayD', 'ReplayE'].map((name) =>
  defineComponent<Payload>(name, 'economy'),
);
const SEEDS = 60;
const STEPS = 200;
const STREAMS = 3;
const HELD_SNAPSHOTS = 5;

/** A linear congruential generator keeps the operation sequence reproducible per seed. */
function randomOf(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function pick<T>(items: readonly T[], random: () => number): T {
  const item = items[Math.floor(random() * items.length)];
  if (item === undefined) throw new Error('empty choice');
  return item;
}

it('keeps every independently taken stream equal to the live snapshot and leaves held snapshots alone', () => {
  for (let seed = 1; seed <= SEEDS; seed++) {
    const random = randomOf(seed);
    const world = new World();
    const source = { world, tick: 0, events: { current: () => [] } };
    const streams = Array.from({ length: STREAMS }, () => new SnapshotDeltaStream(source));
    const mirrors = streams.map(() => new SnapshotMirror());
    const held: Array<Array<{ entities: unknown; json: string }>> = streams.map(() => []);
    const alive: Entity[] = [];
    for (let step = 0; step < STEPS; step++) {
      const op = random();
      if (op < 0.1 || alive.length === 0) alive.push(world.create());
      else {
        const entity = pick(alive, random);
        const component = pick(COMPONENTS, random);
        if (op < 0.15) {
          world.destroy(entity);
          alive.splice(alive.indexOf(entity), 1);
        } else if (op < 0.4) {
          world.add(entity, component, { n: step, nested: new Map([[1, { v: step }]]), list: [step] });
        } else if (op < 0.55) world.remove(entity, component);
        else if (op < 0.85) {
          const value = world.tryMut(entity, component);
          if (value !== undefined) {
            value.n++;
            const cell = value.nested.get(1);
            if (cell !== undefined) cell.v = step;
            value.list.push(step);
          }
        } else if (op < 0.9) takeSnapshot(world, source.tick, []);
        else source.tick++;
      }
      if (random() >= 0.3) continue;
      const index = Math.floor(random() * streams.length);
      const stream = streams[index];
      const mirror = mirrors[index];
      const kept = held[index];
      if (stream === undefined || mirror === undefined || kept === undefined)
        throw new Error('stream expected');
      const delta = stream.next();
      if (delta === null) continue;
      mirror.apply(delta);
      const diff = diffSnapshots(mirror.snapshot(), takeSnapshot(world, source.tick, []));
      expect(diff, `seed ${seed} step ${step} stream ${index}`).toMatchObject({
        added: [],
        removed: [],
        changed: [],
      });
      for (const earlier of kept) expect(JSON.stringify(earlier.entities)).toBe(earlier.json);
      const entities = mirror.snapshot().entities.slice();
      kept.push({ entities, json: JSON.stringify(entities) });
      if (kept.length > HELD_SNAPSHOTS) kept.shift();
    }
    expect(world.verifyCaches()).toEqual([]);
  }
});
