import {
  type BuildingFootprint,
  type ContentSet,
  type EquipCategory,
  IR_VERSION,
  parseContentSet,
} from '@vinland/data';
import {
  ATTACK_ATOMIC,
  CLAY_HARVEST_ATOMIC,
  GOLD_HARVEST_ATOMIC,
  HARVEST_ATOMIC,
  IRON_HARVEST_ATOMIC,
  MUSHROOM_HARVEST_ATOMIC,
  STONE_HARVEST_ATOMIC,
} from '../../catalog/atomics.js';
import { HOME_KIND, VIKING_BUILDINGS, type VikingBuilding } from '../../catalog/buildings.js';
import { WOOD_CHOPS_TO_FELL, WOOD_YIELD_PER_NODE } from '../../catalog/felling.js';
import { approximateFootprint } from '../../catalog/footprints.js';
import { EXTENDED_GOODS, STORABLE_EXTENDED_GOODS } from '../../catalog/goods.js';
import {
  CLAY_DEPOSIT_UNITS,
  GOLD_DEPOSIT_UNITS,
  IRON_DEPOSIT_UNITS,
  MINE_LEVELS,
  STONE_DEPOSIT_UNITS,
} from '../../catalog/mining.js';
import { PROFESSIONS } from '../../catalog/professions.js';
import { TERRAIN_BLOCKED, TERRAIN_IMPASSABLE, TERRAIN_MARGIN, TERRAIN_OPEN } from '../../catalog/terrain.js';
import { HARVEST_TICKS } from '../../content/settler-gfx.js';
import type { GoodRef } from '../../content/settler-gfx.js';
import { professionLabel } from '../../i18n/index.js';
import type { Messages } from '../../i18n/pl.js';
import { PRIMARY_TRIBE } from '../rules.js';
import {
  BUILDING_HEADQUARTERS,
  BUILDING_JOINERY,
  BUILDING_WAREHOUSE_00,
  BUILDING_WAREHOUSE_01,
  BUILDING_WAREHOUSE_02,
  EQUIP_GOODS,
  GATHERERS,
  GOOD_COIN,
  GOOD_GOLD,
  GOOD_IRON,
  GOOD_MUD,
  GOOD_MUSHROOM,
  GOOD_NONE,
  GOOD_PLANK,
  GOOD_STONE,
  GOOD_WOOD,
  type GathererSpec,
  JOB_ARCHER,
  JOB_ARCHER_LONG,
  JOB_CARRIER,
  JOB_GATHERER_WOOD,
  JOB_IDLE,
  JOB_SOLDIER_BROADSWORD,
  JOB_SOLDIER_SPEAR,
  JOB_SOLDIER_SWORD,
  JOB_SOLDIER_UNARMED,
  WEAPON_BROADSWORD,
  WEAPON_FISTS,
  WEAPON_LONG_BOW,
  WEAPON_SHORT_BOW,
  WEAPON_SPEAR,
  WEAPON_SWORD,
  rebaseSlotJob,
} from './ids.js';

/**
 * The ONE global sandbox {@link ContentSet} — goods/jobs/buildings/weapons/animation bindings — every
 * scene and the vertical slice consume (they never define their own content; packages/app/AGENTS.md).
 * The package splits by concern: semantic ids + the {@link GATHERERS} table in `./ids.ts`,
 * world-population helpers in `./place.ts`, scene-check queries beside the scenes
 * (`scenes/sandbox-queries.ts`); this module only assembles the validated content set.
 */

/** The one thing the sandbox landscape derivation reads off a terrain grid — its typeId lane.
 *  Structural, so both the authored CELL grids and the sim's half-cell maps satisfy it. */
export interface TerrainTypeIds {
  readonly typeIds: ReadonlyArray<number>;
}

