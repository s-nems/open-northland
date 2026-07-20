import { type ContentSet, IR_VERSION, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { Age, Female, Settler } from '../../src/components/index.js';
import { Rng } from '../../src/core/rng.js';
import { World } from '../../src/ecs/world.js';
import { Simulation } from '../../src/index.js';
import { createSettler } from '../../src/systems/conflict/spawn/index.js';
import { ADULT_AGE_TICKS, CHILD_AGE_TICKS, CHILD_FEMALE, WOMAN_JOB } from '../../src/systems/index.js';

/**
 * A settler spawned directly into a baby/child job — an authored map's `sethuman` children — carries an
 * `Age` at its stage's starting tick, exactly like a born baby: `Age` is what makes the renderer draw the
 * young body and the GrowthSystem mature it (source basis: the original's maps author children via the
 * age-class jobtypes, `jobtypes.ini` ids 1–4). Slug-matched, so a fixture's adult trade on a low numeric
 * id spawns Age-less as before.
 */

const VIKING = 1;

/** The real age-class id space (`logicdefines.inc`): ids 1–4 carry the baby/child slugs. */
function ageClassContent(): ContentSet {
  return parseContentSet({
    manifest: { version: IR_VERSION, generatedFrom: { game: 'synthetic-test-fixture' }, locale: 'eng' },
    goods: [{ typeId: 0, id: 'none' }],
    jobs: [
      { typeId: 0, id: 'idle' },
      { typeId: 1, id: 'baby_female' },
      { typeId: 2, id: 'baby_male' },
      { typeId: 3, id: 'child_female' },
      { typeId: 4, id: 'child_male' },
    ],
    buildings: [],
  });
}

/** A fixture-style job table whose adult trade reuses a low age-class numeric id. */
function collidingContent(): ContentSet {
  return parseContentSet({
    manifest: { version: IR_VERSION, generatedFrom: { game: 'synthetic-test-fixture' }, locale: 'eng' },
    goods: [{ typeId: 0, id: 'none' }],
    jobs: [{ typeId: 1, id: 'woodcutter' }],
    buildings: [],
  });
}

const spec = (jobType: number) => ({ jobType, x: 0, y: 0, tribe: VIKING });

describe('createSettler stamps Age on the baby/child job slugs', () => {
  it('a baby spawns at the start of its stage (ticks 0), a child at the start of its stage', () => {
    const world = new World();
    const content = ageClassContent();
    const baby = createSettler(world, content, new Rng(1), spec(2)); // baby_male
    const child = createSettler(world, content, new Rng(1), spec(3)); // child_female
    if (baby === null || child === null) throw new Error('spawn failed');
    expect(world.get(baby, Age)).toEqual({ ticks: 0 });
    expect(world.has(baby, Female)).toBe(false);
    // A child starts at the baby→child boundary, so growth neither demotes it to a baby nor
    // stretches its remaining childhood.
    expect(world.get(child, Age)).toEqual({ ticks: CHILD_AGE_TICKS });
    expect(world.has(child, Female)).toBe(true);
  });

  it('matches by slug, not numeric id — a fixture adult trade on id 1 spawns Age-less', () => {
    const world = new World();
    const adult = createSettler(world, collidingContent(), new Rng(1), spec(1)); // woodcutter
    if (adult === null) throw new Error('spawn failed');
    expect(world.has(adult, Age)).toBe(false);
  });

  it('a map-spawned girl grows into the adult woman role after her remaining childhood', () => {
    const sim = new Simulation({ seed: 1, content: ageClassContent() });
    const girl = createSettler(sim.world, ageClassContent(), new Rng(1), spec(3)); // child_female
    if (girl === null) throw new Error('spawn failed');
    expect(sim.world.get(girl, Settler).jobType).toBe(CHILD_FEMALE);

    sim.run(ADULT_AGE_TICKS - CHILD_AGE_TICKS - 1); // one short of adulthood: still a child
    expect(sim.world.get(girl, Settler).jobType).toBe(CHILD_FEMALE);

    sim.run(1); // crosses ADULT_AGE_TICKS of lifetime: grown up
    expect(sim.world.get(girl, Settler).jobType).toBe(WOMAN_JOB);
    expect(sim.world.has(girl, Age)).toBe(false);
  });
});
