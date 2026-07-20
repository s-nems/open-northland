import { describe, expect, it } from 'vitest';
import { hasRealIr, rawIrUnderTest } from './helpers.js';

/** The six goods the sim converts on their way out of the house that cooks them, and the edible each
 *  becomes — the same table `packages/sim/src/systems/readviews/food.ts` applies. */
const EDIBLE_FORM_BY_DISH: Readonly<Record<string, string>> = {
  fruit: 'food_simple',
  bread: 'food_simple',
  candy: 'food_extra',
  meat: 'food_simple',
  fish: 'food_simple',
  sausage: 'food_simple',
};

/** Buildings that must be able to hold the edible forms — the settlement's larders. */
const LARDERS = ['headquarters', 'stock_00', 'stock_01', 'stock_02'];

interface IrGood {
  readonly typeId: number;
  readonly id: string;
}
interface IrBuilding {
  readonly id: string;
  readonly stock?: ReadonlyArray<{ readonly goodType: number; readonly capacity: number }>;
  readonly produces?: readonly number[];
}

/**
 * The DECODED-DATA premise behind the dish→edible conversion (`readviews/food.ts`). The sim's mapping is
 * only correct because the real content has a particular shape: a dish is slotted solely in its own
 * producing house, while `food_simple`/`food_extra` are slotted everywhere and produced by nothing.
 *
 * This suite asserts that shape against the generated IR rather than against a synthetic fixture, because
 * the fixture is what hid the bug in the first place — a test HQ that stocked every good passed happily
 * while the real headquarters had no bread slot at all and the bakery deadlocked in game.
 */
describe.runIf(hasRealIr())('dish goods in the decoded content', () => {
  const ir = rawIrUnderTest() as { goods: IrGood[]; buildings: IrBuilding[] };
  const typeOf = (id: string): number => {
    const good = ir.goods.find((g) => g.id === id);
    if (good === undefined) throw new Error(`good '${id}' missing from the decoded content`);
    return good.typeId;
  };
  const capacityOf = (building: IrBuilding, goodType: number): number =>
    building.stock?.find((s) => s.goodType === goodType)?.capacity ?? 0;

  it('every dish and every edible form it maps to exists', () => {
    for (const [dish, edible] of Object.entries(EDIBLE_FORM_BY_DISH)) {
      expect(() => typeOf(dish)).not.toThrow();
      expect(() => typeOf(edible)).not.toThrow();
    }
  });

  it('a dish is stocked ONLY by the house that produces it', () => {
    for (const dish of Object.keys(EDIBLE_FORM_BY_DISH)) {
      const goodType = typeOf(dish);
      // A slot for the dish is legitimate only in its own kitchen; a second holder anywhere would mean
      // the conversion on pickup strands a good that did have somewhere else to go.
      const holders = ir.buildings.filter((b) => capacityOf(b, goodType) > 0);
      for (const holder of holders) {
        expect(holder.produces ?? [], `'${holder.id}' stocks ${dish} without producing it`).toContain(
          goodType,
        );
      }
    }
  });

  it('the edible forms are stocked by the larders and produced by nobody', () => {
    for (const edible of new Set(Object.values(EDIBLE_FORM_BY_DISH))) {
      const goodType = typeOf(edible);
      for (const larder of LARDERS) {
        const building = ir.buildings.find((b) => b.id === larder);
        if (building === undefined) continue; // a stock tier this content set does not define
        expect(capacityOf(building, goodType), `'${larder}' has no ${edible} slot`).toBeGreaterThan(0);
      }
      // No house makes the edible forms — they exist only as what a dish turns into on the way out.
      // (A workshop may still STOCK one as an input: the coin mint feeds its staff from a food slot.)
      const producers = ir.buildings.filter((b) => (b.produces ?? []).includes(goodType));
      expect(producers.map((b) => b.id)).toEqual([]);
    }
  });
});
