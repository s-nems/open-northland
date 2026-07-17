import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../../src/core/events.js';
import { eventNode } from '../../src/core/events.js';
import type { Entity } from '../../src/ecs/world.js';

/**
 * `eventNode` is the seam that keeps a consumer from hand-listing the `at`-carrying event kinds: audio's
 * old list had drifted, so `settlersMarried`/`resourceMined`/`berryForaged` located by a `.entity` they
 * do not have (→ `undefined`) and every one of them debounced to the same key. These pin that the helper
 * reads the event rather than a list, so a new positioned variant needs no consumer edit.
 */

const e = (id: number) => id as Entity;

describe('eventNode', () => {
  it('returns the node for events whose emitter entity is already gone by the snapshot', () => {
    const felled: SimEvent = {
      kind: 'resourceFelled',
      node: e(1),
      trunk: e(2),
      stump: e(3),
      goodType: 4,
      amount: 5,
      at: { hx: 8, hy: 6 },
    };
    expect(eventNode(felled)).toEqual({ hx: 8, hy: 6 });
  });

  it.each<[string, SimEvent]>([
    ['settlersMarried', { kind: 'settlersMarried', a: e(1), b: e(2), at: { hx: 3, hy: 4 } }],
    ['resourceMined', { kind: 'resourceMined', node: e(1), goodType: 2, at: { hx: 5, hy: 6 } }],
    ['berryForaged', { kind: 'berryForaged', bush: e(1), at: { hx: 7, hy: 8 } }],
  ])('locates %s by its node — none of these carries an `entity` to fall back on', (_kind, ev) => {
    expect(eventNode(ev)).not.toBeNull();
    expect('entity' in ev).toBe(false);
  });

  it('returns null for an event that locates by its emitter entity', () => {
    expect(eventNode({ kind: 'settlerBorn', entity: e(1) })).toBeNull();
    expect(eventNode({ kind: 'atomicCompleted', entity: e(1), atomicId: 24 })).toBeNull();
  });

  it("handles settlerDied's optional `at` both ways", () => {
    const withNode: SimEvent = {
      kind: 'settlerDied',
      entity: e(1),
      cause: 'damage',
      player: 0,
      at: { hx: 2, hy: 3 },
    };
    const positionless: SimEvent = { kind: 'settlerDied', entity: e(1), cause: 'damage', player: 0 };
    expect(eventNode(withNode)).toEqual({ hx: 2, hy: 3 });
    expect(eventNode(positionless)).toBeNull();
  });
});
