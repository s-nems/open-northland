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
      {
        // The "work temple" (original logictype 37, logicmaintype 3): a `workplace` kind with NO
        // workers, NO stock, NO recipe — the structural signature isTemple() recognises as the pray
        // satisfier site. A devout settler walks here and runs the pray atomic to reset its piety.
        typeId: 3,
        id: 'temple',
        kind: 'workplace',
      },
      {
        // A tech-gated workplace: the viking tribe's `jobEnablesHouse` edge below locks it behind the
        // carpenter job (2), so it can only be placed once a carpenter settler exists in the tribe.
        // Nothing in the vertical slice / golden places this, so the placement gate leaves them alone.
        typeId: 4,
        id: 'smithy',
        kind: 'workplace',
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
        // is enough for the slice — a settler eats with the eat atomic regardless of trade). The
        // sleep atomic (8, the original's sleep-slot id) binds to "viking_sleep" the same way.
        atomicBindings: [
          { jobType: 1, atomicId: 24, animation: 'viking_chop' },
          { jobType: 1, atomicId: 10, animation: 'viking_eat' },
          { jobType: 1, atomicId: 8, animation: 'viking_sleep' },
          // The pray atomic (12, the original's pray-slot id) binds to "viking_pray" — the planner
          // resolves its duration through this binding -> atomicAnimations length below.
          { jobType: 1, atomicId: 12, animation: 'viking_pray' },
        ],
        // Tech-graph edges. (1) the carpenter (job 2) unlocks the smithy (house 4): the placement gate
        // (buildingEnabled) reads this — the smithy can only be placed once a carpenter settler exists.
        // (2) the WOODCUTTER (job 1) unlocks producing PLANK (good 2): the production gate (goodEnabled)
        // reads this — a sawmill can't make planks until a woodcutter is alive in the tribe, even when
        // its own carpenter operator is present. The HQ/sawmill (houses 1/2) carry no house edge so
        // they stay ungated for placement; the slice always has a woodcutter so the golden is unaffected.
        jobEnables: [
          { jobType: 2, kind: 'house', targetId: 4 },
          { jobType: 1, kind: 'good', targetId: 2 },
        ],
      },
    ],
    atomicAnimations: [
      { id: 'viking_chop', name: 'viking_chop', length: 3 },
      { id: 'viking_eat', name: 'viking_eat', length: 5 },
      { id: 'viking_sleep', name: 'viking_sleep', length: 6 },
      { id: 'viking_pray', name: 'viking_pray', length: 7 },
    ],
    // Experience tracks (humanjobexperiencetypes): the woodcutter (job 1) has a wood-specific track
    // (good 1, the narrow `(job, good)` specialization) and a general track (no good) — so the
    // ProgressionSystem prefers the wood track when chopping wood and the general one otherwise.
    jobExperience: [
      {
        typeId: 1,
        id: 'woodcutter_wood',
        name: 'woodcutter wood',
        jobType: 1,
        goodType: 1,
        experienceFactor: 10,
      },
      { typeId: 2, id: 'woodcutter_general', name: 'woodcutter general', jobType: 1, experienceFactor: 1 },
    ],
  });
}
