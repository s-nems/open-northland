import type { Entity, Simulation } from '@open-northland/sim';
import { cellAnchorNode, components } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_BUILDER, JOB_CIVILIST, JOB_COLLECTOR, JOB_JOINER, JOB_SOLDIER } from '../catalog/jobs.js';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from '../game/rules.js';
import {
  BUILDING_BARRACKS,
  BUILDING_WAREHOUSE_00,
  placeSandboxSite,
  spawnSandboxSettler,
  spawnSettlerDirect,
} from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

const MAP_W = 28;
const MAP_H = 18;
const DEPOT = { x: 14, y: 12 } as const;
/** Well over what both houses take of any one good. */
const DEPOT_STOCK = 50;
const BARRACKS_AT = { x: 8, y: 6 } as const;
const SCHOOL_AT = { x: 20, y: 6 } as const;
const BUILDERS = 6;
const CREW = { x: 14, y: 15 } as const;
const RECRUIT_AT = { x: 4, y: 14 } as const;
const PUPIL_AT = { x: 24, y: 14 } as const;
/** Left free for the player to send to a foundation by hand. */
const SPARE_AT = { x: 6, y: 14 } as const;
/** Both houses rise, then the recruit drills and the pupil takes its course, with slack. */
const RUN_TICKS = 8_000;

const { Building, Settler, SettlerProgress } = components;

/** Every good either house is built from, stocked in the depot: real content builds them from more
 *  than wood and stone. */
function constructionGoods(sim: Simulation, houses: readonly Entity[]): { good: number; amount: number }[] {
  const goods = new Set<number>();
  for (const house of houses) {
    const type = sim.world.get(house, Building).buildingType;
    for (const row of sim.content.buildings.find((b) => b.typeId === type)?.construction ?? [])
      goods.add(row.goodType);
  }
  return [...goods].sort((a, b) => a - b).map((good) => ({ good, amount: DEPOT_STOCK }));
}

function build(sim: Simulation): void {
  const barracks = placeSandboxSite(sim, BUILDING_BARRACKS, BARRACKS_AT.x, BARRACKS_AT.y);
  const school = placeSandboxSite(sim, 'school', SCHOOL_AT.x, SCHOOL_AT.y);
  const depot = cellAnchorNode(DEPOT.x, DEPOT.y);
  sim.enqueueSetup({
    kind: 'placeBuilding',
    buildingType: BUILDING_WAREHOUSE_00,
    x: depot.hx,
    y: depot.hy,
    tribe: PRIMARY_TRIBE,
    owner: HUMAN_PLAYER,
    force: true,
    initialGoods: constructionGoods(sim, [barracks, school]),
  });
  for (let i = 0; i < BUILDERS; i++) {
    spawnSandboxSettler(sim, JOB_BUILDER, CREW.x - 2 + (i % 5), CREW.y, HUMAN_PLAYER);
  }
  const recruit = spawnSettlerDirect(sim, JOB_CIVILIST, RECRUIT_AT.x, RECRUIT_AT.y);
  const pupil = spawnSettlerDirect(sim, JOB_COLLECTOR, PUPIL_AT.x, PUPIL_AT.y);
  spawnSettlerDirect(sim, JOB_CIVILIST, SPARE_AT.x, SPARE_AT.y);
  // Technology discovery has its own scene; the override precedes `learn` so the lesson is admitted.
  sim.enqueueSetup({ kind: 'setProfessionProgression', enabled: false });
  sim.enqueueSetup({ kind: 'trainSoldier', entity: recruit, house: barracks });
  sim.enqueueSetup({ kind: 'learn', entity: pupil, house: school, target: 'job', typeId: JOB_JOINER });
}

/** Query order is spawn order: the builders come from the setup queue, after these two. */
function cast(sim: Simulation): { recruit: Entity | undefined; pupil: Entity | undefined } {
  const [recruit, pupil] = sim.world.query(Settler);
  return { recruit, pupil };
}

export const learningFoundationsScene: SceneDefinition = {
  id: 'learning-foundations',
  seed: 29,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: RUN_TICKS,
  checks: [
    {
      label: 'the recruit sent to the barracks foundation drills once it stands and comes out a soldier',
      predicate: (sim) => {
        const { recruit } = cast(sim);
        return recruit !== undefined && sim.world.get(recruit, Settler).jobType === JOB_SOLDIER;
      },
    },
    {
      label: 'the pupil sent to the school foundation learns carpentry once it stands',
      predicate: (sim) => {
        const { pupil } = cast(sim);
        if (pupil === undefined) return false;
        const learned = sim.world.get(pupil, SettlerProgress).learned;
        return learned?.job.includes(JOB_JOINER) === true;
      },
    },
  ],
};
