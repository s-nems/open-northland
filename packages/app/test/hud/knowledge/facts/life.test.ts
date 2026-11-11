import { GoodType } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { createKnowledgeBase } from '../../../../src/hud/knowledge/base.js';
import { factText } from '../../../../src/hud/knowledge/facts/index.js';
import { knowledgeContent } from '../../../support/knowledge-content.js';

const FURNITURE_TYPE = 129;
const PIECE = 1000;

describe('furniture facts', () => {
  it('count the whole children, sleeps and meals one piece pays for', () => {
    const furniture = GoodType.parse({
      typeId: FURNITURE_TYPE,
      id: 'furniture',
      homeQuality: {
        effect: 'lodging',
        deliveryValue: PIECE,
        capacity: 2 * PIECE,
        fetchBelow: PIECE,
        minimumHomeLevel: 0,
        wear: { child: 80, sleep: 8, meal: 300 },
      },
    });
    const content = knowledgeContent();
    const base = createKnowledgeBase({ ...content, goods: [...content.goods, furniture] });
    expect(
      ['home.furnitureChildren', 'home.furnitureSleeps', 'home.furnitureMeals'].map((name) =>
        factText(name, base),
      ),
    ).toEqual(['12', '125', '3']);
    expect(factText('home.furnitureUnits', base)).toBe('2');
  });
});
