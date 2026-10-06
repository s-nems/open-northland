import { describe, expect, it } from 'vitest';
import type { Component, Entity } from '../../src/ecs/world.js';
import { PendingWrites } from '../../src/inspect/pending-writes.js';

const A = { id: 1, name: 'A' } as Component<unknown>;
const B = { id: 2, name: 'B' } as Component<unknown>;
/** Past the dense id range, where only a crafted save could name an entity. */
const SPARSE_ID = 2 ** 30;
const id = (n: number) => n as Entity;
const writtenBy = (pending: PendingWrites, entity: Entity) =>
  pending.writtenBy(entity).slice(0, pending.writtenCount(entity));

describe('pending writes', () => {
  it('logs each entity once with its components in first-write order, and lists the alive ones ascending', () => {
    const pending = new PendingWrites();
    pending.add(id(9), [B]);
    pending.add(id(3), [A]);
    pending.add(id(9), [A, B]);
    pending.add(id(SPARSE_ID), [A]);
    expect(pending.size).toBe(3);
    expect([...pending.ascending()]).toEqual([3, 9, SPARSE_ID]);
    expect(writtenBy(pending, id(9))).toEqual([B, A]);
    expect(writtenBy(pending, id(SPARSE_ID))).toEqual([A]);
    expect(writtenBy(pending, id(4))).toEqual([]);
  });

  it('forgets a destroyed entity until it is written again, and starts empty after a clear', () => {
    const pending = new PendingWrites();
    pending.add(id(5), [A]);
    pending.add(id(6), [B]);
    pending.delete(id(5));
    pending.delete(id(5));
    pending.delete(id(7));
    expect(pending.size).toBe(1);
    expect([...pending.ascending()]).toEqual([6]);
    pending.add(id(5), [B]);
    expect([...pending.ascending()]).toEqual([5, 6]);
    expect(writtenBy(pending, id(5))).toEqual([B]);
    pending.clear();
    expect(pending.size).toBe(0);
    expect([...pending.ascending()]).toEqual([]);
    expect(writtenBy(pending, id(6))).toEqual([]);
    // A slot reused after the clear starts with an empty list.
    pending.add(id(8), [A]);
    expect(writtenBy(pending, id(8))).toEqual([A]);
  });

  it('grows past its first capacity', () => {
    const pending = new PendingWrites();
    const MANY = 5000;
    for (let n = MANY; n > 0; n--) pending.add(id(n * 2), [A]);
    expect(pending.size).toBe(MANY);
    const ids = pending.ascending();
    expect(ids[0]).toBe(2);
    expect(ids[MANY - 1]).toBe(MANY * 2);
  });
});
