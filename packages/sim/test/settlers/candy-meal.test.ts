import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { Carrying, CurrentAtomic } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { type Fixed, fx, ONE, Simulation } from '../../src/index.js';
import { ATOMIC_EVENT_CHANNEL, needBar, plannerSystem } from '../../src/systems/index.js';
import {
  EAT_ATOMIC_ID,
  EAT_CANDY_ATOMIC_ID,
  mealAtomicId,
} from '../../src/systems/settlers/atomics/start.js';
import { testContent } from '../fixtures/content.js';
import { needsOf } from '../fixtures/settler.js';
import { ctxOf, grassMap, justAbove, NEED_DRIVE_THRESHOLD, needsSettlerAt } from './needs/support.js';

/**
 * The candy eat slot: a meal of food_extra or candy plays atomic 11 for a job that allows it, and every
 * other meal, or a job that forbids the slot, plays the plain atomic 10.
 */

const VIKING = 1;
const FOOD_SIMPLE = 3;
const FOOD_EXTRA = 40;
const CANDY = 41;
const CIVILIST = 6;
/** A soldier body: the civilist's atomics minus the candy slot, as every soldier in `jobtypes.ini`. */
const SOLDIER = 31;
const CANDY_CLIP = 'viking_eat_candy';
const CANDY_CLIP_TICKS = 7;
const CANDY_FOOD_UNITS = 6000;
const CANDY_COMPANY_UNITS = 4000;
/** The fixture plain meal's single payout (`viking_eat`, `event 3 2 +4000`). */
const PLAIN_FOOD_UNITS = 4000;
const HUNGRY: Fixed = justAbove(NEED_DRIVE_THRESHOLD);
const LONELY: Fixed = fx.div(ONE, fx.fromInt(2));

function candyContent(): ContentSet {
  const base = testContent();
  return parseContentSet({
    ...base,
    goods: [
      ...base.goods,
      { typeId: FOOD_EXTRA, id: 'food_extra', weight: 1 },
      { typeId: CANDY, id: 'candy', weight: 1 },
    ],
    jobs: base.jobs.map((job) => {
      if (job.typeId === CIVILIST) return { ...job, allowedAtomics: [EAT_ATOMIC_ID, EAT_CANDY_ATOMIC_ID] };
      if (job.typeId === SOLDIER)
        return { ...job, baseJob: CIVILIST, forbiddenAtomics: [EAT_CANDY_ATOMIC_ID] };
      return job;
    }),
    tribes: base.tribes.map((tribe) =>
      tribe.typeId !== VIKING
        ? tribe
        : {
            ...tribe,
            atomicBindings: [
              ...tribe.atomicBindings,
              { jobType: CIVILIST, atomicId: EAT_CANDY_ATOMIC_ID, animation: CANDY_CLIP },
            ],
          },
    ),
    atomicAnimations: [
      ...base.atomicAnimations,
      {
        id: CANDY_CLIP,
        name: CANDY_CLIP,
        length: CANDY_CLIP_TICKS,
        events: [
          { at: 3, type: ATOMIC_EVENT_CHANNEL.HUNGER, value: CANDY_FOOD_UNITS },
          { at: 4, type: ATOMIC_EVENT_CHANNEL.LEISURE, value: CANDY_COMPANY_UNITS },
        ],
      },
    ],
  });
}

function hungryCarrying(sim: Simulation, jobType: number, goodType: number): Entity {
  const e = needsSettlerAt(sim, 2, 0, { hunger: HUNGRY, enjoyment: LONELY }, jobType);
  sim.world.add(e, Carrying, { goodType, amount: 1 });
  return e;
}

describe('the candy eat slot', () => {
  it('feeds a civilian its food_extra on the candy clip, which pays the bigger meal and some company', () => {
    const sim = new Simulation({ seed: 1, content: candyContent(), map: grassMap(5, 1) });
    const settler = hungryCarrying(sim, CIVILIST, FOOD_EXTRA);

    plannerSystem(sim.world, ctxOf(sim));

    const atomic = sim.world.get(settler, CurrentAtomic);
    expect(atomic.atomicId).toBe(EAT_CANDY_ATOMIC_ID);
    expect(atomic.duration).toBe(CANDY_CLIP_TICKS);
    expect(atomic.effect).toEqual({ kind: 'eat', goodType: FOOD_EXTRA, from: null });

    for (let i = 0; i < CANDY_CLIP_TICKS; i++) sim.step();

    const after = needsOf(sim, settler);
    expect(after.hunger).toBeLessThan(fx.sub(HUNGRY, needBar(PLAIN_FOOD_UNITS)));
    expect(after.enjoyment).toBeLessThan(LONELY);
    expect(sim.world.has(settler, Carrying)).toBe(false); // the one unit it carried is eaten
  });

  it('feeds a soldier the same food_extra on the plain clip, his job forbidding the candy slot', () => {
    const sim = new Simulation({ seed: 1, content: candyContent(), map: grassMap(5, 1) });
    const settler = hungryCarrying(sim, SOLDIER, FOOD_EXTRA);

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(settler, CurrentAtomic).atomicId).toBe(EAT_ATOMIC_ID);
  });

  it('plays the plain clip for any other food', () => {
    const sim = new Simulation({ seed: 1, content: candyContent(), map: grassMap(5, 1) });
    const settler = hungryCarrying(sim, CIVILIST, FOOD_SIMPLE);

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(settler, CurrentAtomic).atomicId).toBe(EAT_ATOMIC_ID);
  });

  it('counts the candy dish as a candy meal, and needs a candy clip the eater resolves', () => {
    const content = candyContent();
    expect(mealAtomicId(content, { tribe: VIKING, jobType: CIVILIST }, CANDY)).toBe(EAT_CANDY_ATOMIC_ID);
    const unbound = parseContentSet({
      ...content,
      tribes: content.tribes.map((tribe) => ({
        ...tribe,
        atomicBindings: tribe.atomicBindings.filter((b) => b.atomicId !== EAT_CANDY_ATOMIC_ID),
      })),
    });
    expect(mealAtomicId(unbound, { tribe: VIKING, jobType: CIVILIST }, FOOD_EXTRA)).toBe(EAT_ATOMIC_ID);
  });
});
