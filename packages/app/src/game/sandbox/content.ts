import { type BuildingFootprint, type ContentSet, IR_VERSION, parseContentSet } from '@vinland/data';
import {
  ATTACK_ATOMIC,
  CLAY_HARVEST_ATOMIC,
  CULTIVATE_ATOMIC,
  GOLD_HARVEST_ATOMIC,
  HARVEST_ATOMIC,
  IRON_HARVEST_ATOMIC,
  MUSHROOM_HARVEST_ATOMIC,
  PLANT_ATOMIC,
  STONE_HARVEST_ATOMIC,
  STORE_PICKUP_ATOMIC,
  STORE_PILEUP_ATOMIC,
  WHEAT_HARVEST_ATOMIC,
} from '../../catalog/atomics.js';
import {
  FARM_FIELD_RADIUS,
  FARM_FIELDS_BASE,
  FARM_FIELDS_PER_FARMER,
  WHEAT_GROWTH_STAGES,
  WHEAT_TICKS_PER_STAGE,
  WHEAT_YIELD_PER_FIELD,
} from '../../catalog/farming.js';
import { WOOD_CHOPS_TO_FELL, WOOD_YIELD_PER_NODE } from '../../catalog/felling.js';
import { EXTENDED_GOODS } from '../../catalog/goods.js';
import {
  CLAY_DEPOSIT_UNITS,
  GOLD_DEPOSIT_UNITS,
  IRON_DEPOSIT_UNITS,
  MINE_LEVELS,
  STONE_DEPOSIT_UNITS,
} from '../../catalog/mining.js';
import { PROFESSIONS } from '../../catalog/professions.js';
import type { GoodRef } from '../../content/settler-gfx/index.js';
import { HARVEST_TICKS } from '../../content/settler-gfx/index.js';
import { professionLabel } from '../../i18n/index.js';
import { PRIMARY_TRIBE } from '../rules.js';
import { buildSandboxBuildings } from './building-set.js';
import {
  ATTACK_EVENT_TYPE,
  BROADSWORD_HIT_FRAME,
  BROADSWORD_SWING_LENGTH,
  EQUIP_CLASS_BY_TYPE,
  FIST_HIT_FRAME,
  FIST_SWING_LENGTH,
  LONG_BOW_DRAW_LENGTH,
  LONG_BOW_RELEASE_FRAME,
  SHORT_BOW_DRAW_LENGTH,
  SHORT_BOW_RELEASE_FRAME,
  SPEAR_HIT_FRAME,
  SPEAR_SWING_LENGTH,
  SWORD_HIT_FRAME,
  SWORD_SWING_LENGTH,
  sandboxWeapons,
} from './combat.js';
import {
  BUILD_HOUSE_ATOMIC,
  GATHERERS,
  GOOD_COIN,
  GOOD_GOLD,
  GOOD_IRON,
  GOOD_MUD,
  GOOD_MUSHROOM,
  GOOD_NONE,
  GOOD_PLANK,
  GOOD_STONE,
  GOOD_WHEAT,
  GOOD_WOOD,
  JOB_ARCHER,
  JOB_ARCHER_LONG,
  JOB_BUILDER,
  JOB_CARRIER,
  JOB_FARMER_SLOT,
  JOB_IDLE,
  JOB_SOLDIER_BROADSWORD,
  JOB_SOLDIER_SPEAR,
  JOB_SOLDIER_SWORD,
  JOB_SOLDIER_UNARMED,
  rebaseSlotJob,
} from './ids.js';
import {
  sandboxGatheringPipeline,
  sandboxLandscape,
  sandboxLandscapeGfx,
  type TerrainTypeIds,
} from './landscape.js';
import {
  BUILD_HOUSE_ANIMATION,
  BUILD_HOUSE_SWING_LENGTH,
  FARMER_REAP_ANIMATION,
  FARMER_REAP_LENGTH,
  FARMER_SOW_ANIMATION,
  FARMER_SOW_LENGTH,
  FARMER_WATER_ANIMATION,
  FARMER_WATER_LENGTH,
  STORE_EXCHANGE_LENGTH,
  STORE_PICKUP_ANIMATION,
  STORE_PILEUP_ANIMATION,
} from './work-animations.js';
import { BUILDING_WORKER_SLOTS, workerSlotName } from './worker-slots.js';

