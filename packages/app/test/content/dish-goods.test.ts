import { systems } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { sandboxContent } from '../../src/game/sandbox/content/index.js';
import { hasRealIr, rawIrUnderTest } from './helpers.js';

const { EDIBLE_FORM_BY_DISH } = systems;

/** Buildings that must be able to hold the edible forms - the settlement's larders. */
const LARDERS = ['headquarters', 'stock_00', 'stock_01', 'stock_02'];

interface IrGood {
  readonly typeId: number;
  readonly id: string;
}
interface IrBuilding {
  readonly id: string;
  readonly stock?: ReadonlyArray<{ readonly goodType: number; readonly capacity: number }>;
  readonly produces?: readonly number[];
  readonly recipes?: ReadonlyArray<{ readonly inputs: ReadonlyArray<{ readonly goodType: number }> }>;
}
interface Ir {
  readonly goods: readonly IrGood[];
  readonly buildings: readonly IrBuilding[];
}

/**
 * The DECODED-DATA premise behind the dish→edible conversion (`readviews/food.ts`). The sim's mapping is
 * only correct because the real content has a particular shape: a dish is slotted solely in its own
 * producing house, while `food_simple`/`food_extra` are slotted everywhere and produced by nothing.
 *
 * This suite asserts that shape against the generated IR rather than against a synthetic fixture, because
 * the fixture is what hid the bug in the first place - a test HQ that stocked every good passed happily
 * while the real headquarters had no bread slot at all and the bakery deadlocked in game.
 */
describe.runIf(hasRealIr())('dish goods in the decoded content', () => {
  // Read inside the tests, never at collection: the describe body runs even when `runIf` skips the
  // suite, and an eager read would ENOENT on a checkout without generated content.
  const irUnderTest = (): Ir => rawIrUnderTest() as Ir;
  const typeOf = (id: string): number => {
    const good = irUnderTest().goods.find((g) => g.id === id);
    if (good === undefined) throw new Error(`good '${id}' missing from the decoded content`);
    return good.typeId;
  };
  const capacityOf = (building: IrBuilding, goodType: number): number =>
    building.stock?.find((s) => s.goodType === goodType)?.capacity ?? 0;

  it('every dish and every edible form it maps to exists', () => {
    for (const [dish, edible] of EDIBLE_FORM_BY_DISH) {
      expect(() => typeOf(dish)).not.toThrow();
      expect(() => typeOf(edible)).not.toThrow();
    }
  });

  it('no recipe takes a dish as an input', () => {
    const ir = irUnderTest();
    // The conversion on pickup is unconditional, so a house that CONSUMED a dish would have its
    // craftsman fetch bread and arrive holding food_simple - a fetch that can never be delivered.
    // `goodtypes.ini` does name meat as sausage's production input, so this is not hypothetical; it is
    // inert only because no house declares that recipe.
    for (const dish of EDIBLE_FORM_BY_DISH.keys()) {
      const goodType = typeOf(dish);
      for (const building of ir.buildings) {
        for (const recipe of building.recipes ?? []) {
          const consumes = recipe.inputs.some((i) => i.goodType === goodType);
          expect(consumes, `'${building.id}' consumes ${dish} as a recipe input`).toBe(false);
        }
      }
    }
  });

  it('a dish is stocked ONLY by the house that produces it', () => {
    const ir = irUnderTest();
    for (const dish of EDIBLE_FORM_BY_DISH.keys()) {
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
    const ir = irUnderTest();
    for (const edible of new Set(EDIBLE_FORM_BY_DISH.values())) {
      const goodType = typeOf(edible);
      for (const larder of LARDERS) {
        const building = ir.buildings.find((b) => b.id === larder);
        if (building === undefined) continue; // a stock tier this content set does not define
        expect(capacityOf(building, goodType), `'${larder}' has no ${edible} slot`).toBeGreaterThan(0);
      }
      // No house makes the edible forms - they exist only as what a dish turns into on the way out.
      // (A workshop may still STOCK one as an input: the coin mint feeds its staff from a food slot.)
      const producers = ir.buildings.filter((b) => (b.produces ?? []).includes(goodType));
      expect(producers.map((b) => b.id)).toEqual([]);
    }
  });
});

/**
 * The same shape over the SANDBOX catalog, which authors its own general store set
 * (`sandbox/building-set.ts`) instead of reading `houses.ini`, so the suite above cannot cover it. A
 * larder slot for meat catches the HUNTER's kill - his is the one trade whose lift keeps meat raw.
 */
describe('dish goods in the sandbox catalog', () => {
  // Resolved inside each test, never at collection: a throw here would fail the whole file, taking the
  // real-IR suite above with it.
  const typeOf = (id: string): number => {
    const good = sandboxContent().goods.find((g) => g.id === id);
    if (good === undefined) throw new Error(`good '${id}' missing from the sandbox catalog`);
    return good.typeId;
  };
  const capacityIn = (buildingId: string, goodType: number): number => {
    const building = sandboxContent().buildings.find((b) => b.id === buildingId);
    if (building === undefined) throw new Error(`building '${buildingId}' missing from the sandbox catalog`);
    return building.stock.find((s) => s.goodType === goodType)?.capacity ?? 0;
  };

  it('no larder slots meat or bread - each stays in the house that makes it', () => {
    for (const [dish, house] of [
      ['meat', 'work_animal_farm'],
      ['bread', 'work_bakery_00'],
    ] as const) {
      const goodType = typeOf(dish);
      expect(capacityIn(house, goodType), `'${house}' lost its ${dish} slot`).toBeGreaterThan(0);
      for (const larder of LARDERS) {
        expect(capacityIn(larder, goodType), `'${larder}' still slots ${dish}`).toBe(0);
      }
    }
  });

  // Candy's slot is display-only for now: nothing in the sandbox bakes it, and no trade harvests it, so
  // `carriedGoodForm` would convert any unit to `food_extra` before it reached a store. Pinned because
  // keeping it a ware of its own is a decision, not an oversight.
  it('every larder slots the edible forms, and candy stays a stocked ware', () => {
    for (const good of ['food_simple', 'food_extra', 'candy']) {
      const goodType = typeOf(good);
      for (const larder of LARDERS) {
        expect(capacityIn(larder, goodType), `'${larder}' has no ${good} slot`).toBeGreaterThan(0);
      }
    }
  });
});
