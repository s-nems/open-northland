export const economyContent = {
  goods: [
    { typeId: 0, id: 'none' },
    // Wood is harvested with atomic 24 (atomicForHarvesting), the join key the planner reads. Its
    // `gathering` carries the tree→trunk felling lifecycle: a node is FELLED over `chopsToFell` chops
    // (yielding nothing onto the back) and drops its whole `yieldPerNode` as a ground trunk. Both are
    // OBSERVED calibration constants (the readable `.ini` has neither — source basis); a spawn
    // site stamps them onto a node as a `Felling` component + the node's `remaining`. `yieldPerNode`
    // 4 keeps the golden slice's per-node wood at 4 (2 trees → 8 harvested), so goods still total 18.
    {
      typeId: 1,
      id: 'wood',
      weight: 1,
      atomics: { harvest: 24 },
      // Only the felling params (the sim reads these); the landscape-stage refs (harvest/pickup/store
      // typeIds) are a render/pipeline join this synthetic fixture doesn't model, so they're omitted.
      gathering: { bioLandscape: true, chopsToFell: 3, yieldPerNode: 4 },
    },
    { typeId: 2, id: 'plank', weight: 1 },
    // An edible good — the eat-drive recognises it by the `food` id prefix (isFood), like the
    // original's food_simple/food_extra; a hungry settler eats it from its carry or a store.
    { typeId: 3, id: 'food_simple', weight: 1 },
    // Stone is a MINED good (atomic 25): its `gathering.depositSize > 0` marks it a deposit chipped one
    // unit at a time — a spawn site stamps a `MineDeposit` from `depositSize`/`depositLevels` and the
    // node's `remaining`, so each harvest drops one ore pile and the deposit shrinks by level until it
    // is removed. `bioLandscape: false` (mined, not living). OBSERVED calibration (source basis).
    {
      typeId: 4,
      id: 'stone',
      weight: 1,
      atomics: { harvest: 25 },
      gathering: { bioLandscape: false, depositSize: 5, depositLevels: 5 },
    },
    // Mushroom is the trivial DIRECT pickup (atomic 32): its harvest IS its pickup (no distinct ore
    // stage, no `depositSize`), so a bare node yields one unit onto the back and is then removed.
    { typeId: 5, id: 'mushroom', weight: 1, atomics: { harvest: 32 }, gathering: { bioLandscape: true } },
    // Wheat is the FIELD-FARMED good (the farm's sow→water→grow→reap loop): the three atomics are the
    // original's own ids (`goodtypes.ini` wheat: plant 34 / cultivate 35 / harvest 29) and `stages` 5
    // is the wheat(growing) landscape's `maximumValency`; the timings/areas are small synthetic values
    // so the loop closes in a short test run (the observed calibration lives in the app content).
    {
      typeId: 6,
      id: 'wheat',
      weight: 1,
      atomics: { harvest: 29, cultivate: 35, plant: 34 },
      farming: {
        stages: 5,
        ticksPerStage: 10,
        yieldPerField: 1,
        fieldRadius: 8,
        // Sublinear crew scaling — the live cap is `fieldsBase + fieldsPerFarmer × crew` (solo 6, pair 10).
        fieldsBase: 2,
        fieldsPerFarmer: 4,
      },
    },
  ],
  jobs: [
    { typeId: 0, id: 'idle' },
    // The woodcutter is permitted the wood harvest atomic (24) — the planner's data-driven gate.
    { typeId: 1, id: 'woodcutter', allowedAtomics: [24] },
    { typeId: 2, id: 'carpenter' },
    // The miner is permitted the stone harvest atomic (25) — it chips a `MineDeposit` deposit.
    { typeId: 5, id: 'miner', allowedAtomics: [25] },
    // A two-trade collector (wood 24 + stone 25) — what the employed-gatherer store-filter tests use
    // (the filter only shows on a job that could harvest MORE than its workplace stores). Nothing in
    // the golden slice spawns it.
    { typeId: 7, id: 'collector', allowedAtomics: [24, 25] },
    // The hunter (job 15 — `JOB_TYPE_HUMAN_HUNTER`) — the trade that strikes `catchable` prey.
    { typeId: 15, id: 'hunter' },
    // The farmer (the original's job 18) is permitted wheat's plant/cultivate/harvest atomics — the
    // data-driven gate the field-farmer drive (planFarmer) keys on.
    { typeId: 18, id: 'farmer', allowedAtomics: [29, 34, 35] },
    // The scout (job 27 — `JOB_TYPE_HUMAN_SCOUT`) is permitted only the build-guide atomic (43), the
    // signpost-erecting swing — mirrors the original's `allowatomic 43`.
    { typeId: 27, id: 'scout', allowedAtomics: [43] },
    // NOTE: 36 predates the pinned soldier band (31..41, stances.ts) — a fixture carrier at 36 is
    // fighter-classified (collision, stance, confinement exemption). Kept because the goldens hash it;
    // 24 is the original's real carrier id (`logicworker 24`) — use it where fighter semantics matter.
    { typeId: 36, id: 'carrier' },
    { typeId: 24, id: 'carrier' },
  ],
  buildings: [
    {
      typeId: 1,
      id: 'headquarters',
      kind: 'headquarters',
      // A transport slot beside the gatherer slots (the original HQ declares `logicworker 24 3`,
      // houses.ini; count 1 here is a fixture simplification — one carrier keeps the golden legible):
      // the JobSystem's report-in pass posts a loose carrier here, and only a POSTED carrier hauls
      // (the planner's store-carrier rung requires the binding).
      workers: [
        { jobType: 1, count: 3 },
        { jobType: 36, count: 1 },
      ],
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
      recipes: [{ inputs: [{ goodType: 1, amount: 1 }], outputs: [{ goodType: 2, amount: 1 }], ticks: 20 }],
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
    {
      // The grain FARM (the original's logictype 12 shape): 4 farmer slots + a wheat-only store
      // (`logicstock 4 25 0` — the single-good, capacity-25 slot) and `produces` wheat with NO recipe
      // — the field loop, not the abstract in-house cycle, makes the wheat. What the farmer drive's
      // `farmWorkGood` keys on: a workplace producing a `farming` good.
      typeId: 5,
      id: 'farm',
      kind: 'workplace',
      workers: [{ jobType: 18, count: 4 }],
      stock: [{ goodType: 6, capacity: 25, initial: 0 }],
      produces: [6],
    },
    {
      // A passive wheat store (a granary) — the OVERFLOW sink the farm-full tests place: with the
      // farm's own 25-slot full, the farmer's reap/carry gate finds this and the delivery rung
      // routes the load here. No test outside farming places it, so every golden is untouched.
      typeId: 6,
      id: 'granary',
      kind: 'storage',
      stock: [{ goodType: 6, capacity: 150, initial: 0 }],
    },
    {
      // A general WAREHOUSE (kind storage) that stocks every fixture good — the delivery SINK the
      // end-to-end felling/mining tests place. A delivery sink must be a TYPED store (Building/Vehicle),
      // never a bare loose pile, so those tests give their store this type. Unplaced by any golden (like
      // the granary above), so adding it leaves every golden untouched.
      typeId: 7,
      id: 'warehouse',
      kind: 'storage',
      stock: [
        { goodType: 1, capacity: 150, initial: 0 },
        { goodType: 2, capacity: 150, initial: 0 },
        { goodType: 3, capacity: 150, initial: 0 },
        { goodType: 4, capacity: 150, initial: 0 },
        { goodType: 5, capacity: 150, initial: 0 },
        { goodType: 6, capacity: 150, initial: 0 },
      ],
    },
    {
      // A MULTI-OPERATOR workshop (the real mill's `logicworker 19 2` + `logicworker 24 1` shape):
      // TWO carpenter operator slots plus a carrier transport slot, same wood→plank recipe as the
      // sawmill. What the parallel-production (one independent batch per operator) and the
      // carrier-supplier-drive tests staff. Nothing in the golden slice places it.
      typeId: 8,
      id: 'twin_mill',
      kind: 'workplace',
      workers: [
        { jobType: 2, count: 2 },
        { jobType: 36, count: 1 },
      ],
      stock: [
        { goodType: 1, capacity: 10, initial: 0 },
        { goodType: 2, capacity: 20, initial: 0 },
      ],
      recipes: [{ inputs: [{ goodType: 1, amount: 1 }], outputs: [{ goodType: 2, amount: 1 }], ticks: 20 }],
    },
    {
      // A TWO-PRODUCT workshop off DIFFERENT inputs — the upgraded bakery's shape (`work_bakery_01`
      // makes bread from flour and candy from honey). What the shelf-blocked promotion tests staff: with
      // the plank slot full and no wheat, one product is blocked on its shelf while the other is merely
      // starved, and only the blocked one's good is worth carrying out. Nothing in the golden places it.
      // typeId 20, not 10: several suites APPEND their own building types to this fixture starting at
      // 10 (building-placement's HUT, utility-self-service's WELL/HIVE/BAKERY/BREWERY), and a duplicate
      // typeId silently shadows one of them in the content index.
      typeId: 20,
      id: 'bakehouse',
      kind: 'workplace',
      workers: [
        { jobType: 2, count: 1 },
        { jobType: 36, count: 1 },
      ],
      stock: [
        { goodType: 1, capacity: 10, initial: 0 },
        { goodType: 2, capacity: 20, initial: 0 },
        { goodType: 3, capacity: 20, initial: 0 },
        { goodType: 6, capacity: 10, initial: 0 },
      ],
      recipes: [
        { inputs: [{ goodType: 1, amount: 1 }], outputs: [{ goodType: 2, amount: 1 }], ticks: 20 },
        { inputs: [{ goodType: 6, amount: 1 }], outputs: [{ goodType: 3, amount: 1 }], ticks: 20 },
      ],
    },
    {
      // A MULTI-PRODUCT workshop (the real smithy-2 shape, shrunk to fixture goods): ONE carpenter
      // operator and two per-product recipes off the same wood input — what the craft-selection /
      // product-rotation tests staff. Nothing in the golden slice places it.
      typeId: 9,
      id: 'forge',
      kind: 'workplace',
      workers: [{ jobType: 2, count: 1 }],
      stock: [
        { goodType: 1, capacity: 20, initial: 0 },
        { goodType: 2, capacity: 20, initial: 0 },
        { goodType: 3, capacity: 20, initial: 0 },
      ],
      recipes: [
        { inputs: [{ goodType: 1, amount: 1 }], outputs: [{ goodType: 2, amount: 1 }], ticks: 20 },
        { inputs: [{ goodType: 1, amount: 1 }], outputs: [{ goodType: 3, amount: 1 }], ticks: 20 },
      ],
    },
  ],
  landscape: [
    // Grass is the one PLANTABLE ground (the original's `biocanplanton` triangle flag — `land` alone
    // carries it); barren is its walk+build twin that rejects the plough (sand/beach/desert stone).
    { typeId: 0, id: 'grass', walkable: true, buildable: true, plantable: true },
    { typeId: 1, id: 'water', walkable: false, buildable: false },
    { typeId: 2, id: 'barren', walkable: true, buildable: true },
  ],
};
