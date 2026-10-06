import { describe, expect, it } from 'vitest';
import { Position, Resource } from '../../src/components/index.js';
import type { Component, Entity } from '../../src/ecs/component.js';
import { TOUCHED_LOG_OVERFLOW_LIMIT, TouchedLog } from '../../src/ecs/touched-log.js';

describe('touched log component collection', () => {
  it('keeps entity invalidation and revisions before component tracking begins', () => {
    const log = new TouchedLog();
    const id = 1 as Entity;
    expect(log.record(id, Position, true)).toBe(1);
    expect(log.record(id, Resource)).toBe(2);
    expect(log.pending(id)).toBe(true);
    const changed: number[] = [];
    expect(
      log.drain((entity, _written, count, membership) => {
        changed.push(entity);
        expect(count).toBe(0);
        expect(membership).toBe(false);
      }),
    ).toBe(false);
    expect(changed).toEqual([id]);
    expect(log.pending(id)).toBe(false);
    expect(log.mutationCount).toBe(2);
  });

  it('reuses lent lists after draining without leaking component or membership names', () => {
    const log = new TouchedLog();
    log.trackComponents();
    const id = 1 as Entity;
    log.record(id, Position, true);
    log.record(id, Resource);
    log.record(id, Position);
    let lent: readonly Component<unknown>[] | undefined;
    log.drain((_entity, written, count, membership) => {
      lent = written;
      expect(written.slice(0, count)).toEqual([Position, Resource]);
      expect(membership).toBe(true);
    });
    log.record(2 as Entity, Resource);
    log.drain((entity, written, count, membership) => {
      expect(entity).toBe(2);
      // The same list, its storage kept: only the first `count` entries are this entity's.
      expect(written).toBe(lent);
      expect(written.slice(0, count)).toEqual([Resource]);
      expect(membership).toBe(false);
    });
  });

  it('collects components for an entity logged before tracking began', () => {
    const log = new TouchedLog();
    log.record(1 as Entity, Position);
    log.trackComponents();
    log.record(2 as Entity, Position);
    log.record(1 as Entity, Resource);
    const seen: Array<[number, Component<unknown>[]]> = [];
    log.drain((entity, written, count) => seen.push([entity, written.slice(0, count)]));
    expect(seen).toEqual([
      [1, [Resource]],
      [2, [Position]],
    ]);
  });

  it('discards overflowed details and resumes collection after the rebuilding drain', () => {
    const log = new TouchedLog();
    log.trackComponents();
    for (let i = 1; i <= TOUCHED_LOG_OVERFLOW_LIMIT; i++) log.record(i as Entity, Position);
    log.record((TOUCHED_LOG_OVERFLOW_LIMIT + 1) as Entity, Resource);
    expect(log.pending(1 as Entity)).toBe(true);
    expect(
      log.drain((_entity, written, count) => {
        expect(written.slice(0, count)).toEqual([Resource]);
      }),
    ).toBe(true);
    log.record(1 as Entity, Position);
    expect(
      log.drain((_entity, written, count) => {
        expect(written.slice(0, count)).toEqual([Position]);
      }),
    ).toBe(false);
  });

  it('logs an id past the dense stamp range like any other', () => {
    const log = new TouchedLog();
    log.trackComponents();
    const far = 0x7ffffffe as Entity;
    log.record(1 as Entity, Position);
    log.record(far, Resource, true);
    expect(log.pending(far)).toBe(true);
    const seen: Array<[number, boolean]> = [];
    expect(log.drain((entity, _written, _count, membership) => seen.push([entity, membership]))).toBe(false);
    expect(seen).toEqual([
      [1, false],
      [far, true],
    ]);
    expect(log.pending(far)).toBe(false);
  });
});
