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
/** `jobtypes.ini` breeder `allowatomic 87 88` - the slaughter clip per species. */
const SLAY_SHEEP_ATOMIC = 87;
const SLAY_CATTLE_ATOMIC = 88;

/**
 * The husbandry slug joins against the REAL extracted content: the species goods (`sheep` 57 /
 * `cattle` 58) must resolve to their animal tribes, the animal farm must classify as the livestock
 * workplace and carry those two recipes alone, and each species must find the slaughter clip the
 * breeder binds. Pinned here because the joins ride slug equality across three extractor lanes (goods,
 * tribes, and the `setatomic` clip names) - a rename would break husbandry silently while every
 * synthetic fixture stays green.
 */
describe.runIf(hasRealIr())('livestock content join on real content', () => {
  it('joins species, workplace, and the meat byproduct to the real ids', async () => {
    const { real } = await loadContentUnderTest();
    expect(systems.isLivestockWorkplaceType(real, ANIMAL_FARM)).toBe(true);
    expect(systems.livestockTribeOfGood(real, SHEEP_GOOD)).toBe(SHEEP_TRIBE);
    expect(systems.livestockTribeOfGood(real, CATTLE_GOOD)).toBe(CATTLE_TRIBE);
    expect(systems.livestockGoodOfTribe(real, SHEEP_TRIBE)).toBe(SHEEP_GOOD);
    expect(systems.livestockGoodOfTribe(real, CATTLE_TRIBE)).toBe(CATTLE_GOOD);
    expect(systems.slayAtomicOfSpecies(real, SHEEP_GOOD)).toBe(SLAY_SHEEP_ATOMIC);
    expect(systems.slayAtomicOfSpecies(real, CATTLE_GOOD)).toBe(SLAY_CATTLE_ATOMIC);
  });

  it('leaves the animal farm breeding its two species and nothing else', async () => {
    const { real } = await loadContentUnderTest();
    const farm = real.buildings.find((b) => b.typeId === ANIMAL_FARM);
    expect(farm?.recipes.map((r) => r.outputs[0]?.goodType)).toEqual([SHEEP_GOOD, CATTLE_GOOD]);
    // Its wool, leather and meat stay on the produces list: they arrive through the slaughter clip.
    expect(farm?.produces).toContain(MEAT_GOOD);
  });
});
