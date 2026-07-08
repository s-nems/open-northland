import { type BuildingFootprint, type ContentSet, IR_VERSION, parseContentSet } from '@vinland/data';
import type { TerrainMap } from '@vinland/sim';
import {
  CLAY_HARVEST_ATOMIC,
  GOLD_HARVEST_ATOMIC,
  HARVEST_ATOMIC,
  IRON_HARVEST_ATOMIC,
  MUSHROOM_HARVEST_ATOMIC,
  STONE_HARVEST_ATOMIC,
} from '../../catalog/atomics.js';
import { GRASS, HOME_KIND, VIKING_BUILDINGS, type VikingBuilding } from '../../catalog/buildings.js';
import { WOOD_CHOPS_TO_FELL, WOOD_YIELD_PER_NODE } from '../../catalog/felling.js';
import {
  CLAY_DEPOSIT_UNITS,
  GOLD_DEPOSIT_UNITS,
  IRON_DEPOSIT_UNITS,
  MINE_LEVELS,
  STONE_DEPOSIT_UNITS,
} from '../../catalog/mining.js';
import { HARVEST_TICKS } from '../../content/settler-gfx.js';
import type { GoodRef } from '../../content/settler-gfx.js';
import { PRIMARY_TRIBE } from '../rules.js';
import {
  BUILDING_HEADQUARTERS,
  BUILDING_JOINERY,
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
  JOB_CARRIER,
  JOB_GATHERER_WOOD,
  JOB_IDLE,
  JOB_SOLDIER_SWORD,
  WEAPON_LONG_BOW,
  WEAPON_SHORT_BOW,
  WEAPON_SWORD,
} from './ids.js';

/**
 * The ONE global sandbox {@link ContentSet} — goods/jobs/buildings/weapons/animation bindings — every
 * scene and the vertical slice consume (they never define their own content; packages/app/AGENTS.md).
 * The package splits by concern: semantic ids + the {@link GATHERERS} table in `./ids.ts`,
 * world-population helpers in `./place.ts`, scene-check queries beside the scenes
 * (`scenes/sandbox-queries.ts`); this module only assembles the validated content set.
 */

/** The attack atomic (81) both soldier jobs bind: the swordsman's swing and the archer's bow draw. */
const ATTACK_ATOMIC = 81;
/** Munition type 1 = arrow — what the bows fire. */
const ARROW_MUNITION = 1;
/** The ranged weapon main-type (projectile weapons). */
const RANGED_MAIN_TYPE = 6;
/** The real short/long-bow projectile speed. */
const BOW_SPEED = 8;
const BOW_DAMAGE = 34;
const SWORD_DAMAGE = 40;
/** ATTACK event type (25): the frame a bow draw looses its arrow. */
const ATTACK_EVENT_TYPE = 25;
/** The sword swing plays over 4 frames and lands at completion (no mid-swing event). */
const SWORD_SWING_LENGTH = 4;
/** The bow draw plays over 12 frames; the arrow is loosed at the release frame (6), mid-draw, not at completion. */
const BOW_DRAW_LENGTH = 12;
const BOW_RELEASE_FRAME = 6;

export interface SandboxContentExtras {
  readonly buildings?: readonly { typeId: number; id: string; kind?: string }[];
  readonly jobs?: readonly { typeId: number; id: string }[];
  readonly tribes?: readonly { typeId: number; id: string }[];
  /**
   * Extracted building ground footprints by typeId (from `content/ir.json` via
   * {@link import('../../content/ir.js').buildingFootprints}). When supplied — the live real-content
   * entries do so — a building gains its collision body / build-exclusion zone, so `placeBuilding` is
   * blocked where it doesn't fit and the build overlay greys those tiles. Omitted (tests, scenes, a bare
   * checkout with no `content/`) leaves every building footprint-less: the pre-footprint free placement.
   */
  readonly buildingFootprints?: ReadonlyMap<number, BuildingFootprint>;
}

const BASE_LANDSCAPE = [
  { typeId: GRASS, id: 'grass', walkable: true, buildable: true },
  { typeId: 1, id: 'water', walkable: false, buildable: false },
] as const;

const HOME_UPGRADE_PIN: readonly { goodType: number; amount: number }[] = [
  { goodType: GOOD_NONE, amount: 1 },
];

const RESOURCE_LANDSCAPE_BASE = 1000;
const RESOURCE_GFX_BASE = 2000;

const STORE_STOCK = [
  { goodType: GOOD_WOOD, capacity: 1_000_000, initial: 0 },
  { goodType: GOOD_PLANK, capacity: 1_000_000, initial: 0 },
  { goodType: GOOD_STONE, capacity: 1_000_000, initial: 0 },
  { goodType: GOOD_MUD, capacity: 1_000_000, initial: 0 },
  { goodType: GOOD_IRON, capacity: 1_000_000, initial: 0 },
  { goodType: GOOD_GOLD, capacity: 1_000_000, initial: 0 },
  { goodType: GOOD_MUSHROOM, capacity: 1_000_000, initial: 0 },
] as const;

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

function walkBlockAreas(g: GathererSpec): number[][] {
  const state = landscapeState(g);
  if (g.good === GOOD_MUD || g.mode === 'pick') return [];
  return [[state, 0, 0, 1]];
}

function buildBlockAreas(g: GathererSpec): number[][] {
  const state = landscapeState(g);
  if (g.good === GOOD_MUD || g.mode === 'pick') return [];
  return [
    [state, -1, 0, 1],
    [state, 0, 0, 1],
    [state, 1, 0, 1],
  ];
}

