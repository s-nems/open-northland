import type { Entity, Fixed, Simulation } from '@open-northland/sim';
import { components, fx } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_SCOUT, JOB_WOMAN } from '../catalog/jobs.js';
import { placeSandboxBuilding, spawnSettlerDirect } from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

const MAP_W = 26;
const MAP_H = 12;

const HOME_REF = 'home_level_02';
const HOME = { x: 18, y: 5 } as const;
/** A predicted id: `build` creates the couple as entities 1 and 2 directly, and the enqueued
 *  `placeBuilding` adds entity 3 on tick 0, while `assignHouse` must name the home before then. */
const HOME_ENTITY = 3 as Entity;
const WIFE_ENTITY = 1 as Entity;
const SCOUT_ENTITY = 2 as Entity;

const WIFE = { x: 14, y: 5 } as const;
/** Beside his own door, so a scout that still went home to bed would step straight in. */
const SCOUT = { x: 17, y: 7 } as const;
/** Past the drive threshold: he lies down on his first plan. */
const TIRED: Fixed = fx.div(fx.fromInt(9), fx.fromInt(10));

/** Two outdoor naps of the civilist clip, with room to walk between them. */
const RUN_TICKS = 600;
const INITIAL_ZOOM = 1.2;

const { ChildOrder, Female, MakingLove, Marriage, Residence, Resting, SettlerNeeds } = components;

/** A worker who married, moved in and then became a scout: he keeps the house but never comes home. */
function build(sim: Simulation): void {
  const wife = spawnSettlerDirect(sim, JOB_WOMAN, WIFE.x, WIFE.y);
  const scout = spawnSettlerDirect(sim, JOB_SCOUT, SCOUT.x, SCOUT.y);
  sim.world.add(wife, Marriage, { spouse: scout, child: null });
  sim.world.add(scout, Marriage, { spouse: wife, child: null });
  sim.world.mut(scout, SettlerNeeds).fatigue = TIRED;
  placeSandboxBuilding(sim, HOME_REF, HOME.x, HOME.y);
  sim.enqueueSetup({ kind: 'assignHouse', entity: wife, house: HOME_ENTITY });
  sim.enqueueSetup({ kind: 'makeChild', entity: wife, child: 'female' });
}

export const familyAwayScene: SceneDefinition = {
  id: 'family-away',
  seed: 12,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  needs: true,
  runTicks: RUN_TICKS,
  initialZoom: INITIAL_ZOOM,
  checks: [
    {
      label: 'the couple shares the predicted home, the wife holding the order',
      predicate: (sim) =>
        sim.world.has(WIFE_ENTITY, Female) &&
        sim.world.tryGet(WIFE_ENTITY, Residence)?.home === HOME_ENTITY &&
        sim.world.tryGet(SCOUT_ENTITY, Residence)?.home === HOME_ENTITY,
    },
    {
      label: "the child order waits, recording that the husband's trade never comes home",
      predicate: (sim) =>
        sim.world.tryGet(WIFE_ENTITY, ChildOrder)?.blocked === 'husbandAway' &&
        !sim.world.has(HOME_ENTITY, MakingLove),
    },
    {
      label: 'the scout slept off his fatigue outside, never stepping into the house',
      predicate: (sim) =>
        sim.world.tryGet(SCOUT_ENTITY, Resting)?.at !== HOME_ENTITY &&
        sim.world.get(SCOUT_ENTITY, SettlerNeeds).fatigue < TIRED,
    },
  ],
};