/** Munition type 1 = arrow — what the bows fire. */
const ARROW_MUNITION = 1;
/** The ranged weapon main-type (projectile weapons). */
const RANGED_MAIN_TYPE = 6;
/** The real short/long-bow projectile speed. */
const BOW_SPEED = 8;
/** ATTACK event type (25): the frame a melee blow lands / a bow draw looses its arrow. */
const ATTACK_EVENT_TYPE = 25;
// Swing lengths + hit/release frames, TRANSCRIBED from the extracted viking `atomicanimations.ini`
// records (`viking_soldier_attack_*` — length + the `event <frame> 25`). The sim swing duration must
// equal the decoded gfx frame-list length (`[gfxanimatomic]` per-direction counts: sword 12, spear 27,
// broadsword 29, bows 12/28) or the DRAWN swing truncates mid-animation — the sandbox previously ran a
// made-up 4-tick sword swing against the 12-frame decoded swing, playing only its wind-up.
const FIST_SWING_LENGTH = 12; // viking_soldier_attack_unarmed
const FIST_HIT_FRAME = 6;
const SWORD_SWING_LENGTH = 12; // viking_soldier_attack_sword_short
const SWORD_HIT_FRAME = 9;
const SPEAR_SWING_LENGTH = 27; // viking_soldier_attack_spear_iron
const SPEAR_HIT_FRAME = 17;
const BROADSWORD_SWING_LENGTH = 29; // viking_soldier_attack_sword_long
const BROADSWORD_HIT_FRAME = 16;
const SHORT_BOW_DRAW_LENGTH = 12; // viking_soldier_attack_bow_short
const SHORT_BOW_RELEASE_FRAME = 10;
const LONG_BOW_DRAW_LENGTH = 28; // viking_soldier_attack_bow_long
const LONG_BOW_RELEASE_FRAME = 22;
// Damage on the sandbox's own synthetic scale (the real per-material tables live in the extracted
// content; scene hitpoints are chosen so a duel takes several full swings — see the combat scene).
const BOW_DAMAGE = 34;
const SWORD_DAMAGE = 40;
const SPEAR_DAMAGE = 45;
const BROADSWORD_DAMAGE = 55;
// The fist is the weakest strike — a quarter of the short sword's, matching weapons.ini's fist
// damagevalue 0 (400) vs the short sword's (1600). Keeps the unarmed warrior a real but feeble brawler.
const FIST_DAMAGE = 10;

/** The equip classification (slot + wear) per good typeId, so `sandboxContent()` can merge it onto the
 *  global catalog good of the same typeId (an equippable good is declared ONCE, in `EXTENDED_GOODS`). */
const EQUIP_CLASS_BY_TYPE: ReadonlyMap<number, { category: EquipCategory; wears: boolean }> = new Map(
  EQUIP_GOODS.map((g) => [g.typeId, { category: g.category, wears: g.wears }]),
);

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
   * {@link approximateFootprint} instead, so placement collision + the build overlay work globally.
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

// The semantic terrain-class rows (see catalog/terrain.ts — the shared vocabulary scene grids are
// authored in and `content/collision.ts` resolves real maps into). Row ids keep the authored-scene
// reading: sandbox typeId 1 IS water; a resolved real map lands other impassable ground there too.
const BASE_LANDSCAPE = [
  { typeId: TERRAIN_OPEN, id: 'grass', walkable: true, buildable: true },
  { typeId: TERRAIN_IMPASSABLE, id: 'water', walkable: false, buildable: false },
  { typeId: TERRAIN_BLOCKED, id: 'landscape_body', walkable: false, buildable: false },
  { typeId: TERRAIN_MARGIN, id: 'landscape_margin', walkable: true, buildable: false },
] as const;

const HOME_UPGRADE_PIN: readonly { goodType: number; amount: number }[] = [
  { goodType: GOOD_NONE, amount: 1 },
];

const RESOURCE_LANDSCAPE_BASE = 1000;
const RESOURCE_GFX_BASE = 2000;

/** The per-good sandbox stock capacity — a huge balance pin (not extracted data) so a store never fills. */
const STORE_CAPACITY = 1_000_000;

/** A store slot: how much of one good a general-goods building may hold, and its starting amount. */
interface StockSlot {
  readonly goodType: number;
  readonly capacity: number;
  readonly initial: number;
}

/**
 * The general-goods store stock — the core economy goods (the gathered set + plank + coin) followed by every
 * storable extended ware from {@link STORABLE_EXTENDED_GOODS}, so the HQ and warehouses advertise a slot for
 * the WHOLE catalog and the Magazyn panel lists each good (with its icon) across its category tab. The stock
 * SET (which goods a store holds) and the flat capacity are a sandbox balance pin, not extracted data.
 */
