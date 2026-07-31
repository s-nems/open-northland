import { describe, expect, it } from 'vitest';
import { contentIndex } from '../../src/core/content-index.js';
import {
  isLivestockWorkplaceType,
  livestockGoodOfTribe,
  livestockTribeOfGood,
} from '../../src/systems/readviews/index.js';
import { BEAR_TRIBE, COW_GOOD, COW_TRIBE, FARM, livestockContent, MEAT, WOOL } from './support.js';

/** The economy fixture's sawmill - a recipe workshop that is NOT a livestock workplace. */
const SAWMILL = 2;
const PLANK = 2;

describe('livestock content join', () => {
  const content = livestockContent();

  it('joins the fed-animal good to its species by slug, both directions', () => {
    expect(livestockTribeOfGood(content, COW_GOOD)).toBe(COW_TRIBE);
    expect(livestockGoodOfTribe(content, COW_TRIBE)).toBe(COW_GOOD);
  });

  it('joins only catchable species - the bear has no fed-animal good', () => {
    expect(livestockGoodOfTribe(content, BEAR_TRIBE)).toBeNull();
    expect(livestockTribeOfGood(content, PLANK)).toBeNull();
  });

  it('classifies the farm (feed recipe present) as a livestock workplace, the sawmill not', () => {
    expect(isLivestockWorkplaceType(content, FARM)).toBe(true);
    expect(isLivestockWorkplaceType(content, SAWMILL)).toBe(false);
  });

  it('drops the input-less slaughter recipe at the livestock workplace, keeps the rest', () => {
    const recipes = contentIndex(content).recipeByProductByBuilding.get(FARM);
    expect(recipes).toBeDefined();
    expect(recipes?.has(COW_GOOD)).toBe(true);
    expect(recipes?.has(WOOL)).toBe(true);
    expect(recipes?.has(MEAT)).toBe(false); // no slaughter - meat arrives as the feed byproduct
    // A non-livestock workshop's recipes are untouched.
    expect(contentIndex(content).recipeByProductByBuilding.get(SAWMILL)?.has(PLANK)).toBe(true);
  });
});