/**
 * The ONE global sandbox {@link ContentSet} — goods/jobs/buildings/weapons/animation bindings — every
 * scene and the vertical slice consume (they never define their own content; packages/app/AGENTS.md).
 * The package splits by concern: semantic ids + the {@link GATHERERS} table in `./ids.ts`, the combat
 * weapons + swing timings in `./combat.ts`, the non-combat work-animation timings in
 * `./work-animations.ts`, the terrain/resource landscape derivation in `./landscape.ts`, the building
 * store/recipe set in `./building-set.ts`, the extracted worker/carrier slot table in
 * `./worker-slots.ts`, the construction cost + hitpoint tables in `./construction.ts`, world-population
 * helpers in `./place.ts`, scene-check queries beside the scenes (`scenes/sandbox-queries.ts`); this
 * module only assembles the validated content set.
 */

export interface SandboxContentExtras {
  readonly buildings?: readonly { typeId: number; id: string; kind?: string }[];
  readonly jobs?: readonly { typeId: number; id: string }[];
  readonly tribes?: readonly { typeId: number; id: string }[];
  /**
   * Extracted building ground footprints by typeId (from `content/ir.json` via
   * {@link import('../../content/ir.js').buildingFootprints}). When supplied — the live real-content
   * entries do so — they REPLACE the clean-room approximations wholesale: a type present in the map
   * gets its real collision body / build-exclusion zone, and a type absent from it is genuinely
   * footprint-less (that is what the real data says — no approximation is mixed back in). Omitted
   * (tests, scenes, a bare checkout with no `content/`), every catalog building carries its
   * {@link import('../../catalog/footprints.js').approximateFootprint} instead, so placement collision
   * + the build overlay work globally.
   */
  readonly buildingFootprints?: ReadonlyMap<number, BuildingFootprint>;
  /**
   * Localized good DISPLAY names by good STRING id (from the pipeline's per-locale name tables via
   * {@link import('../../content/good-names.js').loadGoodNameMap}). When supplied — the browser entries do,
   * after picking the `?locale=` language — each good's `name` is set from it, so the HUD (warehouse rows,
   * ground-pile tooltip, spawn palette, production labels) reads in-language from ONE source. Omitted (tests,
   * headless scenes, a bare checkout), the core goods stay name-less and the extended goods keep their
   * built-in English catalog name, so golden runs and the no-`content/` boot are unchanged.
   */
  readonly goodNames?: ReadonlyMap<string, string>;
}

export function sandboxGoods(): readonly GoodRef[] {
  return sandboxContent().goods.map((g) => ({ typeId: g.typeId, id: g.id }));
}

/** A sandbox job row: its type id, string id, display name, and the atomics its trade may run. */
type SandboxJob = { typeId: number; id: string; name?: string; allowedAtomics?: number[] };

/** A sandbox tribe row: its type id, id, and the job-enable / atomic-binding lists the sim reads. */
type SandboxTribe = { typeId: number; id: string; jobEnables?: unknown[]; atomicBindings?: unknown[] };

/**
 * The job set: idle, the gatherer trades, the carrier, the real-behaviour farmer/builder/soldier jobs,
 * the full player-assignable profession roster, every extracted worker-slot job (backfilled under its
 * real trade name), plus any extra jobs the caller declares.
 */
