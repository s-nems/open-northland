import type { Entity, Fixed, Simulation } from '@open-northland/sim';
import { components, fx, systems } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_BABY_MALE, JOB_CHILD_FEMALE, JOB_CHILD_MALE } from '../catalog/jobs.js';
import { placeSandboxBerryBush, spawnSettlerDirect } from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

const MAP_W = 24;
const MAP_H = 10;
const ROW_Y = 6;
const GIRL = { x: 5, y: ROW_Y - 1 } as const;
const BOY = { x: 11, y: ROW_Y - 1 } as const;
const BABY = { x: 17, y: ROW_Y - 1 } as const;
/** Well past the eat threshold (¾·ONE), so both children seek food from tick 0. */
const HUNGRY = fx.div(fx.fromInt(9), fx.fromInt(10));
/** Past one walked tile and the eat clip, but under `BERRY_REGROW_TICKS` (1200), so the two foraged
 *  bushes are still bare at check time. */
const RUN_TICKS = 600;
const INITIAL_ZOOM = 1.2;
/** Squarely inside the child stage: past baby, well short of adulthood. */
const CHILD_SPAWN_AGE_TICKS = systems.CHILD_AGE_TICKS + 100;

const { Age, BerryBush, Settler } = components;

function spawnYoung(
  sim: Simulation,
  jobType: number,
  x: number,
  y: number,
  ageTicks: number,
  hunger: Fixed,
): Entity {
  const e = spawnSettlerDirect(sim, jobType, x, y);
  sim.world.add(e, Age, { ticks: ageTicks });
  sim.world.mut(e, Settler).hunger = hunger;
  return e;
}

function build(sim: Simulation): void {
  // None of the young get a Residence, so the child stroll never fires and they stand when not feeding.
  for (const station of [GIRL, BOY, BABY]) placeSandboxBerryBush(sim, station.x, ROW_Y);
  spawnYoung(sim, JOB_CHILD_FEMALE, GIRL.x, GIRL.y, CHILD_SPAWN_AGE_TICKS, HUNGRY);
  spawnYoung(sim, JOB_CHILD_MALE, BOY.x, BOY.y, CHILD_SPAWN_AGE_TICKS, HUNGRY);
  // The baby's hunger is authored: real play freezes a cared-for baby's needs, so the no-self-feed
  // gate would otherwise be unobservable.
  spawnYoung(sim, JOB_BABY_MALE, BABY.x, BABY.y, 0, HUNGRY);
}

function youngByStage(sim: Simulation): { children: Entity[]; babies: Entity[] } {
  const children: Entity[] = [];
  const babies: Entity[] = [];
  for (const e of sim.world.query(Age, Settler)) {
    if (systems.isChild(sim.world.get(e, Settler).jobType)) children.push(e);
    else babies.push(e);
  }
  return { children, babies };
}

export const childrenScene: SceneDefinition = {
  id: 'children',
  seed: 9,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: RUN_TICKS,
  initialZoom: INITIAL_ZOOM,
  checks: [
    {
      label: 'both children ended FED - the eat drive ran for them (the only food was their bushes)',
      predicate: (sim) => {
        const { children } = youngByStage(sim);
        // A berry is a partial meal: with needs frozen the fed bar sits exactly one
        // EAT_HUNGER_RESTORE below HUNGRY.
        const afterOneBerry = fx.sub(HUNGRY, systems.EAT_HUNGER_RESTORE);
        return (
          children.length === 2 && children.every((e) => sim.world.get(e, Settler).hunger === afterOneBerry)
        );
      },
    },
    {
      label: 'the hungry baby never self-fed - its authored hunger never moved (cared for, no eat drive)',
      predicate: (sim) => {
        const { babies } = youngByStage(sim);
        return babies.length === 1 && babies.every((e) => sim.world.get(e, Settler).hunger === HUNGRY);
      },
    },
    {
      label: "exactly the children's two bushes were foraged; the baby's stayed ripe",
      predicate: (sim) => {
        let bare = 0;
        let ripe = 0;
        for (const e of sim.world.query(BerryBush)) {
          if (sim.world.get(e, BerryBush).stage === 'ripe') ripe++;
          else bare++;
        }
        return bare === 2 && ripe === 1;
      },
    },
  ],
};
