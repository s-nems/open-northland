import { parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { colonySeats } from '../../../../src/systems/computer-player/colony/posts.js';
import { aiContent } from '../../../fixtures/ai-content.js';
import { aiSim, BAKER, CARRIER, COLLECTOR, ctxOf, FARMER, MILLER } from '../support.js';

const GOLD = 90;
const COIN = 91;
const MINT_TYPE = 90;
const COIN_MAKER = 90;
const WOOD = 1;
const IRON = 5;
/** Seats past one a workshop offers its gatherers. */
const GATHERER_SLOTS = 2;

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

/** {@link aiContent} with a mint taking `input` and wood, gathered by its own collectors. */
function mintContent(input: number) {
  const base = aiContent();
  return parseContentSet({
    ...base,
    goods: [
      ...base.goods,
      { typeId: GOLD, id: 'gold', weight: 1, gathering: { bioLandscape: false } },
      { typeId: COIN, id: 'coin', weight: 1 },
    ],
    jobs: [...base.jobs, { typeId: COIN_MAKER, id: 'coin_maker' }],
    buildings: [
      ...base.buildings,
      {
        typeId: MINT_TYPE,
        id: 'work_coin_mint',
        kind: 'workplace',
        workers: [
          { jobType: COIN_MAKER, count: 1 },
          { jobType: COLLECTOR, count: GATHERER_SLOTS },
        ],
        recipes: [
          {
            inputs: [
              { goodType: WOOD, amount: 1 },
              { goodType: input, amount: 1 },
            ],
            outputs: [{ goodType: COIN, amount: 1 }],
            ticks: 180,
          },
        ],
      },
    ],
  });
}

describe('a colony workshop gatherer', () => {
  const gatherers = (input: number): number => {
    const content = mintContent(input);
    const type = content.buildings.find((b) => b.typeId === MINT_TYPE);
    if (type === undefined) throw new Error('setup: no mint');
    const seats = colonySeats({ ...ctxOf(aiSim(1, content)), content }, type);
    return seats.find((seat) => seat.jobType === COLLECTOR)?.count ?? 0;
  };

  it('works for a good no digger of the colony digs, as gold, and leaves the diggers theirs', () => {
    expect(gatherers(GOLD)).toBe(1);
    expect(gatherers(IRON)).toBe(0);
  });
});
