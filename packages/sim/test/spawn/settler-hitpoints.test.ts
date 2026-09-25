import { parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { Health } from '../../src/components/index.js';
import { Rng } from '../../src/core/rng.js';
import { World } from '../../src/ecs/world.js';
import { CHILD_FEMALE } from '../../src/systems/index.js';
import { createSettler, HUMAN_HITPOINTS } from '../../src/systems/spawn/index.js';
import { testContent } from '../fixtures/content.js';

/** Every person spawns on the original's 5000-point pool, child or adult, unless the command sets one. */

const VIKING = 1;
const ORDERED_POOL = 250;

const spec = (tribe: number, hitpoints?: number) => ({
  jobType: 0, // the idle sentinel - valid on any content
  x: 0,
  y: 0,
  tribe,
  ...(hitpoints !== undefined ? { hitpoints } : {}),
});

/** The shared fixture plus the age-class job row (the child stage is matched by SLUG) to spawn a child into. */
function contentWithChildStage() {
  const base = testContent();
  return parseContentSet({ ...base, jobs: [...base.jobs, { typeId: CHILD_FEMALE, id: 'child_female' }] });
}

describe('createSettler - spawn hitpoints', () => {
  it('gives an adult the 5000-point pool', () => {
    const world = new World();
    const e = createSettler(world, testContent(), new Rng(1), spec(VIKING));
    if (e === null) throw new Error('spawn failed');
    expect(HUMAN_HITPOINTS).toBe(5000);
    expect(world.get(e, Health)).toEqual({ hitpoints: HUMAN_HITPOINTS, max: HUMAN_HITPOINTS });
  });

  it('gives a child the same pool', () => {
    const world = new World();
    const e = createSettler(world, contentWithChildStage(), new Rng(1), {
      ...spec(VIKING),
      jobType: CHILD_FEMALE,
    });
    if (e === null) throw new Error('spawn failed');
    expect(world.get(e, Health)).toEqual({ hitpoints: HUMAN_HITPOINTS, max: HUMAN_HITPOINTS });
  });

  it('an explicit positive command pool wins', () => {
    const world = new World();
    const e = createSettler(world, testContent(), new Rng(1), spec(VIKING, ORDERED_POOL));
    if (e === null) throw new Error('spawn failed');
    expect(world.get(e, Health)).toEqual({ hitpoints: ORDERED_POOL, max: ORDERED_POOL });
  });
});