function buildSandboxJobs(extras: SandboxContentExtras): Map<number, SandboxJob> {
  const jobs = new Map<number, SandboxJob>();
  for (const j of [
    { typeId: JOB_IDLE, id: 'idle', name: 'Bezrobotny' },
    ...GATHERERS.map((g) => ({
      typeId: g.job,
      id: `gatherer_${g.id}`,
      name: g.label,
      allowedAtomics: [g.atomic],
    })),
    { typeId: JOB_CARRIER, id: 'carrier', name: 'Tragarz' },
    // The FARMER worker-slot trade — the one rebased slot job with real behaviour: its three field
    // atomics (the original's `jobtypes.ini 18` `allowatomic 29/34/35`) are what the planner's
    // field-farmer drive keys on, so a farm-bound farmer sows/waters/reaps instead of standing idle.
    {
      typeId: JOB_FARMER_SLOT,
      id: 'farmer',
      name: professionLabel('farmer'),
      allowedAtomics: [WHEAT_HARVEST_ATOMIC, PLANT_ATOMIC, CULTIVATE_ATOMIC],
    },
    { typeId: JOB_SOLDIER_UNARMED, id: 'soldier_unarmed', name: 'Wojownik (bez broni)' },
    // The builder trade — permitted to run the build-house atomic, which is the data-driven signal the
    // planner's builder drive reads to put this settler on a foundation (the construction scene).
    { typeId: JOB_BUILDER, id: 'builder', name: 'Budowniczy', allowedAtomics: [BUILD_HOUSE_ATOMIC] },
    { typeId: JOB_SOLDIER_SPEAR, id: 'soldier_spear', name: 'Wlocznik' },
    { typeId: JOB_SOLDIER_SWORD, id: 'soldier_sword', name: 'Miecznik' },
    { typeId: JOB_SOLDIER_BROADSWORD, id: 'soldier_broadsword', name: 'Miecznik (dwureczny)' },
    { typeId: JOB_ARCHER, id: 'soldier_bow', name: 'Lucznik' },
    { typeId: JOB_ARCHER_LONG, id: 'soldier_bow_long', name: 'Lucznik (dlugi luk)' },
  ]) {
    jobs.set(j.typeId, j);
  }
  // The full player-assignable profession roster (`catalog/professions.ts`, transcribed from
  // `jobtypes.ini`) so the profession picker's `setJob` LANDS for every offered profession — the sim
  // silently no-ops an unknown jobType (`packages/sim` `setJob`). The gatherers/carrier/scene-soldiers
  // above already define the functional jobs; this adds the base soldier + the production trades (they
  // draw the civilian body and, lacking a workhouse in the sandbox, stand idle until the economy lands).
  for (const p of PROFESSIONS)
    if (!jobs.has(p.jobType)) jobs.set(p.jobType, { typeId: p.jobType, id: p.key });
  // Every worker-slot jobType ({@link BUILDING_WORKER_SLOTS}, extracted from ir.json, REBASED clear of
  // the sandbox job band — see {@link rebaseSlotJob}) must resolve as a job or the content cross-reference
  // check rejects the set. Backfill each still-missing slot job under its REAL trade name
  // ({@link workerSlotName} — the shared profession label, so the panel names the worker by the SAME word
  // the picker uses); only its distinct-trade *behaviour* is dropped (the deferred global-content id
  // unification). The carrier slot resolves to the real 'Tragarz' above.
  for (const slots of Object.values(BUILDING_WORKER_SLOTS))
    for (const w of slots) {
      const jobType = rebaseSlotJob(w.jobType);
      if (!jobs.has(jobType))
        jobs.set(jobType, { typeId: jobType, id: `worker_${jobType}`, name: workerSlotName(w.jobType) });
    }
  for (const j of extras.jobs ?? []) if (!jobs.has(j.typeId)) jobs.set(j.typeId, j);
  return jobs;
}

/**
 * The tribe set: the primary viking tribe with its per-job atomic bindings (gatherer harvests, the
 * soldier attack swings, the builder/farmer work swings, and the generic per-job store-exchange pair
 * fanned out over `jobTypes`) plus any extra tribes the caller declares.
 */