const STORE_STOCK: readonly StockSlot[] = [
  GOOD_WOOD,
  GOOD_PLANK,
  GOOD_COIN,
  GOOD_STONE,
  GOOD_MUD,
  GOOD_IRON,
  GOOD_GOLD,
  GOOD_MUSHROOM,
  ...STORABLE_EXTENDED_GOODS.map((g) => g.typeId),
].map((goodType) => ({ goodType, capacity: STORE_CAPACITY, initial: 0 }));

function resourceLandscapeType(good: number): number {
  return RESOURCE_LANDSCAPE_BASE + good;
}

function resourceGfxIndex(good: number): number {
  return RESOURCE_GFX_BASE + good;
}

/** Fill-state count for a bio (non-deposit) resource — trees/mushrooms cycle through this many gfx states. */
const BIO_LANDSCAPE_STATES = 3;

function landscapeState(g: GathererSpec): number {
  return Math.max(1, g.depositLevels ?? BIO_LANDSCAPE_STATES);
}

// The invented resource areas below are HALF-CELL node offsets (`[state, dx, dy, run]`, the real
// block-area grammar) — their extents are DOUBLED versus the old cell-unit values, the same
// world-extent-preserving ×2 every invented extent got in the half-cell migration, so a sandbox
// tree keeps its one-CELL build ring and its harvesters keep their one-CELL stand distance.

function walkBlockAreas(g: GathererSpec): number[][] {
  const state = landscapeState(g);
  if (g.good === GOOD_MUD || g.mode === 'pick') return [];
  return [[state, 0, 0, 1]];
}

function buildBlockAreas(g: GathererSpec): number[][] {
  const state = landscapeState(g);
  if (g.good === GOOD_MUD || g.mode === 'pick') return [];
  return [[state, -2, 0, 5]]; // dx −2..+2 — the one-cell no-build ring, as a single 5-node run
}

function workAreas(g: GathererSpec): number[][] {
  const state = landscapeState(g);
  if (g.mode === 'pick') return [[1, 0, 0, 1]];
  if (g.good === GOOD_MUD) {
    return [
      [state, -2, 0, 1],
      [state, 0, 0, 1],
      [state, 2, 0, 1],
    ];
  }
  return [
    [state, -2, 0, 1],
    [state, 2, 0, 1],
  ];
}

function sandboxLandscape(
  map?: TerrainTypeIds,
): Array<{ typeId: number; id: string; walkable: boolean; buildable: boolean }> {
  const base = [
    ...BASE_LANDSCAPE,
    ...GATHERERS.map((g) => ({
      typeId: resourceLandscapeType(g.good),
      id: `${g.id}_harvest_node`,
      walkable: true,
      buildable: true,
    })),
  ];
  if (map === undefined) return base;
  const covered = new Set(base.map((t) => t.typeId));
  const extra = [...new Set(map.typeIds)].filter((id) => !covered.has(id)).sort((a, b) => a - b);
  return [
    ...base,
    ...extra.map((id) => ({ typeId: id, id: `terrain_${id}`, walkable: true, buildable: true })),
  ];
}

export function sandboxWalkableTypeIds(map?: TerrainTypeIds): ReadonlySet<number> {
  return new Set(
    sandboxLandscape(map)
      .filter((t) => t.walkable)
      .map((t) => t.typeId),
  );
}

export function sandboxGoods(): readonly GoodRef[] {
  return sandboxContent().goods.map((g) => ({ typeId: g.typeId, id: g.id }));
}

