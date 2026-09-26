import { type ContentSet, IR_VERSION, parseContentSet } from '@open-northland/data';
import { WEAPON_MAIN_TYPE } from '../../src/systems/readviews/index.js';

/**
 * A synthetic content set for the strategic AI-player tests, using the REAL stable content ids
 * (`headquarters`, `home_level_00`, `work_farm_00`, harvest-good slugs) so the default modules and
 * `DEFAULT_BUILD_ORDER` resolve against it unmodified; entries of the default order that are absent
 * here (pottery, mason, hive, animal farm, sewery, smithy, armory) exercise the
 * skip-missing-content path. The home chain (00→01→02) backs the upgrade entries, the
 * mill/bakery/well trio backs the chain-affinity entries, the bakery chain (00→01) backs the
 * upgrade tail and its two-baker target, and the iron good - gated by the viking `needforgood` row
 * over the collector XP tracks - backs the gated collector entry and its experience rule. The
 * brewery/joinery/barracks/storage/tower rows back the 2026-07-25 tail: the joinery's two recipes
 * drive the craft restriction, the storages the carrier staffing and the store coverage, and the
 * tower pair the coverage entry (the kind-'tower' wall row proves the id allowlist). Numeric ids
 * follow the original's job/good bands where they exist (woman 5, civilist 6, builder 7, collector
 * 8, farmer 18, miller 19, baker 20, brewer 21, carrier 24, scout 27, and the fighter band's
 * soldier_bow_short 40); the joiner takes a free slot, 16.
 */
