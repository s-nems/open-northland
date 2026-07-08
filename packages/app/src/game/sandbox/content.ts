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
import { HOME_KIND, VIKING_BUILDINGS, type VikingBuilding } from '../../catalog/buildings.js';
import { WOOD_CHOPS_TO_FELL, WOOD_YIELD_PER_NODE } from '../../catalog/felling.js';
import { approximateFootprint } from '../../catalog/footprints.js';
import {
  CLAY_DEPOSIT_UNITS,
  GOLD_DEPOSIT_UNITS,
  IRON_DEPOSIT_UNITS,
  MINE_LEVELS,
  STONE_DEPOSIT_UNITS,
} from '../../catalog/mining.js';
import { TERRAIN_BLOCKED, TERRAIN_IMPASSABLE, TERRAIN_MARGIN, TERRAIN_OPEN } from '../../catalog/terrain.js';
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
  JOB_ARCHER_LONG,
  JOB_CARRIER,
  JOB_GATHERER_WOOD,
  JOB_IDLE,
  JOB_SOLDIER_BROADSWORD,
  JOB_SOLDIER_SPEAR,
  JOB_SOLDIER_SWORD,
  WEAPON_BROADSWORD,
  WEAPON_LONG_BOW,
  WEAPON_SHORT_BOW,
  WEAPON_SPEAR,
  WEAPON_SWORD,
} from './ids.js';

/**
 * The ONE global sandbox {@link ContentSet} — goods/jobs/buildings/weapons/animation bindings — every
 * scene and the vertical slice consume (they never define their own content; packages/app/AGENTS.md).
 * The package splits by concern: semantic ids + the {@link GATHERERS} table in `./ids.ts`,
 * world-population helpers in `./place.ts`, scene-check queries beside the scenes
 * (`scenes/sandbox-queries.ts`); this module only assembles the validated content set.
 */

/** The attack atomic (81) every soldier job binds: the melee swing / the archer's bow draw. */
const ATTACK_ATOMIC = 81;
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
    { typeId: JOB_SOLDIER_SPEAR, id: 'soldier_spear', name: 'Wlocznik' },
    { typeId: JOB_SOLDIER_SWORD, id: 'soldier_sword', name: 'Miecznik' },
    { typeId: JOB_SOLDIER_BROADSWORD, id: 'soldier_broadsword', name: 'Miecznik (dwureczny)' },
    { typeId: JOB_ARCHER, id: 'soldier_bow', name: 'Lucznik' },
    { typeId: JOB_ARCHER_LONG, id: 'soldier_bow_long', name: 'Lucznik (dlugi luk)' },
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
