import { parseContentSet } from '@open-northland/data';
import { beforeEach, describe, expect, it } from 'vitest';
import { Health } from '../../src/components/index.js';
import { World } from '../../src/ecs/world.js';
import { clearComponentStores } from '../../src/harness/stores.js';
import { createSettler, DEFAULT_SETTLER_HITPOINTS } from '../../src/systems/conflict/spawn/index.js';
import { settlerHitpoints } from '../../src/systems/readviews/index.js';
import { testContent } from '../fixtures/content.js';

/**
 * A settler's spawn HP is content-driven: `createSettler` reads its tribe's `hitpoints` pool (the human
 * twin of an animal's `hitpointsAdult`) via {@link settlerHitpoints}, so a tribe carrying a pool spawns
 * every settler with it, a tribe that leaves it 0 falls back to {@link DEFAULT_SETTLER_HITPOINTS}, and an
 * explicit command override still wins. This is the wiring the real-content overlay (5000 on the playable
 * tribes) rides — pinning it keeps a future refactor from silently reverting every real settler to 300.
 */

const VIKING = 1;
const HUMAN_HP = 5000;

const spec = (tribe: number, hitpoints?: number) => ({
  jobType: 0, // the idle sentinel — valid on any content
  x: 0,
  y: 0,
  tribe,
  ...(hitpoints !== undefined ? { hitpoints } : {}),
});

/** The shared fixture with the viking tribe carrying an explicit `hitpoints` pool. */
function contentWithTribeHp(hitpoints: number) {
  const base = testContent();
  return parseContentSet({
    ...base,
    tribes: base.tribes.map((t) => (t.typeId === VIKING ? { ...t, hitpoints } : t)),
  });
}

beforeEach(() => {
  clearComponentStores();
});

describe('settlerHitpoints — the tribe HP pool read at spawn', () => {
  it("reads the tribe's hitpoints, or 0 when it carries none", () => {
    expect(settlerHitpoints(testContent(), VIKING)).toBe(0); // the fixture leaves it unset
    expect(settlerHitpoints(contentWithTribeHp(HUMAN_HP), VIKING)).toBe(HUMAN_HP);
  });
});

describe('createSettler resolves spawn HP from content', () => {
  it('uses the tribe pool when it carries one', () => {
    const world = new World();
    const e = createSettler(world, contentWithTribeHp(HUMAN_HP), spec(VIKING));
    if (e === null) throw new Error('spawn failed');
    expect(world.get(e, Health)).toEqual({ hitpoints: HUMAN_HP, max: HUMAN_HP });
  });

  it('falls back to the default pool when the tribe carries none', () => {
    const world = new World();
    const e = createSettler(world, testContent(), spec(VIKING));
    if (e === null) throw new Error('spawn failed');
    expect(world.get(e, Health)).toEqual({
      hitpoints: DEFAULT_SETTLER_HITPOINTS,
      max: DEFAULT_SETTLER_HITPOINTS,
    });
  });

  it('an explicit positive command override wins over the tribe pool', () => {
    const world = new World();
    const e = createSettler(world, contentWithTribeHp(HUMAN_HP), spec(VIKING, 250));
    if (e === null) throw new Error('spawn failed');
    expect(world.get(e, Health)).toEqual({ hitpoints: 250, max: 250 });
  });
});