function workAreas(g: GathererSpec): number[][] {
  const state = landscapeState(g);
  if (g.mode === 'pick') return [[1, 0, 0, 1]];
  if (g.good === GOOD_MUD) {
    return [
      [state, -1, 0, 1],
      [state, 0, 0, 1],
      [state, 1, 0, 1],
    ];
  }
  return [
    [state, -1, 0, 1],
    [state, 1, 0, 1],
  ];
}

function sandboxLandscape(
  map?: TerrainMap,
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

export function sandboxWalkableTypeIds(map?: TerrainMap): ReadonlySet<number> {
  return new Set(
    sandboxLandscape(map)
      .filter((t) => t.walkable)
      .map((t) => t.typeId),
  );
}

export function sandboxGoods(): readonly GoodRef[] {
  return sandboxContent().goods.map((g) => ({ typeId: g.typeId, id: g.id }));
}

export function sandboxContent(map?: TerrainMap, extras: SandboxContentExtras = {}): ContentSet {
  const footprintOf = (typeId: number): { footprint: BuildingFootprint } | Record<string, never> => {
    const fp = extras.buildingFootprints?.get(typeId);
    return fp !== undefined ? { footprint: fp } : {};
  };
  const buildings = new Map<number, SandboxBuildingRow>();
  for (const b of VIKING_BUILDINGS) buildings.set(b.typeId, { ...buildingRow(b), ...footprintOf(b.typeId) });
  for (const b of extras.buildings ?? []) {
    if (!buildings.has(b.typeId)) {
      buildings.set(b.typeId, {
        typeId: b.typeId,
        id: b.id,
        kind: b.kind ?? 'workplace',
        ...footprintOf(b.typeId),
      });
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
    { typeId: JOB_SOLDIER_SWORD, id: 'soldier_sword', name: 'Miecznik' },
    { typeId: JOB_ARCHER, id: 'soldier_bow', name: 'Lucznik' },
  ]) {
    jobs.set(j.typeId, j);
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
      { jobType: JOB_SOLDIER_SWORD, atomicId: ATTACK_ATOMIC, animation: 'viking_sword_attack' },
      { jobType: JOB_ARCHER, atomicId: ATTACK_ATOMIC, animation: 'viking_bow_attack' },
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

  return parseContentSet({
    manifest: { version: IR_VERSION, generatedFrom: { game: 'vinland-global-sandbox' }, locale: 'eng' },
    goods: [
      { typeId: GOOD_NONE, id: 'none' },
      {
        typeId: GOOD_WOOD,
        id: 'wood',
        weight: 1,
        atomics: { harvest: HARVEST_ATOMIC },
        gathering: {
          bioLandscape: true,
          chopsToFell: WOOD_CHOPS_TO_FELL,
          yieldPerNode: WOOD_YIELD_PER_NODE,
        },
      },
      { typeId: GOOD_PLANK, id: 'plank', weight: 1 },
      { typeId: GOOD_COIN, id: 'coin' },
      {
        typeId: GOOD_STONE,
        id: 'stone',
        weight: 1,
        atomics: { harvest: STONE_HARVEST_ATOMIC },
        gathering: { bioLandscape: false, depositSize: STONE_DEPOSIT_UNITS, depositLevels: MINE_LEVELS },
      },
      {
        typeId: GOOD_MUD,
        id: 'mud',
        weight: 1,
        atomics: { harvest: CLAY_HARVEST_ATOMIC },
        gathering: { bioLandscape: false, depositSize: CLAY_DEPOSIT_UNITS, depositLevels: MINE_LEVELS },
      },
      {
        typeId: GOOD_IRON,
        id: 'iron',
        weight: 1,
        atomics: { harvest: IRON_HARVEST_ATOMIC },
        gathering: { bioLandscape: false, depositSize: IRON_DEPOSIT_UNITS, depositLevels: MINE_LEVELS },
      },
      {
        typeId: GOOD_GOLD,
        id: 'gold',
        weight: 1,
        atomics: { harvest: GOLD_HARVEST_ATOMIC },
        gathering: { bioLandscape: false, depositSize: GOLD_DEPOSIT_UNITS, depositLevels: MINE_LEVELS },
      },
      {
        typeId: GOOD_MUSHROOM,
        id: 'mushroom',
        weight: 1,
        atomics: { harvest: MUSHROOM_HARVEST_ATOMIC },
        gathering: { bioLandscape: true },
      },
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
        typeId: WEAPON_SWORD,
        id: 'viking_sword',
        tribeType: PRIMARY_TRIBE,
        jobType: JOB_SOLDIER_SWORD,
        minRange: 1,
        maxRange: 1,
        damage: { '0': SWORD_DAMAGE },
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
        jobType: JOB_ARCHER,
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
      { id: 'viking_sword_attack', name: 'viking_sword_attack', length: SWORD_SWING_LENGTH },
      {
        id: 'viking_bow_attack',
        name: 'viking_bow_attack',
        length: BOW_DRAW_LENGTH,
        events: [{ at: BOW_RELEASE_FRAME, type: ATTACK_EVENT_TYPE }],
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

/**
 * Per-building sandbox behaviour overrides, keyed by typeId — a DATA table, so {@link buildingRow}
 * stays a pure spread and a new special building means a new row here, not another branch. (The
 * clean-room catalog stays pinned to ir.json; these stock/recipe pins are sandbox balance, not
 * extracted data.)
 */
const BUILDING_OVERRIDES: Readonly<Record<number, Partial<SandboxBuildingRow>>> = {
  [BUILDING_HEADQUARTERS]: { stock: STORE_STOCK },
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
  return {
    typeId: b.typeId,
    id: b.id,
    kind: b.kind,
    ...(b.kind === HOME_KIND ? { construction: HOME_UPGRADE_PIN } : {}),
    ...BUILDING_OVERRIDES[b.typeId],
  };
}
