import { type BuildingFootprint, type ContentSet, IR_VERSION, parseContentSet } from '@vinland/data';
import { type Component, type Simulation, type TerrainMap, components, fx, systems } from '@vinland/sim';
import {
  GRASS,
  HOME_KIND,
  VIKING_BUILDINGS,
  type VikingBuilding,
  resolveVikingBuilding,
} from '../catalog/buildings.js';
import { WOOD_CHOPS_TO_FELL, WOOD_YIELD_PER_NODE } from '../catalog/felling.js';
import {
  CLAY_DEPOSIT_UNITS,
  GOLD_DEPOSIT_UNITS,
  IRON_DEPOSIT_UNITS,
  MINE_LEVELS,
  STONE_DEPOSIT_UNITS,
} from '../catalog/mining.js';
import {
  CLAY_HARVEST_ATOMIC,
  GOLD_HARVEST_ATOMIC,
  HARVEST_ATOMIC,
  HARVEST_TICKS,
  IRON_HARVEST_ATOMIC,
  MUSHROOM_HARVEST_ATOMIC,
  STONE_HARVEST_ATOMIC,
} from '../content/settler-gfx.js';
import type { GoodRef } from '../content/settler-gfx.js';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from './rules.js';

const { Felling, Health, MineDeposit, Owner, Position, Resource, Settler, Stockpile, Stump } = components;

export const GOOD_NONE = 0;
export const GOOD_WOOD = 1;
export const GOOD_PLANK = 2;
export const GOOD_COIN = 3;
export const GOOD_STONE = 4;
export const GOOD_MUD = 5;
export const GOOD_IRON = 6;
export const GOOD_GOLD = 7;
export const GOOD_MUSHROOM = 8;

export const JOB_IDLE = 0;
export const JOB_GATHERER_WOOD = 20;
export const JOB_GATHERER_STONE = 21;
export const JOB_GATHERER_MUD = 22;
export const JOB_GATHERER_IRON = 23;
export const JOB_GATHERER_GOLD = 24;
export const JOB_GATHERER_MUSHROOM = 25;
export const JOB_CARRIER = 36;
export const JOB_SOLDIER_SWORD = 34;
export const JOB_ARCHER = 40;

export const BUILDING_HEADQUARTERS = 1;
export const BUILDING_JOINERY = 23;

export const WEAPON_SWORD = 7;
export const WEAPON_SHORT_BOW = 20;
export const WEAPON_LONG_BOW = 21;

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

export type GatherMode = 'fell' | 'mine' | 'pick';

export interface GathererSpec {
  readonly good: number;
  readonly id: string;
  readonly job: number;
  readonly label: string;
  readonly atomic: number;
  readonly animation: string;
  readonly mode: GatherMode;
  readonly nodes: number;
  readonly depositUnits?: number;
  readonly depositLevels?: number;
}

export const GATHERERS: readonly GathererSpec[] = [
  {
    good: GOOD_WOOD,
    id: 'wood',
    job: JOB_GATHERER_WOOD,
    label: 'Zbieracz (Drewno)',
    atomic: HARVEST_ATOMIC,
    animation: 'viking_collector_harvest_tree',
    mode: 'fell',
    nodes: 2,
  },
  {
    good: GOOD_STONE,
    id: 'stone',
    job: JOB_GATHERER_STONE,
    label: 'Zbieracz (Kamien)',
    atomic: STONE_HARVEST_ATOMIC,
    animation: 'viking_collector_harvest_stone',
    mode: 'mine',
    nodes: 1,
    depositUnits: STONE_DEPOSIT_UNITS,
    depositLevels: MINE_LEVELS,
  },
  {
    good: GOOD_MUD,
    id: 'mud',
    job: JOB_GATHERER_MUD,
    label: 'Zbieracz (Glina)',
    atomic: CLAY_HARVEST_ATOMIC,
    animation: 'viking_collector_harvest_mud',
    mode: 'mine',
    nodes: 1,
    depositUnits: CLAY_DEPOSIT_UNITS,
    depositLevels: MINE_LEVELS,
  },
  {
    good: GOOD_IRON,
    id: 'iron',
    job: JOB_GATHERER_IRON,
    label: 'Zbieracz (Zelazo)',
    atomic: IRON_HARVEST_ATOMIC,
    animation: 'viking_collector_harvest_iron',
    mode: 'mine',
    nodes: 1,
    depositUnits: IRON_DEPOSIT_UNITS,
    depositLevels: MINE_LEVELS,
  },
  {
    good: GOOD_GOLD,
    id: 'gold',
    job: JOB_GATHERER_GOLD,
    label: 'Zbieracz (Zloto)',
    atomic: GOLD_HARVEST_ATOMIC,
    animation: 'viking_collector_harvest_gold',
    mode: 'mine',
    nodes: 1,
    depositUnits: GOLD_DEPOSIT_UNITS,
    depositLevels: MINE_LEVELS,
  },
  {
    good: GOOD_MUSHROOM,
    id: 'mushroom',
    job: JOB_GATHERER_MUSHROOM,
    label: 'Zbieracz (Grzyby)',
    atomic: MUSHROOM_HARVEST_ATOMIC,
    animation: 'viking_collector_harvest_mushroom',
    mode: 'pick',
    nodes: 3,
  },
] as const;

