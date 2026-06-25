import { type ContentSet, IR_VERSION, parseContentSet } from '@vinland/data';

/**
 * A tiny, HAND-AUTHORED synthetic content set for tests. It contains NO copyrighted game data —
 * just enough goods/jobs/buildings to exercise the sim deterministically. Real content is
 * generated from an owned game copy into content/ (gitignored), so it can't be a committed test
 * fixture; this synthetic set is what keeps golden/scenario tests reproducible across machines.
 *
 * Keep it small and stable. When the schema grows, update here in lockstep.
 */
export function testContent(): ContentSet {
  return parseContentSet({
    manifest: { version: IR_VERSION, generatedFrom: { game: 'synthetic-test-fixture' }, locale: 'eng' },
    goods: [
      { typeId: 0, id: 'none' },
      // Wood is harvested with atomic 24 (atomicForHarvesting), the join key the planner reads.
      { typeId: 1, id: 'wood', weight: 1, atomics: { harvest: 24 } },
      { typeId: 2, id: 'plank', weight: 1 },
      // An edible good — the eat-drive recognises it by the `food` id prefix (isFood), like the
      // original's food_simple/food_extra; a hungry settler eats it from its carry or a store.
      { typeId: 3, id: 'food_simple', weight: 1 },
    ],
    jobs: [
      { typeId: 0, id: 'idle' },
      // The woodcutter is permitted the wood harvest atomic (24) — the planner's data-driven gate.
      { typeId: 1, id: 'woodcutter', allowedAtomics: [24] },
      { typeId: 2, id: 'carpenter' },
      { typeId: 36, id: 'carrier' },
    ],
    buildings: [
      {
        typeId: 1,
        id: 'headquarters',
        kind: 'headquarters',
        workers: [{ jobType: 1, count: 3 }],
        stock: [
          { goodType: 1, capacity: 150, initial: 10 },
          { goodType: 2, capacity: 150, initial: 0 },
          // A food slot so the HQ can act as the settlement larder a hungry settler eats from.
          { goodType: 3, capacity: 150, initial: 0 },
        ],
      },
      {
        typeId: 2,
        id: 'sawmill',
        kind: 'workplace',
        workers: [{ jobType: 2, count: 1 }],
        stock: [
          { goodType: 1, capacity: 20, initial: 0 },
          { goodType: 2, capacity: 20, initial: 0 },
        ],
        recipe: { inputs: [{ goodType: 1, amount: 1 }], outputs: [{ goodType: 2, amount: 1 }], ticks: 20 },
      },
    ],
    landscape: [
      { typeId: 0, id: 'grass', walkable: true, buildable: true },
      { typeId: 1, id: 'water', walkable: false, buildable: false },
    ],
    tribes: [
      {
        typeId: 1,
        id: 'viking',
        // The woodcutter (job 1) plays "viking_chop" for the harvest atomic (24); the planner
        // resolves its duration through this binding -> atomicAnimations length below. The eat atomic
        // (10, the original's eat-slot id) binds to "viking_eat" for every job (the woodcutter's row
        // is enough for the slice — a settler eats with the eat atomic regardless of trade).
        atomicBindings: [
          { jobType: 1, atomicId: 24, animation: 'viking_chop' },
          { jobType: 1, atomicId: 10, animation: 'viking_eat' },
        ],
      },
    ],
    atomicAnimations: [
      { id: 'viking_chop', name: 'viking_chop', length: 3 },
      { id: 'viking_eat', name: 'viking_eat', length: 5 },
    ],
  });
}