export function sandboxContent(map?: TerrainTypeIds, extras: SandboxContentExtras = {}): ContentSet {
  // Real extracted footprints (live content) replace the clean-room approximations WHOLESALE — see
  // SandboxContentExtras.buildingFootprints. Without them every building approximates by class.
  const footprintOf = (typeId: number, kind: string): { footprint?: BuildingFootprint } => {
    const real = extras.buildingFootprints;
    const fp = real !== undefined ? real.get(typeId) : approximateFootprint(kind);
    return fp !== undefined ? { footprint: fp } : {};
  };
  const buildings = new Map<number, SandboxBuildingRow>();
  for (const b of VIKING_BUILDINGS) {
    buildings.set(b.typeId, { ...buildingRow(b), ...footprintOf(b.typeId, b.kind) });
  }
  for (const b of extras.buildings ?? []) {
    if (!buildings.has(b.typeId)) {
      const kind = b.kind ?? 'workplace';
      buildings.set(b.typeId, { typeId: b.typeId, id: b.id, kind, ...footprintOf(b.typeId, kind) });
    }
  }

  const jobs = new Map<number, { typeId: number; id: string; name?: string; allowedAtomics?: number[] }>();
  for (const j of [
    { typeId: JOB_IDLE, id: 'idle', name: 'Bezrobotny' },
    ...GATHERERS.map((g) => ({
      typeId: g.job,
      id: `gatherer_${g.id}`,
      name: g.label,
      allowedAtomics: [g.atomic],
    })),
    { typeId: JOB_CARRIER, id: 'carrier', name: 'Tragarz' },
    { typeId: JOB_SOLDIER_UNARMED, id: 'soldier_unarmed', name: 'Wojownik (bez broni)' },
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

  const tribes = new Map<
    number,
    { typeId: number; id: string; jobEnables?: unknown[]; atomicBindings?: unknown[] }
  >();
  tribes.set(PRIMARY_TRIBE, {
    typeId: PRIMARY_TRIBE,
    id: 'viking',
    atomicBindings: [
      ...GATHERERS.map((g) => ({ jobType: g.job, atomicId: g.atomic, animation: g.animation })),
      { jobType: JOB_SOLDIER_UNARMED, atomicId: ATTACK_ATOMIC, animation: 'viking_fist_attack' },
      { jobType: JOB_SOLDIER_SPEAR, atomicId: ATTACK_ATOMIC, animation: 'viking_spear_attack' },
      { jobType: JOB_SOLDIER_SWORD, atomicId: ATTACK_ATOMIC, animation: 'viking_sword_attack' },
      { jobType: JOB_SOLDIER_BROADSWORD, atomicId: ATTACK_ATOMIC, animation: 'viking_broadsword_attack' },
      { jobType: JOB_ARCHER, atomicId: ATTACK_ATOMIC, animation: 'viking_bow_attack' },
      { jobType: JOB_ARCHER_LONG, atomicId: ATTACK_ATOMIC, animation: 'viking_bow_long_attack' },
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
        };
      }),
    ],
    jobs: [...jobs.values()],
    buildings: [...buildings.values()].sort((a, b) => a.typeId - b.typeId),
    landscape: sandboxLandscape(map),
    landscapeGfx: GATHERERS.map((g) => ({
      index: resourceGfxIndex(g.good),
      editName: `sandbox ${g.id} resource`,
      logicType: resourceLandscapeType(g.good),
      maxValency: landscapeState(g),
      isWorkable: true,
      walkBlockAreas: walkBlockAreas(g),
      buildBlockAreas: buildBlockAreas(g),
      workAreas: workAreas(g),
    })),
    gatheringPipeline: GATHERERS.map((g) => ({
      goodType: g.good,
      goodId: g.id,
      harvestAtomic: g.atomic,
      bioLandscape: g.mode !== 'mine',
      harvest: { landscapeType: resourceLandscapeType(g.good), gfxIndices: [resourceGfxIndex(g.good)] },
    })),
    weapons: [
      {
        typeId: WEAPON_FISTS,
        id: 'viking_fist',
        tribeType: PRIMARY_TRIBE,
        jobType: JOB_SOLDIER_UNARMED,
        minRange: 1,
        maxRange: 1,
        damage: { '0': FIST_DAMAGE },
      },
      {
        typeId: WEAPON_SPEAR,
        id: 'viking_spear',
        tribeType: PRIMARY_TRIBE,
        jobType: JOB_SOLDIER_SPEAR,
        minRange: 1,
        maxRange: 2, // a spear pokes one cell further than a sword (the original's long-melee band)
        damage: { '0': SPEAR_DAMAGE },
      },
      {
        typeId: WEAPON_SWORD,
        id: 'viking_sword',
        tribeType: PRIMARY_TRIBE,
        jobType: JOB_SOLDIER_SWORD,
        minRange: 1,
        maxRange: 1,
        damage: { '0': SWORD_DAMAGE },
      },
      {
        typeId: WEAPON_BROADSWORD,
        id: 'viking_broadsword',
        tribeType: PRIMARY_TRIBE,
        jobType: JOB_SOLDIER_BROADSWORD,
        minRange: 1,
        maxRange: 2, // the original's long sword reaches 1–2
        damage: { '0': BROADSWORD_DAMAGE },
      },
      {
        typeId: WEAPON_SHORT_BOW,
        id: 'viking_short_bow',
        tribeType: PRIMARY_TRIBE,
        jobType: JOB_ARCHER,
        mainType: RANGED_MAIN_TYPE,
        munitionType: ARROW_MUNITION,
        speed: BOW_SPEED,
        minRange: 3,
        maxRange: 15,
        damage: { '0': BOW_DAMAGE },
      },
      {
        typeId: WEAPON_LONG_BOW,
        id: 'viking_long_bow',
        tribeType: PRIMARY_TRIBE,
        jobType: JOB_ARCHER_LONG,
        mainType: RANGED_MAIN_TYPE,
        munitionType: ARROW_MUNITION,
        speed: BOW_SPEED,
        minRange: 4,
        maxRange: 23,
        damage: { '0': BOW_DAMAGE },
      },
    ],
    tribes: [...tribes.values()],
    atomicAnimations: [
      ...GATHERERS.map((g) => ({
        id: g.animation,
        name: g.animation,
        length: HARVEST_TICKS[g.atomic] ?? 1,
      })),
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
    ],
  });
}

