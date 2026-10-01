import type { Entity, Simulation } from '@open-northland/sim';
import { components, fx } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import {
  JOB_ARCHER,
  JOB_BUILDER,
  JOB_CIVILIST,
  JOB_SOLDIER_SPEAR,
  JOB_SOLDIER_SWORD,
  JOB_WOMAN,
} from '../catalog/jobs.js';
import {
  spawnSettlerDirect,
  spawnVehicleDirect,
  VEHICLE_CATAPULT,
  VEHICLE_HANDCART,
  weaponEquipmentFor,
} from '../game/sandbox/index.js';
import { goodBySlug } from './sandbox-queries.js';
import type { SceneDefinition } from './types.js';

const MAP_W = 30;
const MAP_H = 24;
const INITIAL_ZOOM = 0.9;
const RUN_TICKS = 200;

/** One rank of the company: its trade, how many, the cell column it stands in from `firstRow`. */
interface Rank {
  readonly job: number;
  readonly count: number;
  readonly x: number;
  readonly armor?: string;
  /** Every n-th of the rank carries this bag, starting with the first. */
  readonly bag?: { readonly every: number; readonly goods: readonly string[] };
  /** Every n-th of the rank stands wounded, at `pct` of its pool. */
  readonly wounded?: { readonly every: number; readonly pct: number };
}

const FIRST_ROW = 6;
const RANKS: readonly Rank[] = [
  {
    job: JOB_ARCHER,
    count: 12,
    x: 9,
    armor: 'armor_leather',
    bag: { every: 2, goods: ['potion_heal_big', 'potion_food_small'] },
    wounded: { every: 4, pct: 40 },
  },
  {
    job: JOB_SOLDIER_SWORD,
    count: 8,
    x: 11,
    armor: 'armor_chain',
    bag: { every: 3, goods: ['potion_heal_small'] },
  },
  { job: JOB_SOLDIER_SPEAR, count: 6, x: 13, wounded: { every: 3, pct: 18 } },
  { job: JOB_BUILDER, count: 4, x: 16 },
  { job: JOB_WOMAN, count: 3, x: 18 },
  { job: JOB_CIVILIST, count: 2, x: 20 },
];
const CATAPULTS = [
  { x: 6, y: 8 },
  { x: 6, y: 13 },
] as const;
const HANDCART = { x: 22, y: 9 } as const;
const PERCENT = 100;

const { Equipment, Health } = components;

function outfit(sim: Simulation, e: Entity, rank: Rank, index: number): void {
  // A woman wears nothing; a builder spawned outside the command path has no inventory until given one.
  if (rank.job === JOB_WOMAN) return;
  if (!sim.world.has(e, Equipment)) {
    sim.world.add(e, Equipment, {
      boots: null,
      tool: null,
      weapon: null,
      armor: null,
      misc: Array.from({ length: components.MISC_EQUIP_SLOTS }, () => null),
    });
  }
  const equipment = sim.world.mut(e, Equipment);
  const slot = (slug: string) => ({ goodType: goodBySlug(sim, slug), degreeOfUse: fx.fromInt(0) });
  const weapon = weaponEquipmentFor(rank.job, sim.content.goods)?.weapon;
  if (weapon != null) equipment.weapon = { goodType: weapon.goodType, degreeOfUse: fx.fromInt(0) };
  if (rank.armor !== undefined) equipment.armor = slot(rank.armor);
  if (rank.job === JOB_BUILDER) equipment.tool = slot('tool_iron');
  if (rank.bag !== undefined && index % rank.bag.every === 0) {
    equipment.misc = [...rank.bag.goods.map(slot), ...equipment.misc.slice(rank.bag.goods.length)];
  }
}

function wound(sim: Simulation, e: Entity, rank: Rank, index: number): void {
  if (rank.wounded === undefined || index % rank.wounded.every !== 0) return;
  const health = sim.world.mut(e, Health);
  health.hitpoints = Math.max(1, Math.round((health.max * rank.wounded.pct) / PERCENT));
}

function build(sim: Simulation): void {
  for (const rank of RANKS) {
    for (let index = 0; index < rank.count; index++) {
      const e = spawnSettlerDirect(
        sim,
        rank.job,
        rank.x + (index % 2),
        FIRST_ROW + Math.floor(index / 2) * 2,
      );
      outfit(sim, e, rank, index);
      wound(sim, e, rank, index);
    }
  }
  for (const at of CATAPULTS) spawnVehicleDirect(sim, VEHICLE_CATAPULT, at.x, at.y);
  spawnVehicleDirect(sim, VEHICLE_HANDCART, HANDCART.x, HANDCART.y);
}

const SETTLERS = RANKS.reduce((sum, rank) => sum + rank.count, 0);

export const groupPanelScene: SceneDefinition = {
  id: 'group-panel',
  seed: 23,
  terrain: grassTerrain(MAP_W, MAP_H),
  needs: true,
  initialZoom: INITIAL_ZOOM,
  build,
  runTicks: RUN_TICKS,
  checks: [
    {
      label: 'the whole company stands: every settler and vehicle a marquee can take',
      predicate: (sim) =>
        [...sim.world.query(components.Settler)].length === SETTLERS &&
        [...sim.world.query(components.Vehicle)].length === CATAPULTS.length + 1,
    },
    {
      label: 'the wounded still stand wounded, so the group panel has someone to count',
      predicate: (sim) =>
        [...sim.world.query(Health, components.Settler)].some((e) => {
          const health = sim.world.get(e, Health);
          return health.hitpoints < health.max;
        }),
    },
  ],
};
