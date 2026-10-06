import { describe, expect, it } from 'vitest';
import { type Component, defineComponent, type Entity } from '../../src/ecs/world.js';
import { Simulation, type SnapshotDelta, SnapshotMirror, type WorldSnapshot } from '../../src/index.js';
import { testContent } from '../fixtures/content.js';

/**
 * A seeded fuzz of the delta stream's record layouts, which a stream keeps from delta to delta: records
 * whose optional fields come and go, change kind and order, and edge values, written through the
 * world's own seams and carried both directly and through a structured clone, must leave every mirror
 * equal to `Simulation.snapshot()` leaf by leaf (`Object.is`), each value's keys in the same order.
 */

/** More than sixteen, so an entity carrying all of them grows a wide record in the mirror. */
const COMPONENT_COUNT = 24;
const COMPONENTS: readonly Component<Record<string, unknown>>[] = Array.from(
  { length: COMPONENT_COUNT },
  (_, i) => defineComponent<Record<string, unknown>>(`DeltaFuzz${i}`, 'economy'),
);
const KEYS = ['a', 'b', 'c', 'd', 'e'] as const;
const VALUES: readonly unknown[] = [
  0,
  1,
  -0,
  Number.NaN,
  2 ** 40,
  -5.5,
  '',
  'x',
  true,
  false,
  null,
  undefined,
];
const SEEDS = 20;
const BATCHES = 150;
const ENTITIES = 6;
/** Each batch makes a few writes before its delta. */
const WRITES_PER_BATCH = 4;
const ACTIONS = 6;

/** A 32-bit xorshift: reproducible draws without the sim's own stream. */
function random(seed: number): (n: number) => number {
  let x = seed || 1;
  return (n) => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) % n;
  };
}

function pick<T>(draw: (n: number) => number, items: readonly T[]): T {
  return items[draw(items.length)] as T;
}

/** A record of a few keys in a drawn order, each a drawn scalar, sometimes a nested value. */
function record(draw: (n: number) => number): Record<string, unknown> {
  const keys = [...KEYS].sort(() => draw(3) - 1).slice(0, 1 + draw(KEYS.length));
  const out: Record<string, unknown> = {};
  for (const key of keys) out[key] = draw(10) === 0 ? { nested: pick(draw, VALUES) } : pick(draw, VALUES);
  return out;
}

function expectSame(mirrored: WorldSnapshot, live: WorldSnapshot, where: string): void {
  expect(
    mirrored.entities.map((e) => e.id),
    where,
  ).toEqual(live.entities.map((e) => e.id));
  for (let i = 0; i < live.entities.length; i++) {
    const want = live.entities[i]?.components ?? {};
    const got = mirrored.entities[i]?.components ?? {};
    // A component a held entity gains lands last in the mirror's record: components read by name.
    expect(Object.keys(got).sort(), where).toEqual(Object.keys(want).sort());
    for (const name of Object.keys(want)) expectLeaves(got[name], want[name], `${where} ${name}`);
  }
}

function expectLeaves(got: unknown, want: unknown, where: string): void {
  if (typeof want !== 'object' || want === null) {
    expect(Object.is(got, want), `${where}: ${String(got)} against ${String(want)}`).toBe(true);
    return;
  }
  expect(typeof got, where).toBe('object');
  const gotRecord = got as Record<string, unknown>;
  const wantRecord = want as Record<string, unknown>;
  expect(Object.keys(gotRecord), where).toEqual(Object.keys(wantRecord));
  for (const key of Object.keys(wantRecord)) expectLeaves(gotRecord[key], wantRecord[key], `${where}.${key}`);
}

describe('snapshot delta layouts under a seeded fuzz', () => {
  it('leave direct and cloned mirrors equal to the live snapshot', () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const draw = random(seed * 7919);
      const sim = new Simulation({ seed, content: testContent() });
      const world = sim.world;
      const entities: Entity[] = [];
      for (let i = 0; i < ENTITIES; i++) entities.push(world.create());
      // One entity carries every component from the start.
      const wide = entities[0] as Entity;
      for (const component of COMPONENTS) world.add(wide, component, record(draw));
      const deltas = sim.snapshotDeltas();
      const direct = new SnapshotMirror();
      const cloned = new SnapshotMirror();
      const carry = (delta: SnapshotDelta): void => {
        direct.apply(delta);
        cloned.apply(structuredClone(delta));
      };
      const opening = deltas.next();
      if (opening === null) throw new Error('a fresh stream opens with a rebuild');
      carry(opening);
      for (let batch = 0; batch < BATCHES; batch++) {
        for (let w = 0; w < WRITES_PER_BATCH; w++) {
          const entity = pick(draw, entities);
          const component = pick(draw, COMPONENTS);
          const held = world.isAlive(entity) ? world.tryGet(entity, component) : undefined;
          switch (draw(ACTIONS)) {
            case 0:
              if (world.isAlive(entity)) world.add(entity, component, record(draw));
              break;
            case 1:
            case 2:
              // A field rewritten in place: a new kind, or cleared, never deleted.
              if (held !== undefined) world.mut(entity, component)[pick(draw, KEYS)] = pick(draw, VALUES);
              break;
            case 3:
              if (held !== undefined) world.remove(entity, component);
              break;
            case 4:
              if (draw(4) === 0 && entity !== wide && world.isAlive(entity)) {
                world.destroy(entity);
                entities[entities.indexOf(entity)] = world.create();
              }
              break;
            default:
              if (held !== undefined) world.mut(entity, component).a = pick(draw, VALUES);
          }
        }
        const delta = deltas.next();
        if (delta !== null) carry(delta);
        const live = sim.snapshot();
        expectSame(direct.snapshot(), live, `seed ${seed} batch ${batch} direct`);
        expectSame(cloned.snapshot(), live, `seed ${seed} batch ${batch} cloned`);
      }
    }
  });
});