interface SandboxBuildingRow {
  typeId: number;
  id: string;
  kind: string;
  stock?: typeof STORE_STOCK;
  construction?: typeof HOME_UPGRADE_PIN;
  recipe?: {
    inputs: readonly { goodType: number; amount: number }[];
    outputs: readonly { goodType: number; amount: number }[];
    ticks: number;
  };
  workers?: readonly { jobType: number; count: number }[];
  footprint?: BuildingFootprint;
}

/** A building's worker slots with their job ids rebased ({@link rebaseSlotJob}), or undefined for a
 *  building type that employs nobody (homes). */
function workerSlotsFor(typeId: number): readonly { jobType: number; count: number }[] | undefined {
  const slots = BUILDING_WORKER_SLOTS[typeId];
  return slots?.map((w) => ({ jobType: rebaseSlotJob(w.jobType), count: w.count }));
}

/**
 * Extracted worker-slot trades that map to a picker PROFESSION, keyed by their ORIGINAL `jobtypes.ini` id
 * (the pre-rebase id used in {@link BUILDING_WORKER_SLOTS}) → the shared profession `key`. The building
 * panel names each such worker via {@link professionLabel}, so a slot trade and the picker read the SAME
 * word — they used to be transcribed twice and drifted (joiner was "Cieśla" in the slot table but
 * "Stolarz" in the picker). Trades with no picker counterpart keep a slot-local name below.
 */
const WORKER_SLOT_PROFESSION_KEYS: Readonly<Record<number, keyof Messages['profession']>> = {
  9: 'joiner',
  10: 'armorer',
  11: 'potter',
  12: 'mason',
  13: 'smith',
  14: 'coin_maker',
  15: 'hunter',
  16: 'breeder',
  17: 'tailor', // jobtypes.ini "sewer"
  18: 'farmer',
  19: 'miller',
  20: 'baker',
  21: 'brewer',
  22: 'fisher',
  29: 'herbalist', // jobtypes.ini "herb & mush guy"
  30: 'druid',
};
/**
 * Slot-local Polish names for the worker-slot trades with NO picker profession: the generic `collector`
 * (8) the roster instead realizes as the concrete resource gatherers, and the two archer weapon classes
 * (40/41) the one-soldier picker folds into "Żołnierz" but a tower slot still lists by weapon.
 */
const WORKER_SLOT_LOCAL_NAMES: Readonly<Record<number, string>> = {
  8: 'Zbieracz', // collector
  40: 'Łucznik', // soldier_bow_short
  41: 'Łucznik (długi łuk)', // soldier_bow_long
};
/** The display name of an extracted worker-slot job, by its ORIGINAL id: the shared profession label
 *  where the trade has one (so it never drifts from the picker), else its slot-local name. The carrier
 *  (24 → {@link JOB_CARRIER}) is named 'Tragarz' where the job is defined, not here. */
function workerSlotName(originalJobType: number): string {
  const key = WORKER_SLOT_PROFESSION_KEYS[originalJobType];
  return key !== undefined ? professionLabel(key) : (WORKER_SLOT_LOCAL_NAMES[originalJobType] ?? 'Pracownik');
}

