import { describe, expect, it } from 'vitest';
import { colonySeats } from '../../../../src/systems/computer-player/colony/posts.js';
import { aiContent } from '../../../fixtures/ai-content.js';
import { aiSim, BAKER, CARRIER, ctxOf, FARMER, MILLER } from '../support.js';

const seatsOf = (id: string): readonly { readonly jobType: number; readonly count: number }[] => {
  const content = aiContent();
  const type = content.buildings.find((b) => b.id === id);
  if (type === undefined) throw new Error(`setup: no ${id}`);
  return colonySeats(ctxOf(aiSim(1, content)), type);
};

describe('a colony workshop crew', () => {
  it('takes two farmers, one miller, one baker and the bakery porter, as home runs them', () => {
    expect(seatsOf('work_farm_00')).toEqual([{ jobType: FARMER, count: 2 }]);
    expect(seatsOf('work_mill_00')).toEqual([{ jobType: MILLER, count: 1 }]);
    expect(seatsOf('work_bakery_00')).toEqual([
      { jobType: BAKER, count: 1 },
      { jobType: CARRIER, count: 1 },
    ]);
    expect(seatsOf('work_well_00')).toEqual([]);
  });
});
