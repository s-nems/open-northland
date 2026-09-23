import { expect, it } from 'vitest';
import { choiceMatches } from '../src/hud/dom/choice-window.js';
import { type SchoolGroup, schoolChoices } from '../src/view/unit-controls/school-dialog.js';

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
it('searches the start of the label with case and accent folding', () => {
  expect(choiceMatches('Cieśla', 'c')).toBe(true);
  expect(choiceMatches('Kupiec', 'c')).toBe(false);
  expect(choiceMatches('Złoto', 'zlo')).toBe(true);
  expect(choiceMatches('Żelazo', 'ZE')).toBe(true);
});

it('keeps only visible professions and orders each group by its label', async () => {
  const { professionChoices } = await import('../src/view/unit-controls/action-ring/profession-picker.js');
  const choices = professionChoices(
    [
      { kind: 'profession', jobType: 6, label: 'Cywil' },
      { kind: 'header', label: 'Rzemiosło' },
      { kind: 'profession', jobType: 13, label: 'Kowal' },
      { kind: 'profession', jobType: 9, label: 'Cieśla' },
      { kind: 'profession', jobType: 11, label: 'Garncarz' },
    ],
    (job) => job !== 11,
    (job) => job !== 13,
    () => 'Wymagana nauka',
  );
  const rows = choices.flatMap((group) => group.rows);
  expect(rows.map((row) => row.label)).toEqual(['Cieśla', 'Cywil', 'Kowal']);
  expect(rows.find((row) => row.key === '13')?.reason).toBe('Wymagana nauka');
});
