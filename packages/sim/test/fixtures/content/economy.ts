export const economyContent = {
  goods: [
    { typeId: 0, id: 'none' },
    // Wood is harvested with atomic 24 (atomicForHarvesting), the join key the planner reads. Its
    // `gathering` carries the tree→trunk felling lifecycle: a node is FELLED over the woodcutter's
    // per-unit strokes (yielding nothing onto the back) and drops its whole `yieldPerNode` as a ground
    // trunk. `yieldPerNode` is OBSERVED calibration (the readable `.ini` lacks it - source basis); a
    // spawn site stamps it onto a node as the node's `remaining` beside a `Felling` marker. 4 keeps the
    // golden slice's per-node wood at 4 (2 trees → 8 harvested), so goods still total 18.
    {
      typeId: 1,
      id: 'wood',
      weight: 1,
      atomics: { harvest: 24 },
      // Only the felling yield; the landscape-stage refs (harvest/pickup/store typeIds) are a
      // render/pipeline join this synthetic fixture doesn't model, so they're omitted.
      gathering: { bioLandscape: true, yieldPerNode: 4 },
    },
    { typeId: 2, id: 'plank', weight: 1 },
    // An edible good - the eat-drive recognises it by the `food` id prefix (isFood), like the
    // original's food_simple/food_extra; a hungry settler eats it from its carry or a store.
    { typeId: 3, id: 'food_simple', weight: 1 },
    // Stone is a MINED good (atomic 25): its `gathering.depositSize > 0` marks it a deposit chipped one
    // unit at a time - a spawn site stamps a `MineDeposit` from `depositSize`/`depositLevels` and the
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
        yieldPerField: 1,
        fieldRadius: 8,
        // A flat per-farm plot - the cap does not move with crew size.
        maxFields: 6,
      },
    },
    // A DISH (`readviews/food.ts`): stocked only in the kitchen that makes it - it becomes
    // `food_simple` the moment a carrier lifts it out, exactly like the original's bread, and counts
    // as food only on that kitchen's own shelf. Nothing in the golden slice produces it.
    // `atomicForProduction` on the kitchen's ware, so the craft-clip tests have a product whose making
    // is an atomic. The golden slice's own goods deliberately declare none, so its trace stays put.
    { typeId: 7, id: 'bread', weight: 1, atomics: { produce: 47 } },
    // Two equippables for the equip-errand tests: a WEARING boots good and a permanent weapon good
    // (the two `equip.wears` shapes the slot mechanics distinguish). Effect/wear numbers mirror the
    // app catalog's balance (goods.ts EQUIP_GOODS) so the effect tests exercise the shipped shapes.
    {
      typeId: 8,
      id: 'shoes',
      weight: 1,
      equip: { category: 'boots', wears: true, uses: 10000 },
    },
    { typeId: 9, id: 'sword', weight: 1, equip: { category: 'weapon' } },
    // A second boots good, so a swap test can order different gear into an occupied slot (rated like
    // shoes - the errand's walk must not break it; breakage tests stamp `degreeOfUse` near ONE).
    {
      typeId: 10,
      id: 'fur_boots',
      weight: 1,
      equip: { category: 'boots', wears: true, uses: 10000 },
    },
    // The equipment-effects goods: tools (additive production credit) and the draughts (auto-drunk).
    {
      typeId: 11,
      id: 'tool_wooden',
      weight: 1,
      equip: { category: 'tool', wears: true, productionBonusPct: 20, workFactorPct: 125, uses: 100 },
    },
    {
      typeId: 12,
      id: 'tool_iron',
      weight: 1,
      equip: { category: 'tool', wears: true, productionBonusPct: 70, workFactorPct: 175, uses: 100 },
    },
    {
      typeId: 13,
      id: 'mead',
      weight: 1,
      equip: { category: 'misc', wears: true, uses: 2, restorePct: { hunger: 50, fatigue: 50 } },
    },
    {
      typeId: 14,
      id: 'potion_food_small',
      weight: 1,
      equip: { category: 'misc', wears: true, uses: 2, restorePct: { hunger: 100 } },
    },
    {
      typeId: 15,
      id: 'potion_stamina_small',
      weight: 1,
      equip: { category: 'misc', wears: true, uses: 2, restorePct: { fatigue: 100 } },
    },
    {
      typeId: 16,
      id: 'potion_heal_small',
      weight: 1,
      equip: { category: 'misc', wears: true, uses: 2, restorePct: { healthMax: 40 } },
    },
    // A second permanent weapon good: the fresh-swap shape - walking wears boots, so only a
    // non-wearing good still stows after the walk to its replacement.
    { typeId: 17, id: 'long_sword', weight: 1, equip: { category: 'weapon' } },
    // The armor slot's good - permanent like the swords; nothing places it either.
    { typeId: 18, id: 'mail', weight: 1, equip: { category: 'armor' } },
    // The two carcass goods a hunter's kill leaves on the ground (real ids: meat 21, harvest_cadaver
    // atomic 33). Direct-pickup nodes like the mushroom - no felling/deposit lifecycle.
    { typeId: 21, id: 'meat', weight: 1, atomics: { harvest: 33 } },
    { typeId: 22, id: 'leather', weight: 1, atomics: { harvest: 33 } },
    // The six amulets, permanent misc goods carrying the app catalog's (the original's) effects.
    { typeId: 23, id: 'amulet_food', weight: 0, equip: { category: 'misc', restorePct: { hunger: 40 } } },
    { typeId: 24, id: 'amulet_stamina', weight: 0, equip: { category: 'misc', restorePct: { fatigue: 40 } } },
    { typeId: 25, id: 'amulet_strength', weight: 0, equip: { category: 'misc', damageDealtPct: 150 } },
    { typeId: 26, id: 'amulet_defense', weight: 0, equip: { category: 'misc', damageTakenPct: 50 } },
    {
      typeId: 27,
      id: 'amulet_crithit',
      weight: 0,
      equip: { category: 'misc', criticalHit: { chancePct: 20, damagePct: 200 } },
    },
    { typeId: 28, id: 'amulet_speed', weight: 0, equip: { category: 'misc', walkStepTicksSaved: 2 } },
  ],
  jobs: [
    { typeId: 0, id: 'idle' },
    // The woodcutter is permitted the wood harvest atomic (24) - the planner's data-driven gate.
    { typeId: 1, id: 'woodcutter', allowedAtomics: [24] },
    { typeId: 2, id: 'carpenter' },
    // The civilist (the original's job 6 - the no-trade adult): assignable via setJob, employed by no
    // workplace, so a settler ordered into it stays jobless (the "Cywil" picker row).
    { typeId: 6, id: 'civilist' },
    // The smith (job 13) is the fixture's `needsReligionFlag` trade - the only kind of settler
    // that leaves its work to pray.
    // It carries the wood atomic only so the pray cases can watch a praying trade fall through to
    // ordinary work; the real smith forges at a workshop the fixture does not model.
    { typeId: 13, id: 'smith', needsReligion: true, allowedAtomics: [24] },
    // The miner is permitted the stone harvest atomic (25) - it chips a `MineDeposit` deposit.
    { typeId: 5, id: 'miner', allowedAtomics: [25] },
    // A two-trade collector (wood 24 + stone 25) - what the employed-gatherer store-filter tests use
    // (the filter only shows on a job that could harvest MORE than its workplace stores). Nothing in
    // the golden slice spawns it.
    { typeId: 7, id: 'collector', allowedAtomics: [24, 25] },
    // The hunter (job 15 - `JOB_TYPE_HUMAN_HUNTER`) - strikes huntable prey (the attack atomic 81)
    // and works the carcass nodes its kills leave (the harvest_cadaver atomic 33), the real
    // `jobtypes.ini 15` grant pair.
    { typeId: 15, id: 'hunter', allowedAtomics: [33, 81] },
    // The farmer (the original's job 18) is permitted wheat's plant/cultivate/harvest atomics - the
    // data-driven gate the field-farmer drive (planFarmer) keys on.
    { typeId: 18, id: 'farmer', allowedAtomics: [29, 34, 35] },
    // The scout (job 27 - `JOB_TYPE_HUMAN_SCOUT`) is permitted only the build-guide atomic (43), the
    // signpost-erecting swing - mirrors the original's `allowatomic 43`.
    { typeId: 27, id: 'scout', allowedAtomics: [43] },
    // The fighter trades, at their real `jobtypes.ini` ids and slugs - the role is read off the slug
    // (`core/content-index/jobs.ts`), so a fixture soldier/hero must carry the real vocabulary.
    // `jobtypes.ini` marks every soldier `ignoresHomeHouseFlag 1`: they never go home, so nothing they
    // spend out in the field is halved for being spent there.
    { typeId: 31, id: 'soldier_unarmed', ignoresHomeHouse: true },
    { typeId: 45, id: 'hero_saber_hatschi' },
    // 36 is a second fixture carrier id; 24 is the original's real one (`logicworker 24`).
    { typeId: 36, id: 'carrier' },
    { typeId: 24, id: 'carrier' },
    // The land trader (job 25): works a route between two houses instead of a workplace; never goes home.
    { typeId: 25, id: 'trader', ignoresHomeHouse: true },
  ],
  buildings: [
    {
      typeId: 1,
      id: 'headquarters',
      kind: 'storage',
      prayerSite: 'headquarters',
      // A transport slot beside the gatherer slots (the original HQ declares `logicworker 24 3`,
      // houses.ini; count 1 here is a fixture simplification - one carrier keeps the golden legible):
      // a carrier is posted here, and only a POSTED carrier hauls
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
      // The "work temple" (original logictype 37): a devout settler walks here and runs the pray atomic.
      typeId: 3,
      id: 'temple',
      kind: 'workplace',
      prayerSite: 'temple',
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
      // (`logicstock 4 25 0` - the single-good, capacity-25 slot) and `produces` wheat with NO recipe
      // - the field loop, not the abstract in-house cycle, makes the wheat. What the farmer drive's
      // `farmWorkGood` keys on: a workplace producing a `farming` good.
      typeId: 5,
      id: 'farm',
      kind: 'workplace',
      workers: [{ jobType: 18, count: 4 }],
      stock: [{ goodType: 6, capacity: 25, initial: 0 }],
      produces: [6],
    },
    {
      // A passive wheat store (a granary) - the OVERFLOW sink the farm-full tests place: with the
      // farm's own 25-slot full, the farmer's reap/carry gate finds this and the delivery rung
      // routes the load here. No test outside farming places it, so every golden is untouched.
      typeId: 6,
      id: 'granary',
      kind: 'storage',
      stock: [{ goodType: 6, capacity: 150, initial: 0 }],
    },
    {
      // A general WAREHOUSE (kind storage) that stocks every fixture good - the delivery SINK the
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
      // A TWO-PRODUCT workshop off DIFFERENT inputs - the upgraded bakery's shape (`work_bakery_01`
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
      // The KITCHEN (the real bakery's shape): it turns wood into `bread`, and its bread slot is the
      // ONLY one in the whole fixture - no warehouse, HQ or workshop can hold a loaf, matching
      // `houses.ini`, where a dish has a `logicstock` line solely in its own producing house. What the
      // dish-export tests staff; nothing in the golden slice places it.
      typeId: 21,
      id: 'kitchen',
      kind: 'workplace',
      workers: [
        { jobType: 2, count: 1 },
        { jobType: 36, count: 1 },
      ],
      stock: [
        { goodType: 1, capacity: 10, initial: 0 },
        { goodType: 7, capacity: 5, initial: 0 },
      ],
      recipes: [{ inputs: [{ goodType: 1, amount: 1 }], outputs: [{ goodType: 7, amount: 1 }], ticks: 20 }],
      // Declared like the real bakery (`work_bakery_00` carries `produces: [19]`): the dish conversion
      // fires only for a good the store PRODUCES, so the fixture must state it.
      produces: [7],
    },
    {
      // A MULTI-PRODUCT workshop (the real smithy-2 shape, shrunk to fixture goods): ONE carpenter
      // operator and two per-product recipes off the same wood input - what the craft-selection /
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
    {
      // A passive GEAR store (a small armoury) - the only fixture store with slots for the two
      // equippables above, so the equip-errand tests control exactly where gear can come from and go
      // to. Nothing else places it (goldens untouched). typeId 22: 10..19 are reserved for suites that
      // append their own types (see the kitchen note above).
      typeId: 22,
      id: 'armoury',
      kind: 'storage',
      stock: [
        { goodType: 8, capacity: 10, initial: 0 },
        { goodType: 9, capacity: 10, initial: 0 },
      ],
    },
    {
      // A MEAT-STOCKING WORKPLACE employing two hunters - the flagless (workplace-employed) hunter the
      // carcass tests need: its ground is the HUNTER_WORK_FLAG_RADIUS circle around it, and its store
      // decides which goods it forages at all. Named for what it models, not after an original
      // building: the owned copy has no hunting hut (hunters work out of the HQ and the stocks).
      // typeId 24, unplaced by any golden (23 is the tower job-system.test.ts appends).
      typeId: 24,
      id: 'meat_workplace',
      kind: 'workplace',
      workers: [{ jobType: 15, count: 2 }],
      // BOTH carcass goods: a meat-only store would filter a body out at its leather stage, the wedge
      // the flag path dodges by ignoring its flag's good filter for a hunter.
      stock: [
        { goodType: 21, capacity: 50, initial: 0 },
        { goodType: 22, capacity: 50, initial: 0 },
      ],
    },
  ],
  // The three vehicle shapes of `vehicletypes.ini` with their real slot, size and pool values: a cart
  // (footprint one node, cargo, the hauler and scout trades as crew, the trader as script captain), a
  // ship (disc radius 2, passengers, a door four steps off the bow, one carried vehicle, the carrier as
  // captain) and the catapult (radius 1, no cargo, soldiers). The cart and ship carry wood, plank and
  // food_simple; bread aliases onto food_simple the way the original's dishes do.
  // The vehicle shapes of `vehicletypes.ini` with their real slot, size and pool values: a cart
  // (footprint one node, cargo, the hauler and scout trades as crew), the ox cart pair, a ship (disc
  // radius 2, passengers, a door four steps off the bow, one carried vehicle) and the catapult (radius 1,
  // no cargo, soldiers). The carts and ship carry wood, plank and food_simple; bread aliases onto
  // food_simple the way the original's dishes do.
  vehicles: [
    {
      typeId: 1,
      id: 'handcart',
      jobId: 50,
      stockSlots: 15,
      logicSize: 0,
      cargoGoods: [1, 2, 3],
      passengerJobs: [24, 25, 27],
      commanderJob: 25,
      hitpoints: 1000,
    },
    // The ox cart pair: the ox-less cart (6) admits no crew, recruits the cow (13, the fixture's catchable
    // livestock) and becomes the ox cart (2) when it arrives.
    {
      typeId: 2,
      id: 'oxcart',
      jobId: 51,
      stockSlots: 30,
      logicSize: 0,
      cargoGoods: [1, 2, 3],
      passengerJobs: [24, 25, 27],
      hitpoints: 1000,
    },
    {
      typeId: 6,
      id: 'cart_no_ox',
      jobId: 55,
      stockSlots: 30,
      logicSize: 0,
      cargoGoods: [1, 2, 3],
      passengerJobs: [],
      draggingAnimalTribe: 13,
      transformVehicleType: 2,
      hitpoints: 1000,
    },
    {
      typeId: 3,
      id: 'ship_small',
      jobId: 52,
      stockSlots: 50,
      passengerSlots: 19,
      logicSize: 2,
      cargoGoods: [1, 2, 3],
      // The crew jobs plus the vehicle jobs it carries, the way the original's ship rows list them.
      passengerJobs: [6, 24, 25, 27, 31, 50, 54],
      commanderJob: 24,
      passengerVector: { direction: 2, distance: 4 },
      vehicleSlots: 1,
      hitpoints: 5000,
    },
    {
      typeId: 5,
      id: 'catapult',
      jobId: 54,
      stockSlots: 0,
      logicSize: 1,
      passengerJobs: [31],
      commanderJob: 31,
      hitpoints: 3000,
    },
  ],
  landscape: [
    // Grass is the one PLANTABLE ground (the original's `biocanplanton` triangle flag - `land` alone
    // carries it); barren is its walk+build twin that rejects the plough (sand/beach/desert stone).
    { typeId: 0, id: 'grass', walkable: true, buildable: true, plantable: true },
    { typeId: 1, id: 'water', walkable: false, buildable: false },
    { typeId: 2, id: 'barren', walkable: true, buildable: true },
  ],
};