/**
 * Per-building WORKER + CARRIER capacity, by typeId — how many settlers of each job a building employs,
 * so `assignWorker` (and the JobSystem) can staff it and the door-badge shows one marker per worker.
 * Source basis: EXTRACTED from `ir.json`'s `workers`, i.e. the `logicworker` keys of each
 * `[logichousetype]` block in `DataCnmd/types/houses.ini`, verbatim — the counts and the worker/carrier
 * split are the original's. The `jobType`s here are the source's own `jobtypes.ini` ids and are REBASED
 * clear of the sandbox's own job band on the way in ({@link rebaseSlotJob}): the original ids overlap the
 * synthetic gatherer band (20..25), the carrier (26), and the soldier band (31..41), so e.g. original job
 * 22 would otherwise be read as the sandbox's MUD GATHERER and original 40/41 as ARCHERS — the bug that
 * let a "carpenter" slot fill with wood gatherers. The CARRIER job is the one exception: the original's
 * carrier (jobtype 24) is rebased to {@link JOB_CARRIER} (the one job the badge + assignment UI single out
 * as a hauler). Everything else becomes a distinct generic craftsman id (its trade identity is dropped —
 * the deferred global-content id unification); the COUNT and the carrier split — what the player assigns —
 * stay exact. Residences (homes) employ nobody; they carry no row. Kept as sandbox data (not the
 * clean-room catalog) because the rebase lives in the sandbox job space.
 */
const BUILDING_WORKER_SLOTS: Readonly<Record<number, readonly { jobType: number; count: number }[]>> = {
  1: [
    { jobType: JOB_CARRIER, count: 3 },
    { jobType: 8, count: 3 },
    { jobType: 22, count: 3 },
    { jobType: 15, count: 3 },
  ], // headquarters
  7: [
    { jobType: JOB_CARRIER, count: 3 },
    { jobType: 8, count: 3 },
    { jobType: 22, count: 3 },
    { jobType: 15, count: 3 },
  ], // stock_00
  8: [
    { jobType: JOB_CARRIER, count: 3 },
    { jobType: 8, count: 3 },
    { jobType: 22, count: 3 },
    { jobType: 15, count: 3 },
  ], // stock_01
  9: [
    { jobType: JOB_CARRIER, count: 3 },
    { jobType: 8, count: 3 },
    { jobType: 22, count: 3 },
    { jobType: 15, count: 3 },
  ], // stock_02
  10: [{ jobType: JOB_CARRIER, count: 1 }], // work_well_00
  11: [{ jobType: JOB_CARRIER, count: 1 }], // work_hive_00
  12: [
    { jobType: 18, count: 4 },
    { jobType: JOB_CARRIER, count: 1 },
  ], // work_farm_00
  13: [
    { jobType: 19, count: 2 },
    { jobType: JOB_CARRIER, count: 1 },
  ], // work_mill_00
  14: [
    { jobType: 20, count: 1 },
    { jobType: JOB_CARRIER, count: 1 },
  ], // work_bakery_00
  15: [
    { jobType: 20, count: 2 },
    { jobType: JOB_CARRIER, count: 1 },
  ], // work_bakery_01
  16: [
    { jobType: 21, count: 2 },
    { jobType: JOB_CARRIER, count: 1 },
  ], // work_brewery
  17: [
    { jobType: 16, count: 2 },
    { jobType: JOB_CARRIER, count: 1 },
  ], // work_animal_farm
  18: [
    { jobType: 17, count: 1 },
    { jobType: JOB_CARRIER, count: 1 },
  ], // work_sewery_00
  19: [
    { jobType: 17, count: 2 },
    { jobType: JOB_CARRIER, count: 1 },
  ], // work_sewery_01
  20: [
    { jobType: 11, count: 1 },
    { jobType: JOB_CARRIER, count: 1 },
    { jobType: 8, count: 1 },
  ], // work_pottery_00
  21: [
    { jobType: 11, count: 2 },
    { jobType: JOB_CARRIER, count: 1 },
    { jobType: 8, count: 2 },
  ], // work_pottery_01
  23: [
    { jobType: 9, count: 1 },
    { jobType: JOB_CARRIER, count: 1 },
    { jobType: 8, count: 1 },
  ], // work_joinery_00
  24: [
    { jobType: 9, count: 2 },
    { jobType: JOB_CARRIER, count: 1 },
    { jobType: 8, count: 1 },
  ], // work_joinery_01
  25: [
    { jobType: 9, count: 3 },
    { jobType: JOB_CARRIER, count: 1 },
    { jobType: 8, count: 1 },
  ], // work_joinery_02
  26: [
    { jobType: 9, count: 3 },
    { jobType: JOB_CARRIER, count: 1 },
    { jobType: 8, count: 1 },
  ], // work_joinery_03
  27: [
    { jobType: 10, count: 1 },
    { jobType: JOB_CARRIER, count: 1 },
    { jobType: 8, count: 1 },
  ], // work_armory_00
  28: [
    { jobType: 10, count: 2 },
    { jobType: JOB_CARRIER, count: 1 },
    { jobType: 8, count: 2 },
  ], // work_armory_01
  29: [
    { jobType: 12, count: 1 },
    { jobType: JOB_CARRIER, count: 1 },
    { jobType: 8, count: 1 },
  ], // work_mason_hut_00
  30: [
    { jobType: 12, count: 2 },
    { jobType: JOB_CARRIER, count: 1 },
    { jobType: 8, count: 1 },
  ], // work_mason_hut_01
  31: [
    { jobType: 13, count: 1 },
    { jobType: JOB_CARRIER, count: 1 },
    { jobType: 8, count: 2 },
  ], // work_smithy_00
  32: [
    { jobType: 13, count: 2 },
    { jobType: JOB_CARRIER, count: 1 },
    { jobType: 8, count: 2 },
  ], // work_smithy_01
  33: [
    { jobType: 14, count: 2 },
    { jobType: JOB_CARRIER, count: 1 },
    { jobType: 8, count: 2 },
  ], // work_coin_mint
  34: [
    { jobType: 29, count: 3 },
    { jobType: JOB_CARRIER, count: 1 },
  ], // work_herb_hut
  35: [
    { jobType: 30, count: 1 },
    { jobType: JOB_CARRIER, count: 1 },
    { jobType: 8, count: 1 },
  ], // work_druid_00
  36: [
    { jobType: 30, count: 2 },
    { jobType: JOB_CARRIER, count: 1 },
    { jobType: 8, count: 2 },
  ], // work_druid_01
  39: [{ jobType: JOB_CARRIER, count: 4 }], // barracks
  40: [
    { jobType: 40, count: 3 },
    { jobType: 41, count: 3 },
    { jobType: JOB_CARRIER, count: 3 },
  ], // tower_00
  41: [
    { jobType: 40, count: 4 },
    { jobType: 41, count: 4 },
    { jobType: JOB_CARRIER, count: 4 },
  ], // tower_01
};