export interface SandboxContentExtras {
  readonly buildings?: readonly { typeId: number; id: string; kind?: string }[];
  readonly jobs?: readonly { typeId: number; id: string }[];
  readonly tribes?: readonly { typeId: number; id: string }[];
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
  const buildings = new Map<number, ReturnType<typeof buildingRow>>();
  for (const b of VIKING_BUILDINGS) buildings.set(b.typeId, buildingRow(b));
  for (const b of extras.buildings ?? []) {
    if (!buildings.has(b.typeId)) {
      buildings.set(b.typeId, {
        typeId: b.typeId,
        id: b.id,
        kind: b.kind ?? 'workplace',
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

function buildingRow(b: VikingBuilding): {
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
} {
  return {
    typeId: b.typeId,
    id: b.id,
    kind: b.kind,
    ...(b.typeId === BUILDING_HEADQUARTERS ? { stock: STORE_STOCK } : {}),
    ...(b.typeId === BUILDING_JOINERY
      ? {
          workers: [{ jobType: JOB_GATHERER_WOOD, count: 1 }],
          stock: STORE_STOCK,
          recipe: {
            inputs: [{ goodType: GOOD_WOOD, amount: 1 }],
            outputs: [{ goodType: GOOD_PLANK, amount: 1 }],
            ticks: 20,
          },
        }
      : {}),
    ...(b.kind === HOME_KIND ? { construction: HOME_UPGRADE_PIN } : {}),
  };
}

export function placeSandboxBuilding(
  sim: Simulation,
  ref: number | string,
  x: number,
  y: number,
  owner: number = HUMAN_PLAYER,
): void {
  sim.enqueue({
    kind: 'placeBuilding',
    buildingType: resolveVikingBuilding(ref).typeId,
    x,
    y,
    tribe: PRIMARY_TRIBE,
    owner,
  });
}

export function spawnSandboxSettler(
  sim: Simulation,
  jobType: number,
  x: number,
  y: number,
  owner: number = HUMAN_PLAYER,
  opts: { readonly hitpoints?: number; readonly weaponTypeId?: number } = {},
): void {
  sim.enqueue({
    kind: 'spawnSettler',
    jobType,
    x,
    y,
    tribe: PRIMARY_TRIBE,
    owner,
    ...(opts.hitpoints !== undefined ? { hitpoints: opts.hitpoints } : {}),
    ...(opts.weaponTypeId !== undefined ? { weaponTypeId: opts.weaponTypeId } : {}),
  });
}

export function placeTree(sim: Simulation, x: number, y: number): void {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Resource, {
    goodType: GOOD_WOOD,
    remaining: WOOD_YIELD_PER_NODE,
    harvestAtomic: HARVEST_ATOMIC,
  });
  if (!systems.stampResourceFootprint(sim.world, sim.content, e, GOOD_WOOD)) {
    throw new Error('placeTree: missing resource footprint for wood');
  }
  sim.world.add(e, Felling, { chopsLeft: WOOD_CHOPS_TO_FELL });
}

export function placeDeposit(sim: Simulation, g: GathererSpec, x: number, y: number): void {
  const units = g.depositUnits ?? 0;
  const levels = g.depositLevels ?? 0;
  if (units <= 0) throw new Error(`placeDeposit: '${g.id}' needs positive depositUnits`);
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Resource, { goodType: g.good, remaining: units, harvestAtomic: g.atomic });
  if (!systems.stampResourceFootprint(sim.world, sim.content, e, g.good)) {
    throw new Error(`placeDeposit: missing resource footprint for ${g.id}`);
  }
  sim.world.add(e, MineDeposit, { initial: units, levels });
}

export function placePickNode(sim: Simulation, g: GathererSpec, x: number, y: number): void {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Resource, { goodType: g.good, remaining: 1, harvestAtomic: g.atomic });
  if (!systems.stampResourceFootprint(sim.world, sim.content, e, g.good)) {
    throw new Error(`placePickNode: missing resource footprint for ${g.id}`);
  }
}

export function placeFlag(sim: Simulation, x: number, y: number): void {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Stockpile, { amounts: new Map() });
}

export function expectedGatherYield(g: GathererSpec): number {
  if (g.mode === 'fell') return g.nodes * WOOD_YIELD_PER_NODE;
  if (g.mode === 'mine') return g.depositUnits ?? 0;
  return g.nodes;
}

export function flagGood(sim: Simulation, at: { x: number; y: number }, good: number): number {
  for (const e of sim.world.query(Stockpile)) {
    const p = sim.world.get(e, Position);
    if (fx.toInt(p.x) === at.x && fx.toInt(p.y) === at.y) {
      return sim.world.get(e, Stockpile).amounts.get(good) ?? 0;
    }
  }
  return 0;
}

export function countComponent<T>(sim: Simulation, component: Component<T>): number {
  let n = 0;
  for (const _ of sim.world.query(component)) n++;
  return n;
}

export function blueOwnedSettlers(sim: Simulation): number {
  let n = 0;
  for (const e of sim.world.query(Settler, Owner)) {
    if (sim.world.get(e, Owner).player === HUMAN_PLAYER) n++;
  }
  return n;
}

export function enemyLivingSettlers(sim: Simulation): number {
  let n = 0;
  for (const e of sim.world.query(Settler, Owner, Health)) {
    const owner = sim.world.get(e, Owner).player;
    if (owner !== HUMAN_PLAYER && sim.world.get(e, Health).hitpoints > 0) n++;
  }
  return n;
}

export function blueLivingSoldiers(sim: Simulation): number {
  let n = 0;
  for (const e of sim.world.query(Settler, Owner, Health)) {
    const settler = sim.world.get(e, Settler);
    if (
      sim.world.get(e, Owner).player === HUMAN_PLAYER &&
      settler.jobType === JOB_SOLDIER_SWORD &&
      sim.world.get(e, Health).hitpoints > 0
    ) {
      n++;
    }
  }
  return n;
}

export { Felling, MineDeposit, Resource, Stump };
