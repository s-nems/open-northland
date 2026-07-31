import { systems } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { hasRealIr, loadContentUnderTest } from './helpers.js';

/** The real `goodtypes.ini` / `animaltypes.ini` / `houses.ini` ids the slug join must land on. */
const CATTLE_TRIBE = 10;
const SHEEP_TRIBE = 19;
const SHEEP_GOOD = 57;
const CATTLE_GOOD = 58;
const MEAT_GOOD = 21;
const ANIMAL_FARM = 17;

/**
 * The husbandry slug join against the REAL extracted content: the fed-animal goods (`sheep` 57 /
 * `cattle` 58) must resolve to their species tribes, the animal farm must classify as the livestock
 * workplace, and the meat byproduct must land on the base `meat` good. Pinned here because the join
 * rides slug equality across two extractor lanes (goods and tribes) - an extractor rename would break
 * husbandry silently while every synthetic fixture stays green.
 */
describe.runIf(hasRealIr())('livestock content join on real content', () => {
  it('joins species, workplace, and the meat byproduct to the real ids', async () => {
    const { real } = await loadContentUnderTest();
    expect(systems.isLivestockWorkplaceType(real, ANIMAL_FARM)).toBe(true);
    expect(systems.livestockTribeOfGood(real, SHEEP_GOOD)).toBe(SHEEP_TRIBE);
    expect(systems.livestockTribeOfGood(real, CATTLE_GOOD)).toBe(CATTLE_TRIBE);
    expect(systems.livestockGoodOfTribe(real, SHEEP_TRIBE)).toBe(SHEEP_GOOD);
    expect(systems.livestockGoodOfTribe(real, CATTLE_TRIBE)).toBe(CATTLE_GOOD);
    expect(systems.livestockMeatGoodOf(real)).toBe(MEAT_GOOD);
  });
});
