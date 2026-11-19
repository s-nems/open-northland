import { parseContentSet } from '@open-northland/data';
import { expect, it } from 'vitest';
import { knowsCourse, schoolCoursePoints, schoolLessonTicks } from '../../../src/systems/orders/education.js';
import { EXERCISE_ATOMIC_ID } from '../../../src/systems/settlers/atomics/start.js';
import { testContent } from '../../fixtures/content.js';

const TRIBE = 1;
const CIVILIST = 6;
const WOODCUTTER = 1;
const CARPENTER = 2;
const PLANK = 2;
const SHIP = 9;
const TRADE_POINTS = 10;
const SHIP_POINTS = 30;
const GET_TRAINING = 29;
const CLIP_TICKS = 28;
const TRAINING_EXPERIENCE_TYPE = 77;

function content() {
  const base = testContent();
  return parseContentSet({
    ...base,
    atomicAnimations: [
      ...base.atomicAnimations,
      {
        id: 'exercise',
        name: 'exercise',
        length: CLIP_TICKS,
        events: [{ at: 22, type: GET_TRAINING, value: 1 }],
      },
    ],
    tribes: base.tribes.map((t) => ({
      ...t,
      atomicBindings: [
        ...t.atomicBindings,
        { jobType: CIVILIST, atomicId: EXERCISE_ATOMIC_ID, animation: 'exercise' },
      ],
      jobEnables: [
        { jobType: CARPENTER, kind: 'good', targetId: PLANK },
        { jobType: CARPENTER, kind: 'good', targetId: SHIP },
        { jobType: WOODCUTTER, kind: 'good', targetId: PLANK + 1 },
      ],
      jobRequirements: [
        {
          target: 'job',
          targetId: CARPENTER,
          requirement: 'train',
          amount: TRADE_POINTS,
          experienceTypes: [TRAINING_EXPERIENCE_TYPE],
        },
        {
          target: 'good',
          targetId: SHIP,
          requirement: 'train',
          amount: SHIP_POINTS,
          experienceTypes: [TRAINING_EXPERIENCE_TYPE],
        },
      ],
    })),
  });
}

it('charges a course its trade and its good, whether or not the pupil holds the trade', () => {
  const c = content();
  expect(schoolCoursePoints(c, TRIBE, 'job', CARPENTER, null)).toBe(TRADE_POINTS);
  expect(schoolCoursePoints(c, TRIBE, 'good', PLANK, null)).toBe(TRADE_POINTS);
  expect(schoolCoursePoints(c, TRIBE, 'good', SHIP, null)).toBe(TRADE_POINTS + SHIP_POINTS);
  expect(schoolCoursePoints(c, TRIBE, 'good', SHIP, CARPENTER)).toBe(TRADE_POINTS + SHIP_POINTS);
});

it('holds no course in a good of a trade the school does not teach', () => {
  expect(schoolCoursePoints(content(), TRIBE, 'good', PLANK + 1, null)).toBeUndefined();
});

it('ends a course on the repetition after its points are earned', () => {
  const pupil = { tribe: TRIBE, jobType: CIVILIST };
  expect(schoolLessonTicks(content(), pupil, TRADE_POINTS)).toBe((TRADE_POINTS + 1) * CLIP_TICKS);
  expect(schoolLessonTicks(content(), pupil, 0)).toBe(CLIP_TICKS);
});

it('counts a good without a lesson as known with its trade, and a taught good only once learned', () => {
  const c = content();
  const carpenter = { jobType: CARPENTER, learned: { job: [], good: [] } };
  expect(knowsCourse(c, TRIBE, carpenter, 'good', PLANK)).toBe(true);
  expect(knowsCourse(c, TRIBE, carpenter, 'good', SHIP)).toBe(false);
  expect(knowsCourse(c, TRIBE, { jobType: WOODCUTTER, learned: { job: [], good: [] } }, 'good', PLANK)).toBe(
    false,
  );
  expect(
    knowsCourse(c, TRIBE, { jobType: CARPENTER, learned: { job: [], good: [SHIP] } }, 'good', SHIP),
  ).toBe(true);
});
