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
/** Well past the drive threshold: an adult this hungry would drop everything and eat. */
const HUNGRY = fx.div(fx.fromInt(9), fx.fromInt(10));
/** Long enough for any eat drive to have walked one tile and run its clip several times over. */
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
  // None of the young get a Residence, so the child stroll never fires and they stand where they spawn.
  for (const station of [GIRL, BOY, BABY]) placeSandboxBerryBush(sim, station.x, ROW_Y);
  spawnYoung(sim, JOB_CHILD_FEMALE, GIRL.x, GIRL.y, CHILD_SPAWN_AGE_TICKS, HUNGRY);
  spawnYoung(sim, JOB_CHILD_MALE, BOY.x, BOY.y, CHILD_SPAWN_AGE_TICKS, HUNGRY);
  // The authored hunger is what makes the rule observable: nothing in play would raise a growing
  // settler's bar this far, because a growing settler's bars do not move at all.
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
  // Needs run, so the check proves the growing-settler rule rather than the scene default freezing them.
  needs: true,
  runTicks: RUN_TICKS,
  initialZoom: INITIAL_ZOOM,
  checks: [
    {
      label: 'no growing settler self-fed - all three still carry the hunger they were authored with',
      predicate: (sim) => {
        const { children, babies } = youngByStage(sim);
        const young = [...children, ...babies];
        return (
          children.length === 2 &&
          babies.length === 1 &&
          young.every((e) => sim.world.get(e, Settler).hunger === HUNGRY)
        );
      },
    },
    {
      label: 'every bush stayed ripe - a growing settler runs no eat drive, so none was foraged',
      predicate: (sim) => {
        let ripe = 0;
        for (const e of sim.world.query(BerryBush)) {
          if (sim.world.get(e, BerryBush).stage !== 'ripe') return false;
          ripe++;
        }
        return ripe === 3;
      },
    },
  ],
};
