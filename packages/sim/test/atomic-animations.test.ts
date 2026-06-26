import { type ContentSet, IR_VERSION, parseContentSet } from '@vinland/data';
import { describe, expect, it } from 'vitest';
import { atomicAnimationByName, atomicStartDirection, isInterruptibleAtomic } from '../src/systems/index.js';

/**
 * The atomic-animation read views — `atomicAnimationByName` (the canonical name→record resolver the
 * `atomicDuration`/combat-cadence lookups spell out inline), `isInterruptibleAtomic`, and
 * `atomicStartDirection` surface the two `atomicanimations.ini` scalars (`interruptable`,
 * `startdirection`) no sim system reads yet. These are genuinely extracted (245/896 animations carry
 * `interruptible=true`, 89/896 a `startDirection` in the real IR), so the fixture sets non-default
 * values on a couple of entries to exercise a real read, not just the schema defaults.
 *
 * The fixture mirrors the real shape: an uninterruptible directional swing (`chop`, facing pinned), an
 * interruptible idle (no facing), and a plain entry that pins neither (the schema defaults).
 */
function animationContent(): ContentSet {
  return parseContentSet({
    manifest: { version: IR_VERSION, generatedFrom: { game: 'synthetic-test-fixture' }, locale: 'eng' },
    goods: [{ typeId: 0, id: 'none' }],
    jobs: [{ typeId: 0, id: 'idle' }],
    buildings: [{ typeId: 1, id: 'headquarters', kind: 'headquarters' }],
    atomicAnimations: [
      // A harvest swing: must play to completion (uninterruptible) and pins a facing direction.
      { id: 'viking_chop', name: 'viking_chop', length: 3, interruptible: false, startDirection: 2 },
      // An idle: a settler may abandon it the instant a higher-priority drive fires; no pinned facing.
      { id: 'viking_idle', name: 'viking_idle', length: 100, interruptible: true },
      // A plain entry pinning neither — exercises the schema defaults (interruptible=false, no facing).
      { id: 'viking_walk', name: 'viking_walk', length: 8 },
    ],
  });
}

describe('atomicAnimationByName', () => {
  it('resolves an animation by its exact name (the setatomic join key, not the slug id)', () => {
    const content = animationContent();
    const chop = atomicAnimationByName(content, 'viking_chop');
    expect(chop?.length).toBe(3);
    expect(chop?.name).toBe('viking_chop');
  });

  it('returns undefined for a name with no record (an unresolvable binding is expected, not malformed)', () => {
    expect(atomicAnimationByName(animationContent(), 'nonexistent_anim')).toBeUndefined();
  });

  it('is byte-stable call-to-call (a pure function of content)', () => {
    const content = animationContent();
    expect(atomicAnimationByName(content, 'viking_idle')).toEqual(
      atomicAnimationByName(content, 'viking_idle'),
    );
  });
});

describe('isInterruptibleAtomic', () => {
  it('is true for an interruptible animation and false for an uninterruptible one', () => {
    const content = animationContent();
    expect(isInterruptibleAtomic(content, 'viking_idle')).toBe(true);
    expect(isInterruptibleAtomic(content, 'viking_chop')).toBe(false);
  });

  it('defaults to false for the entry pinning no flag and for an unknown name', () => {
    const content = animationContent();
    expect(isInterruptibleAtomic(content, 'viking_walk')).toBe(false); // schema default
    expect(isInterruptibleAtomic(content, 'nonexistent_anim')).toBe(false); // unknown → safe non-preempt default
  });
});

describe('atomicStartDirection', () => {
  it('returns the pinned facing index when the animation carries one', () => {
    expect(atomicStartDirection(animationContent(), 'viking_chop')).toBe(2);
  });

  it('returns undefined when the animation pins no facing (distinct from facing 0/north)', () => {
    const content = animationContent();
    expect(atomicStartDirection(content, 'viking_idle')).toBeUndefined();
    expect(atomicStartDirection(content, 'viking_walk')).toBeUndefined();
  });

  it('returns undefined for an unknown name', () => {
    expect(atomicStartDirection(animationContent(), 'nonexistent_anim')).toBeUndefined();
  });
});