export function aiContent(): ContentSet {
  return parseContentSet({
    manifest: { version: IR_VERSION, generatedFrom: { mod: 'synthetic-test-fixture' }, locale: 'eng' },
    goods: [
      { typeId: 0, id: 'none' },
      {
        typeId: 1,
        id: 'wood',
        weight: 1,
        atomics: { harvest: 24 },
        gathering: { bioLandscape: true, yieldPerNode: 4 },
      },
      // Clay ("mud") is a trivial direct pickup here - the collector-selection tests only need a
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
      // Iron backs the build order's gated `collector` entry - same trivial pickup as clay.
      { typeId: 5, id: 'iron', weight: 1, atomics: { harvest: 26 }, gathering: { bioLandscape: false } },
      // The joinery's two products - the craft restriction keeps its joiners on tool_iron only.
      { typeId: 6, id: 'tool_wooden', weight: 1 },
      { typeId: 7, id: 'tool_iron', weight: 1 },
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
      // The collector harvests all four collected goods (wood 24, stone 25, iron 26, mud 32).
      { typeId: 8, id: 'collector', allowedAtomics: [24, 25, 26, 32] },
      { typeId: 16, id: 'joiner' },
      { typeId: 18, id: 'farmer', allowedAtomics: [29] },
      { typeId: 19, id: 'miller' },
      { typeId: 20, id: 'baker' },
      { typeId: 21, id: 'brewer' },
      { typeId: 24, id: 'carrier' },
      { typeId: 27, id: 'scout', allowedAtomics: [43] },
      // The fighter band (31..41): the weaponless base class the barracks drill enlists into, plus the
      // two armed classes the `weapons` rows below bind. The bow class doubles as the tower garrison
      // slot the staffing plan must never fill.
      { typeId: 31, id: 'soldier_unarmed' },
      { typeId: 32, id: 'soldier_spear_wooden' },
      { typeId: 40, id: 'soldier_bow_short' },
    ],
    // The fighter classes' weapons, keyed by (tribe, job) as in the original - including the base
    // class's bare fist, which the real `weapons.ini` binds to job 31 too. The army census sends nobody
    // whose `mainType` is the fist. The short bow's `munitionType` is the data-pinned ranged marker.
    weapons: [
      {
        typeId: 2,
        id: 'viking_fist',
        tribeType: 1,
        jobType: 31,
        mainType: WEAPON_MAIN_TYPE.UNARMED,
        minRange: 1,
        maxRange: 1,
      },
      {
        typeId: 5,
        id: 'viking_spear_wooden',
        tribeType: 1,
        jobType: 32,
        mainType: WEAPON_MAIN_TYPE.SPEAR,
        minRange: 1,
        maxRange: 2,
      },
      {
        typeId: 6,
        id: 'viking_bow_short',
        tribeType: 1,
        jobType: 40,
        mainType: WEAPON_MAIN_TYPE.BOW,
        munitionType: 1,
        speed: 8,
        minRange: 3,
        maxRange: 17,
      },
      // The wall bow, bound by id (`house_bow`) rather than by class - the reach a sheltering civilian
      // answers with, and the band the seat watches for raiders in (`military/defence/threat.ts`).
      {
        typeId: 20,
        id: 'house_bow',
        tribeType: 1,
        jobType: 6,
        mainType: WEAPON_MAIN_TYPE.BOW,
        munitionType: 1,
        speed: 8,
        minRange: 0,
        maxRange: 29,
      },
    ],
    buildings: [
      {
        typeId: 1,
        id: 'headquarters',
        kind: 'storage',
        // A life pool, so a placed HQ carries Health and can be marched on (the army's objective).
        hitpoints: 500,
        // Room to hide the town: the seat's own alarm rings over this and the tower below.
        shelterCapacity: 20,
        // A real body with the door on one side: a point building would put every approach node, siege
        // reach and shelter radius on the same tile and hide the difference.
        footprint: {
          blocked: [
            { dx: -2, dy: -2 },
            { dx: 0, dy: -2 },
            { dx: 2, dy: -2 },
            { dx: -2, dy: 0 },
            { dx: 0, dy: 0 },
            { dx: 2, dy: 0 },
            { dx: -2, dy: 2 },
            { dx: 0, dy: 2 },
            { dx: 2, dy: 2 },
          ],
          door: { dx: 0, dy: 4 },
        },
        // A transport band plus the gatherer band - the collector reconciliation must pick the
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
        upgradeTarget: 3,
        // A real material bill keeps a placed site open (a zero-cost site completes instantly).
        construction: [{ goodType: 1, amount: 2 }],
        stock: [{ goodType: 3, capacity: 5, initial: 0 }],
      },
      {
        typeId: 3,
        id: 'home_level_01',
        kind: 'home',
        homeSize: 2,
        upgradeTarget: 4,
        construction: [{ goodType: 1, amount: 2 }],
        stock: [{ goodType: 3, capacity: 5, initial: 0 }],
      },
      // Three family slots per top home: three upgraded homes make the plan's nine families.
      {
        typeId: 4,
        id: 'home_level_02',
        kind: 'home',
        homeSize: 3,
        construction: [{ goodType: 1, amount: 2 }],
        stock: [{ goodType: 3, capacity: 5, initial: 0 }],
      },
      {
        typeId: 5,
        id: 'work_farm_00',
        kind: 'workplace',
        // A farmer operator slot beside a carrier transport slot - staffing must fill the operator
        // trade only (one worker per trade), never the carrier.
        workers: [
          { jobType: 18, count: 4 },
          { jobType: 24, count: 1 },
        ],
        construction: [{ goodType: 1, amount: 2 }],
        stock: [{ goodType: 3, capacity: 25, initial: 0 }],
      },
      {
        typeId: 6,
        id: 'work_well_00',
        kind: 'workplace',
        workers: [{ jobType: 24, count: 1 }],
        construction: [{ goodType: 1, amount: 2 }],
        stock: [{ goodType: 3, capacity: 5, initial: 0 }],
      },
      {
        typeId: 7,
        id: 'work_mill_00',
        kind: 'workplace',
        workers: [
          { jobType: 19, count: 2 },
          { jobType: 24, count: 1 },
        ],
        construction: [{ goodType: 1, amount: 2 }],
        stock: [{ goodType: 3, capacity: 5, initial: 0 }],
      },
      // A baker operator beside a carrier transport slot - the bakery is the plan's one
      // carrier-staffed building, so staffing must fill BOTH.
      {
        typeId: 8,
        id: 'work_bakery_00',
        kind: 'workplace',
        upgradeTarget: 9,
        workers: [
          { jobType: 20, count: 1 },
          { jobType: 24, count: 1 },
        ],
        construction: [{ goodType: 1, amount: 2 }],
        stock: [{ goodType: 3, capacity: 5, initial: 0 }],
      },
      // The upgraded bakery: two baker slots - a building whose operator target is raised to two
      // (`STAFFING_BY_BUILDING_ID`), still carrier-staffed.
      {
        typeId: 9,
        id: 'work_bakery_01',
        kind: 'workplace',
        workers: [
          { jobType: 20, count: 2 },
          { jobType: 24, count: 1 },
        ],
        construction: [{ goodType: 1, amount: 2 }],
        stock: [{ goodType: 3, capacity: 5, initial: 0 }],
      },
      {
        typeId: 10,
        id: 'work_brewery',
        kind: 'workplace',
        workers: [
          { jobType: 21, count: 2 },
          { jobType: 24, count: 1 },
        ],
        construction: [{ goodType: 1, amount: 2 }],
        stock: [{ goodType: 3, capacity: 5, initial: 0 }],
      },
      // The joinery makes wooden tools from wood and iron tools from wood+iron - the two recipes
      // the craft restriction chooses between.
      {
        typeId: 11,
        id: 'work_joinery_01',
        kind: 'workplace',
        workers: [
          { jobType: 16, count: 2 },
          { jobType: 24, count: 1 },
        ],
        recipes: [
          { inputs: [{ goodType: 1, amount: 1 }], outputs: [{ goodType: 6, amount: 1 }], ticks: 180 },
          {
            inputs: [
              { goodType: 1, amount: 1 },
              { goodType: 5, amount: 1 },
            ],
            outputs: [{ goodType: 7, amount: 1 }],
            ticks: 180,
          },
        ],
        construction: [{ goodType: 1, amount: 2 }],
        stock: [
          { goodType: 1, capacity: 5, initial: 0 },
          { goodType: 5, capacity: 5, initial: 0 },
          { goodType: 6, capacity: 5, initial: 0 },
          { goodType: 7, capacity: 5, initial: 0 },
        ],
      },
      // The barracks: carrier slots only, the real shape - and the seat still staffs none of them.
      {
        typeId: 12,
        id: 'barracks',
        kind: 'training',
        workers: [{ jobType: 24, count: 4 }],
        construction: [{ goodType: 1, amount: 2 }],
        stock: [{ goodType: 3, capacity: 5, initial: 0 }],
      },
      // Storages share the HQ's worker shape - up to three target-tier carriers, harvest slots open.
      {
        typeId: 13,
        id: 'stock_00',
        kind: 'storage',
        // The only other building with a life pool: the fallback objective when no enemy HQ stands.
        hitpoints: 200,
        workers: [
          { jobType: 24, count: 3 },
          { jobType: 8, count: 3 },
        ],
        construction: [{ goodType: 1, amount: 2 }],
        stock: [{ goodType: 3, capacity: 45, initial: 0 }],
      },
      {
        typeId: 14,
        id: 'stock_02',
        kind: 'storage',
        workers: [
          { jobType: 24, count: 3 },
          { jobType: 8, count: 3 },
        ],
        construction: [{ goodType: 1, amount: 2 }],
        stock: [{ goodType: 3, capacity: 120, initial: 0 }],
      },
      // The level-2 tower (its fighter-band slots are the seat's garrison posts) and the defence WALL,
      // which shares kind 'tower' but must never count as a covering tower (the id allowlist).
      {
        typeId: 15,
        id: 'tower_01',
        kind: 'tower',
        // A life pool like the HQ's: the campaign's middle siege tier is a standing tower.
        hitpoints: 300,
        shelterCapacity: 10,
        workers: [
          { jobType: 40, count: 4 },
          { jobType: 24, count: 4 },
        ],
        construction: [{ goodType: 1, amount: 2 }],
        stock: [{ goodType: 3, capacity: 5, initial: 0 }],
      },
      {
        typeId: 16,
        id: 'work_pottery_02',
        kind: 'tower',
        construction: [{ goodType: 1, amount: 2 }],
      },
      // A workshop's hidden vehicle yard: the site a joiner's cart cycle opens, never one the list places.
      {
        typeId: 77,
        id: 'handcart_yard',
        kind: 'vehicle',
        construction: [{ goodType: 1, amount: 2 }],
      },
    ],
    // The collector's per-good XP tracks (real track ids 4/5 back iron's `needforgood` below; the
    // factors mirror the base data - one completed dig clears the threshold).
    jobExperience: [
      { typeId: 4, id: 'collector_mud', jobType: 8, goodTypes: [2], experienceFactor: 100 },
      { typeId: 5, id: 'collector_stone', jobType: 8, goodTypes: [4], experienceFactor: 100 },
    ],
    // The civilist's barracks drill: job 6 bound to EXERCISE (atomic 89), whose GET_TRAINING event
    // (type 29) banks the extracted `+1` per repetition. The seat reads this chain to decide whether its
    // data can school a soldier at all, so without it no garrison is hired (`workforce/garrison.ts`).
    atomicAnimations: [
      {
        id: 'viking_civilist_exercise',
        name: 'viking_civilist_exercise',
        length: 4,
        events: [{ at: 2, type: 29, value: 1 }],
      },
    ],
    // The viking requirement table's iron gate (base data: `needforgood iron 10` measured in the
    // clay+stone collector tracks) - a fresh hire may not mine iron until it has dug clay or stone.
    tribes: [
      {
        typeId: 1,
        id: 'viking',
        atomicBindings: [{ jobType: 6, atomicId: 89, animation: 'viking_civilist_exercise' }],
        // Only a civilization carries a `jobEnables` tech graph - the data signature `isAnimalTribe`
        // reads (the assistant's free-man draft relies on it). The pair is inert: nothing auto-hires
        // the woman sex-slug job, so no placement/production/hiring gate arms in these tests.
        jobEnables: [{ jobType: 6, kind: 'job', targetId: 5 }],
        jobRequirements: [
          { requirement: 'need', target: 'good', targetId: 5, amount: 10, experienceTypes: [4, 5] },
        ],
      },
      // The claimable cow's tribe (`COW_TRIBE` in the ai-player cases), so its `animaltypes` record
      // below has a tribe to reference.
      { typeId: 13, id: 'cattle' },
    ],
    // Carrying an `animaltypes` record is what makes the tribe wildlife, so a claimed cow is never
    // counted as one of the seat's men.
    animals: [{ id: 'cow', tribeType: 13, catchable: true, warrantable: true, hitpointsAdult: 1000 }],
    landscape: [
      { typeId: 0, id: 'grass', walkable: true, buildable: true, plantable: true },
      { typeId: 1, id: 'water', walkable: false, buildable: false },
      // Buildable-but-barren ground for the farm's plantable rule (grass is the fixture default).
      { typeId: 2, id: 'sand', walkable: true, buildable: true },
      // The harvest-stage landscape classes behind the placeable resource nodes below (original
      // logic-type band: tree 4, rock 15; 16/17 are free slots for the clay pit and iron rock).
      { typeId: 4, id: 'tree', walkable: false, buildable: false },
      { typeId: 15, id: 'rock', walkable: false, buildable: false },
      { typeId: 16, id: 'mud_pit', walkable: false, buildable: false },
      { typeId: 17, id: 'iron_rock', walkable: false, buildable: false },
    ],
    // One single-cell placeable object per collected good - the minimum `createResourceNode` needs
    // to stamp a footprint, so tests can drop resource nodes with the `placeResource` command.
    landscapeGfx: [
      { index: 1, logicType: 4, walkBlockAreas: [[0, 0, 0, 0]], buildBlockAreas: [[0, 0, 0, 0]] },
      { index: 2, logicType: 15, walkBlockAreas: [[0, 0, 0, 0]], buildBlockAreas: [[0, 0, 0, 0]] },
      { index: 3, logicType: 16, walkBlockAreas: [[0, 0, 0, 0]], buildBlockAreas: [[0, 0, 0, 0]] },
      { index: 4, logicType: 17, walkBlockAreas: [[0, 0, 0, 0]], buildBlockAreas: [[0, 0, 0, 0]] },
    ],
    gatheringPipeline: [
      {
        goodType: 1,
        goodId: 'wood',
        harvestAtomic: 24,
        bioLandscape: true,
        harvest: { landscapeType: 4, gfxIndices: [1] },
      },
      {
        goodType: 2,
        goodId: 'mud',
        harvestAtomic: 32,
        harvest: { landscapeType: 16, gfxIndices: [3] },
      },
      {
        goodType: 4,
        goodId: 'stone',
        harvestAtomic: 25,
        harvest: { landscapeType: 15, gfxIndices: [2] },
      },
      {
        goodType: 5,
        goodId: 'iron',
        harvestAtomic: 26,
        harvest: { landscapeType: 17, gfxIndices: [4] },
      },
    ],
  });
}
