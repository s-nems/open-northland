import type { Entity, Fixed, Simulation } from '@open-northland/sim';
import { components, fx, ONE, systems } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_CIVILIST, JOB_COLLECTOR, JOB_SOLDIER_UNARMED, JOB_WOMAN } from '../catalog/jobs.js';
import {
  GATHERERS,
  placeResourceNode,
  placeSandboxBerryBush,
  spawnSettlerDirect,
} from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

const MAP_W = 36;
const MAP_H = 12;

const CIRCLE = [
  { x: 4, y: 5 },
  { x: 7, y: 5 },
  { x: 5, y: 7 },
] as const;
const SOLDIER = { x: 3, y: 7 } as const;

const TREE = { x: 24, y: 4 } as const;
const WOODCUTTER = { x: 23, y: 4 } as const;
const WOMAN = { x: 19, y: 7 } as const;

const BUSH = { x: 32, y: 6 } as const;
const HUNGRY_SPOT = { x: 31, y: 6 } as const;
const SLEEPY_SPOT = { x: 33, y: 8 } as const;

/** The company bar spent whole: enjoyment `ONE` is fully lonely. */
const LONELY_WHOLE: Fixed = ONE;
/** Five percent of a bar under the seek threshold, so the woodcutter works for the run's first minute
 *  and crosses it with time left to walk over and chat. */
const ALMOST_LONELY: Fixed = fx.sub(systems.NEED_DRIVE_THRESHOLD, fx.div(ONE, fx.fromInt(20)));
/** Over the eat and sleep thresholds. */
const PRESSING: Fixed = fx.div(fx.fromInt(19), fx.fromInt(20));
/** End-of-run bound proving a settler chatted: without a chat the bar would sit pinned at ONE. */
const REFILLED: Fixed = fx.div(ONE, fx.fromInt(4));

/** Covers the woodcutter's chopping, his walk, and the several 247-tick rounds the circle needs: one
 *  exchange is worth 40% of a company bar, so a settler that starts fully lonely takes three of them. */
const RUN_TICKS = 2400;
const INITIAL_ZOOM = 0.9;

const { Settler } = components;

/** Authors every need, since the spawn's seeded random levels would blur the thresholds. */
function spawnActor(
  sim: Simulation,
  jobType: number,
  x: number,
  y: number,
  needs: { hunger?: Fixed; fatigue?: Fixed; enjoyment?: Fixed },
): Entity {
  const e = spawnSettlerDirect(sim, jobType, x, y);
  const s = sim.world.mut(e, Settler);
  s.hunger = needs.hunger ?? fx.fromInt(0);
  s.fatigue = needs.fatigue ?? fx.fromInt(0);
  s.piety = fx.fromInt(0);
  s.enjoyment = needs.enjoyment ?? fx.fromInt(0);
  return e;
}

function build(sim: Simulation): void {
  for (const spot of CIRCLE) spawnActor(sim, JOB_CIVILIST, spot.x, spot.y, { enjoyment: LONELY_WHOLE });
  spawnActor(sim, JOB_SOLDIER_UNARMED, SOLDIER.x, SOLDIER.y, { enjoyment: LONELY_WHOLE });

  const wood = GATHERERS.find((g) => g.id === 'wood');
  if (wood === undefined) throw new Error('gossip scene: no wood gatherer spec');
  placeResourceNode(sim, wood, TREE.x, TREE.y);
  spawnActor(sim, JOB_COLLECTOR, WOODCUTTER.x, WOODCUTTER.y, { enjoyment: ALMOST_LONELY });
  spawnActor(sim, JOB_WOMAN, WOMAN.x, WOMAN.y, { enjoyment: fx.div(ONE, fx.fromInt(2)) });

  placeSandboxBerryBush(sim, BUSH.x, BUSH.y);
  spawnActor(sim, JOB_CIVILIST, HUNGRY_SPOT.x, HUNGRY_SPOT.y, { hunger: PRESSING });
  spawnActor(sim, JOB_CIVILIST, SLEEPY_SPOT.x, SLEEPY_SPOT.y, { fatigue: PRESSING });
}

/** The `Settler` values of every settler working `jobType`. */
function ofJob(sim: Simulation, jobType: number): { enjoyment: Fixed; hunger: Fixed; fatigue: Fixed }[] {
  const out: { enjoyment: Fixed; hunger: Fixed; fatigue: Fixed }[] = [];
  for (const e of sim.world.query(Settler)) {
    const s = sim.world.get(e, Settler);
    if (s.jobType === jobType) out.push(s);
  }
  return out;
}

export const gossipScene: SceneDefinition = {
  id: 'gossip',
  seed: 21,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  needs: true,
  runTicks: RUN_TICKS,
  initialZoom: INITIAL_ZOOM,
  checks: [
    {
      label: 'every civilian chatted its company bar back down (started spent, ended refilled)',
      predicate: (sim) => {
        const civilians = ofJob(sim, JOB_CIVILIST);
        // The 3 circle members + the hungry and sleepy bubble settlers.
        return civilians.length === 5 && civilians.every((s) => s.enjoyment < REFILLED);
      },
    },
    {
      label: 'the woodcutter left his tree mid-run and chatted (bar would pin at ONE otherwise)',
      predicate: (sim) => {
        const cutters = ofJob(sim, JOB_COLLECTOR);
        return cutters.length === 1 && cutters.every((s) => s.enjoyment < fx.div(ONE, fx.fromInt(2)));
      },
    },
    {
      label: 'the soldier never chatted - his frozen company bar is still spent whole (forbidatomic 14/15)',
      predicate: (sim) => {
        const soldiers = ofJob(sim, JOB_SOLDIER_UNARMED);
        return soldiers.length === 1 && soldiers.every((s) => s.enjoyment === ONE);
      },
    },
    {
      label: 'the hungry settler foraged the bush and the sleepy one napped (both needs met)',
      predicate: (sim) => {
        for (const e of sim.world.query(Settler)) {
          const s = sim.world.get(e, Settler);
          if (s.hunger >= systems.NEED_DRIVE_THRESHOLD || s.fatigue >= systems.NEED_DRIVE_THRESHOLD)
            return false;
        }
        return true;
      },
    },
  ],
};
