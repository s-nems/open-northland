import { expect, it } from 'vitest';
import { kickVotesNeeded } from '../src/index.js';

it.each([
  [1, 1],
  [2, 2],
  [3, 2],
  [4, 3],
  [5, 3],
  [11, 6],
])('needs a strict majority of %i other connected members: %i', (others, needed) => {
  expect(kickVotesNeeded(others)).toBe(needed);
});

it('needs one yes, which nobody can cast, with nobody else connected', () => {
  expect(kickVotesNeeded(0)).toBe(1);
});
