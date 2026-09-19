import { describe, expect, it } from 'vitest';
import { contentIndex } from '../../src/core/content-index.js';
import {
  isLivestockWorkplaceType,
  livestockGoodOfTribe,
  livestockTribeOfGood,
  slayAtomicOfSpecies,
} from '../../src/systems/readviews/index.js';
import {
  BEAR_TRIBE,
  COW_GOOD,
  COW_TRIBE,
  FARM,
  livestockContent,
  MEAT,
  SLAY_ATOMIC,
  WOOL,
} from './support.js';

/** The economy fixture's sawmill - a recipe workshop that is NOT a livestock workplace. */
const SAWMILL = 2;
const PLANK = 2;

describe('livestock content join', () => {
  const content = livestockContent();

  it('joins the species good to its animal tribe by slug, both directions', () => {
    expect(livestockTribeOfGood(content, COW_GOOD)).toBe(COW_TRIBE);
    expect(livestockGoodOfTribe(content, COW_TRIBE)).toBe(COW_GOOD);
  });

  it('joins only catchable species - the bear has no species good', () => {
    expect(livestockGoodOfTribe(content, BEAR_TRIBE)).toBeNull();
    expect(livestockTribeOfGood(content, PLANK)).toBeNull();
  });

  it('classifies the farm (breeding recipe present) as a livestock workplace, the sawmill not', () => {
    expect(isLivestockWorkplaceType(content, FARM)).toBe(true);
    expect(isLivestockWorkplaceType(content, SAWMILL)).toBe(false);
  });

  it('joins a slaughter atomic to its species through the clip name the breeder binds', () => {
    expect(slayAtomicOfSpecies(content, SLAY_ATOMIC)).toBeNull(); // not a species good
    expect(slayAtomicOfSpecies(content, COW_GOOD)).toBe(SLAY_ATOMIC);
    expect(slayAtomicOfSpecies(content, WOOL)).toBeNull();
  });

  it('leaves the farm with its breeding recipe alone - its wares have none of their own', () => {
    const recipes = contentIndex(content).recipeByProductByBuilding.get(FARM);
    expect(recipes).toBeDefined();
    expect(recipes?.has(COW_GOOD)).toBe(true);
    // Wool and meat come off the slaughter clip, so nothing at the farm makes them by recipe.
    expect(recipes?.has(WOOL)).toBe(false);
    expect(recipes?.has(MEAT)).toBe(false);
    // A non-livestock workshop's recipes are untouched.
    expect(contentIndex(content).recipeByProductByBuilding.get(SAWMILL)?.has(PLANK)).toBe(true);
  });
});