/**
 * Per-building sandbox behaviour overrides, keyed by typeId — a DATA table, so {@link buildingRow}
 * stays a pure spread and a new special building means a new row here, not another branch. (The
 * clean-room catalog stays pinned to ir.json; these stock/recipe pins are sandbox balance, not
 * extracted data.) A `workers` here REPLACES the extracted {@link BUILDING_WORKER_SLOTS} default (the
 * joinery pins its own gatherer-fed plank producer for the production demo).
 */
const BUILDING_OVERRIDES: Readonly<Record<number, Partial<SandboxBuildingRow>>> = {
  [BUILDING_HEADQUARTERS]: { stock: STORE_STOCK },
  // The three warehouses accept the same general-goods set as the HQ (sandbox balance pin, not extracted
  // data) so the Magazyn section shows their storable goods instead of reading empty.
  [BUILDING_WAREHOUSE_00]: { stock: STORE_STOCK },
  [BUILDING_WAREHOUSE_01]: { stock: STORE_STOCK },
  [BUILDING_WAREHOUSE_02]: { stock: STORE_STOCK },
  [BUILDING_JOINERY]: {
    workers: [{ jobType: JOB_GATHERER_WOOD, count: 1 }],
    stock: STORE_STOCK,
    recipe: {
      inputs: [{ goodType: GOOD_WOOD, amount: 1 }],
      outputs: [{ goodType: GOOD_PLANK, amount: 1 }],
      ticks: 20,
    },
  },
};

function buildingRow(b: VikingBuilding): SandboxBuildingRow {
  const slots = workerSlotsFor(b.typeId);
  return {
    typeId: b.typeId,
    id: b.id,
    kind: b.kind,
    ...(b.kind === HOME_KIND ? { construction: HOME_UPGRADE_PIN } : {}),
    ...(slots !== undefined ? { workers: slots } : {}),
    ...BUILDING_OVERRIDES[b.typeId], // an override's `workers` (the joinery's demo) wins over the default
  };
}
