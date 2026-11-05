import { type ContentSet, IR_VERSION, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { Age, Female, Settler } from '../../../src/components/index.js';
import { PersonalNames } from '../../../src/core/personal-names.js';
import { Rng } from '../../../src/core/rng.js';
import { World } from '../../../src/ecs/world.js';
import { Simulation } from '../../../src/index.js';
import { ADULT_AGE_TICKS, CHILD_FEMALE, WOMAN_JOB } from '../../../src/systems/index.js';
import { createSettler } from '../../../src/systems/spawn/index.js';

/**
 * A settler spawned directly into a baby/child job - an authored map's `sethuman` children - carries an
 * `Age` at its stage's starting tick, exactly like a born baby: `Age` is what makes the renderer draw the
 * young body and the GrowthSystem mature it (source basis: the original's maps author children via the
 * age-class jobtypes, `jobtypes.ini` ids 1–4). Slug-matched, so a fixture's adult trade on a low numeric
 * id spawns Age-less as before.
 */

const VIKING = 1;

/** The real age-class id space (`logicdefines.inc`): ids 1–4 carry the baby/child slugs. */
function ageClassContent(): ContentSet {
  return parseContentSet({
    manifest: { version: IR_VERSION, generatedFrom: { data: 'synthetic-test-fixture' }, locale: 'eng' },
    goods: [{ typeId: 0, id: 'none' }],
    jobs: [
      { typeId: 0, id: 'idle' },
      { typeId: 1, id: 'baby_female' },
      { typeId: 2, id: 'baby_male' },
      { typeId: 3, id: 'child_female' },
      { typeId: 4, id: 'child_male' },
      { typeId: 47, id: 'heroine_bow_xena' },
    ],
    buildings: [],
  });
}

/** A fixture-style job table whose adult trade reuses a low age-class numeric id. */
function collidingContent(): ContentSet {
  return parseContentSet({
    manifest: { version: IR_VERSION, generatedFrom: { data: 'synthetic-test-fixture' }, locale: 'eng' },
    goods: [{ typeId: 0, id: 'none' }],
    jobs: [{ typeId: 1, id: 'woodcutter' }],
    buildings: [],
  });
}

const spec = (jobType: number) => ({ jobType, x: 0, y: 0, tribe: VIKING });

describe('createSettler stamps Age on the baby/child job slugs', () => {
  it('a baby and a child both spawn at age 0', () => {
    const world = new World();
    const content = ageClassContent();
    const baby = createSettler(world, content, new Rng(1), spec(2), new PersonalNames(1, [])); // baby_male
    const child = createSettler(world, content, new Rng(1), spec(3), new PersonalNames(1, [])); // child_female
    if (baby === null || child === null) throw new Error('spawn failed');
    expect(world.get(baby, Age)).toEqual({ ticks: 0, asOf: null });
    expect(world.has(baby, Female)).toBe(false);
    // Original behavior: a placed child's age starts at 0 too, so it lives the whole span to adulthood.
    expect(world.get(child, Age)).toEqual({ ticks: 0, asOf: null });
    expect(world.has(child, Female)).toBe(true);
  });

  it('matches by slug, not numeric id - a fixture adult trade on id 1 spawns Age-less', () => {
    const world = new World();
    const adult = createSettler(world, collidingContent(), new Rng(1), spec(1), new PersonalNames(1, [])); // woodcutter
    if (adult === null) throw new Error('spawn failed');
    expect(world.has(adult, Age)).toBe(false);
  });

  it('stamps the female marker on the heroine so her voice and hit reactions use the female pools', () => {
    const world = new World();
    const heroine = createSettler(world, ageClassContent(), new Rng(1), spec(47), new PersonalNames(1, []));
    if (heroine === null) throw new Error('spawn failed');
    expect(world.has(heroine, Female)).toBe(true);
    expect(world.has(heroine, Age)).toBe(false);
  });

  it('a map-spawned girl stays a child until her age reaches adulthood, then becomes a woman', () => {
    const sim = new Simulation({ seed: 1, content: ageClassContent() });
    const girl = createSettler(sim.world, ageClassContent(), new Rng(1), spec(3), new PersonalNames(1, [])); // child_female
    if (girl === null) throw new Error('spawn failed');
    expect(sim.world.get(girl, Settler).jobType).toBe(CHILD_FEMALE);

    sim.run(ADULT_AGE_TICKS - 1); // one short of adulthood: still a child, never demoted to a baby
    expect(sim.world.get(girl, Settler).jobType).toBe(CHILD_FEMALE);

    sim.run(1); // crosses ADULT_AGE_TICKS of lifetime: grown up
    expect(sim.world.get(girl, Settler).jobType).toBe(WOMAN_JOB);
    expect(sim.world.has(girl, Age)).toBe(false);
  });
});