function buildSandboxTribes(
  jobTypes: readonly number[],
  extras: SandboxContentExtras,
): Map<number, SandboxTribe> {
  const tribes = new Map<number, SandboxTribe>();
  tribes.set(PRIMARY_TRIBE, {
    typeId: PRIMARY_TRIBE,
    id: 'viking',
    atomicBindings: [
      ...GATHERERS.map((g) => ({ jobType: g.job, atomicId: g.atomic, animation: g.animation })),
      { jobType: JOB_SOLDIER_UNARMED, atomicId: ATTACK_ATOMIC, animation: 'viking_fist_attack' },
      // The builder → build-house swing (so atomicDuration resolves the 15-tick length below, not the default).
      { jobType: JOB_BUILDER, atomicId: BUILD_HOUSE_ATOMIC, animation: BUILD_HOUSE_ANIMATION },
      // The farmer's field swings (the original's `setatomic 18 29/34/35` on the rebased slot job) —
      // the sow/water/reap durations resolve through the transcribed animation lengths below.
      { jobType: JOB_FARMER_SLOT, atomicId: WHEAT_HARVEST_ATOMIC, animation: FARMER_REAP_ANIMATION },
      { jobType: JOB_FARMER_SLOT, atomicId: PLANT_ATOMIC, animation: FARMER_SOW_ANIMATION },
      { jobType: JOB_FARMER_SLOT, atomicId: CULTIVATE_ATOMIC, animation: FARMER_WATER_ANIMATION },
      { jobType: JOB_SOLDIER_SPEAR, atomicId: ATTACK_ATOMIC, animation: 'viking_spear_attack' },
      { jobType: JOB_SOLDIER_SWORD, atomicId: ATTACK_ATOMIC, animation: 'viking_sword_attack' },
      { jobType: JOB_SOLDIER_BROADSWORD, atomicId: ATTACK_ATOMIC, animation: 'viking_broadsword_attack' },
      { jobType: JOB_ARCHER, atomicId: ATTACK_ATOMIC, animation: 'viking_bow_attack' },
      { jobType: JOB_ARCHER_LONG, atomicId: ATTACK_ATOMIC, animation: 'viking_bow_long_attack' },
      // Every trade exchanges goods with a store the same way — the generic pickup/pileup pair, bound
      // per job like the original's per-class `setatomic <job> 22/23` rows (see STORE_PICKUP_ATOMIC).
      ...jobTypes.flatMap((jobType) => [
        { jobType, atomicId: STORE_PICKUP_ATOMIC, animation: STORE_PICKUP_ANIMATION },
        { jobType, atomicId: STORE_PILEUP_ATOMIC, animation: STORE_PILEUP_ANIMATION },
      ]),
    ],
    jobEnables: [{ jobType: JOB_IDLE, kind: 'good', targetId: GOOD_COIN }],
  });
  for (const t of extras.tribes ?? []) {
    if (!tribes.has(t.typeId)) {
      tribes.set(t.typeId, {
        typeId: t.typeId,
        id: t.id,
        jobEnables: [{ jobType: JOB_IDLE, kind: 'good', targetId: GOOD_COIN }],
      });
    }
  }
  return tribes;
}

/**
 * The ONE global sandbox {@link ContentSet} — goods/jobs/buildings/weapons/animation bindings — every
 * scene and the vertical slice consume (they never define their own content; packages/app/AGENTS.md).
 * Assembles the per-domain builders above into the validated set.
 */
