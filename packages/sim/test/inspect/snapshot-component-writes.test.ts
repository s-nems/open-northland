import { describe, expect, it, vi } from 'vitest';
import { Position, Resource, SettlerNeeds } from '../../src/components/index.js';
import { entityDeltas, fx, Simulation, type SnapshotDelta } from '../../src/index.js';
import { clonePlain } from '../../src/inspect/plain-clone.js';
import { testContent } from '../fixtures/content.js';

/** The first entity a delta touched, as `entityDeltas` lists it. */
function firstTouched(delta: SnapshotDelta | null | undefined) {
  return delta === null || delta === undefined ? undefined : entityDeltas(delta)[0];
}

function fixture() {
  const sim = new Simulation({ seed: 7, content: testContent() });
  const id = sim.world.create();
  sim.world.add(id, Position, { x: 0, y: 0 });
  sim.world.add(id, Resource, { goodType: 1, remaining: 5, harvestAtomic: 24 });
  return { sim, id };
}

describe('snapshot component write tracking', () => {
  it('keeps extra fields, insertion order and detached values when hot components are written', () => {
    const { sim, id } = fixture();
    const zero = fx.fromInt(0);
    const position = { y: zero, extra: { label: 'before' }, x: zero, cleared: undefined };
    const needs = { enjoyment: zero, extra: { label: 'before' }, piety: zero, fatigue: zero, hunger: zero };
    sim.world.add(id, Position, position);
    sim.world.add(id, SettlerNeeds, needs);
    const stream = sim.snapshotDeltas();
    stream.next();
    const held = sim.snapshot().entities[0];
    sim.world.mut(id, Position).x = fx.fromInt(3);
    position.extra.label = 'after';
    sim.world.mut(id, SettlerNeeds).hunger = fx.fromInt(1);
    needs.extra.label = 'after';
    const written = firstTouched(stream.next())?.components;
    if (written === undefined) throw new Error('expected a component delta');
    expect(written?.Position).toEqual({ y: zero, extra: { label: 'after' }, x: fx.fromInt(3) });
    expect(Object.keys(written?.Position as object)).toEqual(['y', 'extra', 'x']);
    expect(written?.SettlerNeeds).toEqual({
      enjoyment: zero,
      extra: { label: 'after' },
      piety: zero,
      fatigue: zero,
      hunger: fx.fromInt(1),
    });
    expect(Object.keys(written?.SettlerNeeds as object)).toEqual([
      'enjoyment',
      'extra',
      'piety',
      'fatigue',
      'hunger',
    ]);
    expect(held?.components.Position).toEqual({ y: zero, extra: { label: 'before' }, x: zero });
    expect(held?.components.SettlerNeeds).toMatchObject({ extra: { label: 'before' } });
    expect(Object.getOwnPropertyDescriptor(written.Position, 'extra')?.value).not.toBe(position.extra);
    expect(Object.getOwnPropertyDescriptor(written.SettlerNeeds, 'extra')?.value).not.toBe(needs.extra);
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('clones an own prototype-named field as detached plain data', () => {
    const field = { label: 'payload' };
    const cloned = clonePlain({ before: 1, ['__proto__']: field, cleared: undefined, after: 2 });
    expect(Object.getPrototypeOf(cloned)).toBe(Object.prototype);
    expect(Object.keys(cloned)).toEqual(['before', '__proto__', 'after']);
    expect(Object.hasOwn(cloned, '__proto__')).toBe(true);
    const copiedField = Object.getOwnPropertyDescriptor(cloned, '__proto__')?.value;
    expect(copiedField).toEqual({ label: 'payload' });
    expect(copiedField).not.toBe(field);
  });

  it('opens a snapshot cache after earlier writes and keeps it current after the last stream closes', () => {
    const { sim, id } = fixture();
    sim.world.mut(id, Resource).remaining = 4;
    const stream = sim.snapshotDeltas();
    const first = stream.next();
    expect(firstTouched(first)?.components.Resource).toMatchObject({ remaining: 4 });
    const held = sim.snapshot().entities[0];
    stream.close();
    sim.world.mut(id, Resource).remaining = 3;
    const current = sim.snapshot().entities[0];
    expect(current?.components.Resource).toMatchObject({ remaining: 3 });
    expect(current?.components.Position).toBe(held?.components.Position);
    expect(held?.components.Resource).toMatchObject({ remaining: 4 });
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('clones a value write without walking carried components or changing previous snapshots', () => {
    const { sim, id } = fixture();
    const stream = sim.snapshotDeltas();
    stream.next();
    const before = sim.snapshot().entities[0];
    const walk = vi.spyOn(sim.world, 'forEachComponent');
    sim.world.mut(id, Position).x = fx.fromInt(3);
    const delta = stream.next();
    const after = sim.snapshot().entities[0];
    expect(walk).not.toHaveBeenCalled();
    expect(firstTouched(delta)?.components).toEqual({ Position: { x: fx.fromInt(3), y: 0 } });
    expect(after).not.toBe(before);
    expect(after?.components.Resource).toBe(before?.components.Resource);
    expect(before?.components.Position).toEqual({ x: 0, y: 0 });
    walk.mockRestore();
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('keeps independent stream bases across snapshot drains and remove/re-add cycles', () => {
    const { sim, id } = fixture();
    const fast = sim.snapshotDeltas();
    const slow = sim.snapshotDeltas();
    const held = firstTouched(fast.next())?.components;
    slow.next();
    // Write in reverse registration order, then repeat writes across separate drains.
    sim.world.mut(id, Resource).remaining = 4;
    const heldWrite = firstTouched(fast.next())?.components;
    for (const x of [1, 2]) {
      sim.world.mut(id, Position).x = fx.fromInt(x);
      sim.world.mut(id, Resource).remaining = 4 - x;
      sim.snapshot();
      expect(Object.keys(firstTouched(fast.next())?.components ?? {})).toEqual(['Position', 'Resource']);
    }
    sim.world.remove(id, Resource);
    sim.snapshot();
    expect(firstTouched(fast.next())?.removed).toEqual(['Resource']);
    sim.world.add(id, Resource, { goodType: 1, remaining: 7, harvestAtomic: 24 });
    const delta = slow.next();
    expect(firstTouched(delta)?.removed).toEqual([]);
    expect(Object.keys(firstTouched(delta)?.components ?? {})).toEqual(['Position', 'Resource']);
    expect(heldWrite).toEqual({ Resource: { goodType: 1, remaining: 4, harvestAtomic: 24 } });
    expect(held).toEqual({
      Position: { x: 0, y: 0 },
      Resource: { goodType: 1, remaining: 5, harvestAtomic: 24 },
    });
    expect(firstTouched(delta)?.components).toEqual({
      Position: { x: fx.fromInt(2), y: 0 },
      Resource: { goodType: 1, remaining: 7, harvestAtomic: 24 },
    });
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('preserves unwritten clones when membership changes and canonical component order on re-add', () => {
    const { sim, id } = fixture();
    const before = sim.snapshot().entities[0];
    sim.world.remove(id, Resource);
    const removed = sim.snapshot().entities[0];
    expect(removed?.components.Position).toBe(before?.components.Position);
    sim.world.add(id, Resource, { goodType: 1, remaining: 1, harvestAtomic: 24 });
    expect(Object.keys(sim.snapshot().entities[0]?.components ?? {})).toEqual(['Position', 'Resource']);
  });
});
