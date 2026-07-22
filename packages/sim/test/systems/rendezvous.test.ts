import { describe, expect, it } from 'vitest';
import { defineComponent, type Entity, World } from '../../src/ecs/world.js';
import { driveMirroredPairs } from '../../src/systems/rendezvous.js';

/**
 * The shared mirrored-pair dispatch (`systems/rendezvous.ts`) the wedding and gossip passes both drive
 * their rituals through: pairs are visited in canonical order, an intact pair is advanced once from the
 * half `drives` selects, and a half whose partner is dead or no longer points back is torn down through
 * `onOrphaned` instead of being driven against a vanished partner.
 */

const Pair = defineComponent<{ partner: Entity }>('TestPair');

function pairUp(world: World, a: Entity, b: Entity): void {
  world.add(a, Pair, { partner: b });
  world.add(b, Pair, { partner: a });
}

describe('driveMirroredPairs', () => {
  it('drives an intact pair once, from the half `drives` selects', () => {
    const world = new World();
    const a = world.create();
    const b = world.create();
    pairUp(world, a, b);

    const driven: Array<[Entity, Entity]> = [];
    driveMirroredPairs(
      world,
      Pair,
      (self, partner) => self < partner, // drive from the lower id
      () => {
        throw new Error('an intact pair must not be orphaned');
      },
      (x, y) => driven.push([x, y]),
    );

    expect(driven).toEqual([[a, b]]);
  });

  it('orphans a half whose partner no longer points back, leaving intact pairs driven', () => {
    const world = new World();
    const a = world.create();
    const b = world.create();
    const c = world.create();
    pairUp(world, a, b);
    world.add(c, Pair, { partner: a }); // c points at a, but a points at b — a one-sided mirror

    const orphaned: Entity[] = [];
    const driven: Entity[] = [];
    driveMirroredPairs(
      world,
      Pair,
      () => true,
      (e) => orphaned.push(e),
      (x) => driven.push(x),
    );

    expect(orphaned).toEqual([c]);
    expect(driven).toContain(a);
  });

  it('orphans a half whose partner is dead', () => {
    const world = new World();
    const a = world.create();
    const b = world.create();
    pairUp(world, a, b);
    world.destroy(b); // a still carries the ritual pointing at a now-dead partner

    const orphaned: Entity[] = [];
    driveMirroredPairs(
      world,
      Pair,
      () => true,
      (e) => orphaned.push(e),
      () => {
        throw new Error('a pair with a dead half must not be driven');
      },
    );

    expect(orphaned).toEqual([a]);
  });

  it('visits pairs in canonical ascending-id order regardless of pairing order', () => {
    const world = new World();
    const a = world.create();
    const b = world.create();
    const c = world.create();
    const d = world.create();
    pairUp(world, c, d); // paired before a↔b, so store order can't stand in for id order
    pairUp(world, a, b);

    const order: Entity[] = [];
    driveMirroredPairs(
      world,
      Pair,
      (self, partner) => self < partner,
      () => {},
      (x) => order.push(x),
    );

    expect(order).toEqual([a, c]);
  });
});
