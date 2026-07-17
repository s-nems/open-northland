import { type ContentSet, IR_VERSION, parseContentSet } from '@open-northland/data';

/**
 * A synthetic content set for the strategic AI-player tests, using the REAL stable content ids
 * (`headquarters`, `home_level_00`, `work_farm_00`, harvest-good slugs) so the default modules and
 * `DEFAULT_BUILD_ORDER` resolve against it unmodified; entries of the default order that are absent
 * here (pottery, mason, mill, bakery, well) exercise the skip-missing-content path. Numeric ids
 * follow the original's job/good bands where they exist (woman 5, civilist 6, builder 7, collector
 * 8, farmer 18, carrier 24, scout 27).
 */
export function aiContent(): ContentSet {
  return parseContentSet({
    manifest: { version: IR_VERSION, generatedFrom: { game: 'synthetic-test-fixture' }, locale: 'eng' },
    goods: [
      { typeId: 0, id: 'none' },
      {
        typeId: 1,
        id: 'wood',
        weight: 1,
        atomics: { harvest: 24 },
        gathering: { bioLandscape: true, chopsToFell: 3, yieldPerNode: 4 },
      },
      // Clay ("mud") is a trivial direct pickup here — the collector-selection tests only need a
      // distinct harvest atomic per good, not the original's digging lifecycle.
      { typeId: 2, id: 'mud', weight: 1, atomics: { harvest: 32 }, gathering: { bioLandscape: false } },
      { typeId: 3, id: 'food_simple', weight: 1 },
      {
        typeId: 4,
        id: 'stone',
        weight: 1,
        atomics: { harvest: 25 },
        gathering: { bioLandscape: false, depositSize: 5, depositLevels: 5 },
      },
    ],
    jobs: [
      { typeId: 0, id: 'idle' },
      { typeId: 1, id: 'baby_female' },
      { typeId: 2, id: 'baby_male' },
      { typeId: 3, id: 'child_female' },
      { typeId: 4, id: 'child_male' },
      { typeId: 5, id: 'woman' },
      { typeId: 6, id: 'civilist' },
      // The builder: the house-building atomic (39) is what `builderJobOf` resolves on.
      { typeId: 7, id: 'builder', allowedAtomics: [39] },
      // The collector harvests all three collected goods (wood 24, stone 25, mud 32).
      { typeId: 8, id: 'collector', allowedAtomics: [24, 25, 32] },
      { typeId: 18, id: 'farmer', allowedAtomics: [29] },
      { typeId: 24, id: 'carrier' },
      { typeId: 27, id: 'scout', allowedAtomics: [43] },
    ],
    buildings: [
      {
        typeId: 1,
        id: 'headquarters',
        kind: 'storage',
        // A transport band plus the gatherer band — the collector reconciliation must pick the
        // harvest-capable slot (8), never the carrier one (24).
        workers: [
          { jobType: 24, count: 3 },
          { jobType: 8, count: 3 },
        ],
        stock: [
          { goodType: 1, capacity: 150, initial: 0 },
          { goodType: 2, capacity: 150, initial: 0 },
          { goodType: 3, capacity: 150, initial: 0 },
          { goodType: 4, capacity: 150, initial: 0 },
        ],
      },
      {
        typeId: 2,
        id: 'home_level_00',
        kind: 'home',
        homeSize: 2,
        // A real material bill keeps a placed site open (a zero-cost site completes instantly).
        construction: [{ goodType: 1, amount: 2 }],
        stock: [{ goodType: 3, capacity: 5, initial: 0 }],
      },
      {
        typeId: 5,
        id: 'work_farm_00',
        kind: 'workplace',
        // A farmer operator slot beside a carrier transport slot — staffing must fill the operator
        // trade only (one worker per trade), never the carrier.
        workers: [
          { jobType: 18, count: 4 },
          { jobType: 24, count: 1 },
        ],
        construction: [{ goodType: 1, amount: 2 }],
        stock: [{ goodType: 3, capacity: 25, initial: 0 }],
      },
    ],
    landscape: [
      { typeId: 0, id: 'grass', walkable: true, buildable: true, plantable: true },
      { typeId: 1, id: 'water', walkable: false, buildable: false },
    ],
  });
}