export function sandboxContent(map?: TerrainTypeIds, extras: SandboxContentExtras = {}): ContentSet {
  const buildings = buildSandboxBuildings(extras);
  const jobs = buildSandboxJobs(extras);
  const tribes = buildSandboxTribes([...jobs.keys()], extras);
  // The localized display name for a good STRING id, as an optional-`name` spread — present only when the
  // caller supplied a name map AND it has that id, so a headless/golden build (no map) is byte-unchanged.
  const localName = (id: string): { name?: string } => {
    const n = extras.goodNames?.get(id);
    return n !== undefined ? { name: n } : {};
  };

  return parseContentSet({
    manifest: { version: IR_VERSION, generatedFrom: { game: 'vinland-global-sandbox' }, locale: 'eng' },
    goods: [
      { typeId: GOOD_NONE, id: 'none' },
      {
        typeId: GOOD_WOOD,
        id: 'wood',
        ...localName('wood'),
        weight: 1,
        atomics: { harvest: HARVEST_ATOMIC },
        gathering: {
          bioLandscape: true,
          chopsToFell: WOOD_CHOPS_TO_FELL,
          yieldPerNode: WOOD_YIELD_PER_NODE,
        },
      },
      { typeId: GOOD_PLANK, id: 'plank', ...localName('plank'), weight: 1 },
      { typeId: GOOD_COIN, id: 'coin', ...localName('coin') },
      {
        typeId: GOOD_STONE,
        id: 'stone',
        ...localName('stone'),
        weight: 1,
        atomics: { harvest: STONE_HARVEST_ATOMIC },
        gathering: { bioLandscape: false, depositSize: STONE_DEPOSIT_UNITS, depositLevels: MINE_LEVELS },
      },
      {
        typeId: GOOD_MUD,
        id: 'mud',
        ...localName('mud'),
        weight: 1,
        atomics: { harvest: CLAY_HARVEST_ATOMIC },
        gathering: { bioLandscape: false, depositSize: CLAY_DEPOSIT_UNITS, depositLevels: MINE_LEVELS },
      },
      {
        typeId: GOOD_IRON,
        id: 'iron',
        ...localName('iron'),
        weight: 1,
        atomics: { harvest: IRON_HARVEST_ATOMIC },
        gathering: { bioLandscape: false, depositSize: IRON_DEPOSIT_UNITS, depositLevels: MINE_LEVELS },
      },
      {
        typeId: GOOD_GOLD,
        id: 'gold',
        ...localName('gold'),
        weight: 1,
        atomics: { harvest: GOLD_HARVEST_ATOMIC },
        gathering: { bioLandscape: false, depositSize: GOLD_DEPOSIT_UNITS, depositLevels: MINE_LEVELS },
      },
      {
        typeId: GOOD_MUSHROOM,
        id: 'mushroom',
        ...localName('mushroom'),
        weight: 1,
        atomics: { harvest: MUSHROOM_HARVEST_ATOMIC },
        gathering: { bioLandscape: true },
      },
      // The rest of the original catalog — food, drink, building materials, tools, crafted wares, weapons,
      // armor, potions, amulets, and the animal/vehicle/special tokens (see catalog/goods.ts). They carry no
      // bespoke gathering/production yet; they exist so the whole catalog is globally available with a name,
      // a stock slot (the storable ones) and its `ls_goods` icon, and can be dropped on the ground. The
      // equippable ones (130–155) additionally carry their equip classification (slot + wear, from
      // EQUIP_GOODS, merged by typeId) so the selection panel can label/classify a worn item. The localized
      // name (when supplied) overrides the built-in English catalog `name`.
      ...EXTENDED_GOODS.map((g) => {
        const equip = EQUIP_CLASS_BY_TYPE.get(g.typeId);
        return {
          typeId: g.typeId,
          id: g.id,
          name: extras.goodNames?.get(g.id) ?? g.name,
          weight: 1,
          ...(equip !== undefined ? { equip } : {}),
          // Wheat is the FIELD-FARMED good: its plant/cultivate/harvest atomics are the original's own
          // ids (`goodtypes.ini` wheat 34/35/29) and the farming block carries the loop calibration
          // (catalog/farming.ts) — what makes the farm's workers run the sow→water→reap field loop.
          ...(g.typeId === GOOD_WHEAT
            ? {
                atomics: {
                  harvest: WHEAT_HARVEST_ATOMIC,
                  cultivate: CULTIVATE_ATOMIC,
                  plant: PLANT_ATOMIC,
                },
                farming: {
                  stages: WHEAT_GROWTH_STAGES,
                  ticksPerStage: WHEAT_TICKS_PER_STAGE,
                  yieldPerField: WHEAT_YIELD_PER_FIELD,
                  fieldRadius: FARM_FIELD_RADIUS,
                  fieldsBase: FARM_FIELDS_BASE,
                  fieldsPerFarmer: FARM_FIELDS_PER_FARMER,
                },
              }
            : {}),
        };
      }),
    ],
    jobs: [...jobs.values()],
    buildings: [...buildings.values()].sort((a, b) => a.typeId - b.typeId),
    landscape: sandboxLandscape(map),
    landscapeGfx: sandboxLandscapeGfx(),
    gatheringPipeline: sandboxGatheringPipeline(),
    weapons: sandboxWeapons(),
    tribes: [...tribes.values()],
    atomicAnimations: [
      ...GATHERERS.map((g) => ({
        id: g.animation,
        name: g.animation,
        length: HARVEST_TICKS[g.atomic] ?? 1,
      })),
      // The shared store-exchange pair (pickup 22 / pileup 23) — length 20, transcribed from the
      // original's per-class clips (see STORE_PICKUP_ATOMIC). Also the "inside the store" dwell time.
      { id: STORE_PICKUP_ANIMATION, name: STORE_PICKUP_ANIMATION, length: STORE_EXCHANGE_LENGTH },
      { id: STORE_PILEUP_ANIMATION, name: STORE_PILEUP_ANIMATION, length: STORE_EXCHANGE_LENGTH },
      // Each swing carries its mid-animation ATTACK event (the blow lands / the arrow looses THERE,
      // not at completion) — lengths + frames transcribed from the viking atomicanimations records.
      {
        id: 'viking_fist_attack',
        name: 'viking_fist_attack',
        length: FIST_SWING_LENGTH,
        events: [{ at: FIST_HIT_FRAME, type: ATTACK_EVENT_TYPE }],
      },
      {
        id: 'viking_spear_attack',
        name: 'viking_spear_attack',
        length: SPEAR_SWING_LENGTH,
        events: [{ at: SPEAR_HIT_FRAME, type: ATTACK_EVENT_TYPE }],
      },
      {
        id: 'viking_sword_attack',
        name: 'viking_sword_attack',
        length: SWORD_SWING_LENGTH,
        events: [{ at: SWORD_HIT_FRAME, type: ATTACK_EVENT_TYPE }],
      },
      {
        id: 'viking_broadsword_attack',
        name: 'viking_broadsword_attack',
        length: BROADSWORD_SWING_LENGTH,
        events: [{ at: BROADSWORD_HIT_FRAME, type: ATTACK_EVENT_TYPE }],
      },
      {
        id: 'viking_bow_attack',
        name: 'viking_bow_attack',
        length: SHORT_BOW_DRAW_LENGTH,
        events: [{ at: SHORT_BOW_RELEASE_FRAME, type: ATTACK_EVENT_TYPE }],
      },
      {
        id: 'viking_bow_long_attack',
        name: 'viking_bow_long_attack',
        length: LONG_BOW_DRAW_LENGTH,
        events: [{ at: LONG_BOW_RELEASE_FRAME, type: ATTACK_EVENT_TYPE }],
      },
      // The builder's hammer swing — its length is what paces each construct swing (see above).
      { id: BUILD_HOUSE_ANIMATION, name: BUILD_HOUSE_ANIMATION, length: BUILD_HOUSE_SWING_LENGTH },
      // The farmer's field swings — the transcribed original lengths pace each sow/water/reap.
      { id: FARMER_REAP_ANIMATION, name: FARMER_REAP_ANIMATION, length: FARMER_REAP_LENGTH },
      { id: FARMER_SOW_ANIMATION, name: FARMER_SOW_ANIMATION, length: FARMER_SOW_LENGTH },
      { id: FARMER_WATER_ANIMATION, name: FARMER_WATER_ANIMATION, length: FARMER_WATER_LENGTH },
    ],
  });
}
