import { expect, it } from 'vitest';
import { sandboxContent } from '../../../../src/game/sandbox/index.js';
import {
  knowsCourse,
  type SchoolGroup,
  schoolChoices,
} from '../../../../src/view/unit-controls/panels/school-dialog.js';

const smith: SchoolGroup = {
  jobType: 13,
  label: 'Kowal',
  courses: [
    { target: 'job', typeId: 13, label: 'Kowal' },
    { target: 'good', typeId: 42, label: 'Długi miecz' },
    { target: 'good', typeId: 35, label: 'Kolczuga' },
    { target: 'good', typeId: 36, label: 'Zbroja płytowa' },
  ],
};

it('uses the sole discovered method directly, without a separate basic-course choice', () => {
  const choices = schoolChoices([smith], (course) => course.target === 'job' || course.typeId === 42);
  expect(choices[0]?.courses).toEqual([{ target: 'good', typeId: 42, label: 'Długi miecz' }]);
});
it('lists every discovered advanced method independently of the pupil profession', () => {
  expect(schoolChoices([smith], () => true)[0]?.courses.map((row) => row.typeId)).toEqual([42, 35, 36]);
  expect(
    schoolChoices([smith], (course) => course.target === 'job')[0]?.courses.map((row) => row.target),
  ).toEqual(['job']);
  expect(schoolChoices([smith], () => false)).toEqual([]);
});
it('treats the pupil trade and its learned courses as known, not other trades or methods', () => {
  const train = (target: 'job' | 'good', targetId: number) => ({
    target,
    targetId,
    requirement: 'train' as const,
    amount: 10,
    experienceTypes: [] as number[],
  });
  const base = sandboxContent();
  const content = {
    ...base,
    tribes: base.tribes.map((tribe) => ({
      ...tribe,
      jobEnables: [{ jobType: 13, kind: 'good' as const, targetId: 13 }],
      jobRequirements: [train('good', 42), train('good', 13)],
    })),
  };
  const learner = {
    id: 1,
    components: {
      Settler: { jobType: 13, tribe: 1 },
      SettlerProgress: { learned: { job: [9], good: [42] } },
    },
  };
  expect(knowsCourse(content, learner, { target: 'job', typeId: 13, label: 'Kowal' })).toBe(true);
  expect(knowsCourse(content, learner, { target: 'job', typeId: 9, label: 'Cieśla' })).toBe(true);
  expect(knowsCourse(content, learner, { target: 'good', typeId: 42, label: 'Długi miecz' })).toBe(true);
  expect(knowsCourse(content, learner, { target: 'job', typeId: 11, label: 'Garncarz' })).toBe(false);
  expect(knowsCourse(content, learner, { target: 'good', typeId: 13, label: 'Kolczuga' })).toBe(false);
});
