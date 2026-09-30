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
      log.drain((entity, written, membership) => {
        changed.push(entity);
        expect(written.size).toBe(0);
        expect(membership).toBe(false);
      }),
    ).toBe(false);
    expect(changed).toEqual([id]);
    expect(log.pending(id)).toBe(false);
    expect(log.mutationCount).toBe(2);
  });

  it('reuses borrowed sets after draining without leaking component or membership names', () => {
    const log = new TouchedLog();
    log.trackComponents();
    const id = 1 as Entity;
    log.record(id, Position, true);
    log.record(id, Position);
    let borrowed: ReadonlySet<Component<unknown>> | undefined;
    log.drain((_entity, written, membership) => {
      borrowed = written;
      expect([...written]).toEqual([Position]);
      expect(membership).toBe(true);
    });
    log.record(2 as Entity, Resource);
    log.drain((entity, written, membership) => {
      expect(entity).toBe(2);
      expect(written).toBe(borrowed);
      expect([...written]).toEqual([Resource]);
      expect(membership).toBe(false);
    });
  });

  it('discards overflowed details and resumes collection after the rebuilding drain', () => {
    const log = new TouchedLog();
    log.trackComponents();
    for (let i = 1; i <= TOUCHED_LOG_OVERFLOW_LIMIT; i++) log.record(i as Entity, Position);
    log.record((TOUCHED_LOG_OVERFLOW_LIMIT + 1) as Entity, Resource);
    expect(log.pending(1 as Entity)).toBe(true);
    expect(
      log.drain((_entity, written) => {
        expect([...written]).toEqual([Resource]);
      }),
    ).toBe(true);
    log.record(1 as Entity, Position);
    expect(
      log.drain((_entity, written) => {
        expect([...written]).toEqual([Position]);
      }),
    ).toBe(false);
  });
});
