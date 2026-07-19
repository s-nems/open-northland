import type { Entity, Fixed, Simulation } from '@open-northland/sim';
import { cellAnchorNode, components, fx, ONE, systems } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from '../game/rules.js';
import {
  GATHERERS,
  JOB_CIVILIST,
  JOB_COLLECTOR,
  JOB_SOLDIER_UNARMED,
  JOB_WOMAN,
  placeResourceNode,
  placeSandboxBerryBush,
} from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

/**
 * The gossip + need-bubbles scene: prove the company need's self-satisfying loop and the pressing-need
 * thought bubbles, in three vignettes (needs ON — the one mechanic this scene is about).
 *
 *  - **The idle circle** (left): three fully-lonely civilians with nothing to do pair up and chat — two
 *    talk first while the third waits its turn, each pair standing face to face playing the talk/listen
 *    clips while their "Towarzystwo" bars refill. The soldier standing beside them NEVER joins (the
 *    original forbids soldiers the talk/listen atomics) and his bar stays frozen.
 *  - **The lonely worker** (middle): a woodcutter chops until his company bar crosses the seek threshold,
 *    then downs tools, walks to the idle woman nearby and chats with her (man speak + woman talk clips).
 *  - **The need bubbles** (right): a very hungry civilian shows the hunger bubble over his head while he
 *    walks to the berry bush and eats; a very sleepy one shows the sleep bubble, then naps in place.
 *
 * The browser half is where a human judges the pixels: the pairs turning toward each other, the talk
 * animations, the bars refilling live in the details panel, and the bubble frames (hunger 4 / sleep 0 —
 * observed original behavior). The headless half asserts the mechanics below.
 */

const MAP_W = 36;
const MAP_H = 12;

/** The idle chat circle — three civilians a couple of tiles apart, plus the excluded soldier. */
const CIRCLE = [
  { x: 4, y: 5 },
  { x: 7, y: 5 },
  { x: 5, y: 7 },
] as const;
const SOLDIER = { x: 3, y: 7 } as const;

/** The lonely-worker vignette: a woodcutter at his tree, an idle woman a short walk away. */
const TREE = { x: 24, y: 4 } as const;
const WOODCUTTER = { x: 23, y: 4 } as const;
const WOMAN = { x: 19, y: 7 } as const;

/** The bubble vignette: a hungry civilian one tile from a ripe bush, a sleepy one beside him. */
const BUSH = { x: 32, y: 6 } as const;
const HUNGRY_SPOT = { x: 31, y: 6 } as const;
const SLEEPY_SPOT = { x: 33, y: 8 } as const;

/** Fully lonely — the idle circle (and the soldier) start with the company bar spent whole. */
const LONELY_WHOLE: Fixed = ONE;
/** Just under the ¾·ONE seek threshold: the woodcutter visibly works first, then crosses it and quits. */
const ALMOST_LONELY: Fixed = fx.div(fx.fromInt(7), fx.fromInt(10));
/** Clearly over the ¾·ONE eat/sleep thresholds — the bubble settlers' pressing needs. */
const PRESSING: Fixed = fx.div(fx.fromInt(9), fx.fromInt(10));
/** End-of-run bound proving a settler chatted: without a chat the bar would sit pinned at ONE. */
const REFILLED: Fixed = fx.div(ONE, fx.fromInt(4));

/** Covers the woodcutter's ~400 ticks of chopping, his walk, and several 247-tick chat rounds. */
const RUN_TICKS = 1500;
const INITIAL_ZOOM = 0.9;

const { Settler } = components;

/** Spawn one settler directly (pre-tick-0) with every need authored, so the vignette timing is exact
 *  (createSettler's seeded random starting needs would blur the thresholds). */
function spawnActor(
  sim: Simulation,
  jobType: number,
  x: number,
  y: number,
  needs: { hunger?: Fixed; fatigue?: Fixed; enjoyment?: Fixed },
): Entity {
  const node = cellAnchorNode(x, y);
  const e = systems.createSettler(sim.world, sim.content, sim.rng, {
    jobType,
    x: node.hx,
    y: node.hy,
    tribe: PRIMARY_TRIBE,
    owner: HUMAN_PLAYER,
  });
  if (e === null) throw new Error('gossip scene: unknown settler job');
  const s = sim.world.get(e, Settler);
  s.hunger = needs.hunger ?? fx.fromInt(0);
  s.fatigue = needs.fatigue ?? fx.fromInt(0);
  s.piety = fx.fromInt(0);
  s.enjoyment = needs.enjoyment ?? fx.fromInt(0);
  return e;
}

function build(sim: Simulation): void {
  // The idle circle + the excluded soldier — everyone starts fully lonely.
  for (const spot of CIRCLE) spawnActor(sim, JOB_CIVILIST, spot.x, spot.y, { enjoyment: LONELY_WHOLE });
  spawnActor(sim, JOB_SOLDIER_UNARMED, SOLDIER.x, SOLDIER.y, { enjoyment: LONELY_WHOLE });

  // The lonely worker: chops first, crosses the threshold mid-run, then seeks the idle woman.
  const wood = GATHERERS.find((g) => g.id === 'wood');
  if (wood === undefined) throw new Error('gossip scene: no wood gatherer spec');
  placeResourceNode(sim, wood, TREE.x, TREE.y);
  spawnActor(sim, JOB_COLLECTOR, WOODCUTTER.x, WOODCUTTER.y, { enjoyment: ALMOST_LONELY });
  spawnActor(sim, JOB_WOMAN, WOMAN.x, WOMAN.y, { enjoyment: fx.div(ONE, fx.fromInt(2)) });

  // The need bubbles: pressing hunger beside a ripe bush; pressing sleepiness napped off in place.
  placeSandboxBerryBush(sim, BUSH.x, BUSH.y);
  spawnActor(sim, JOB_CIVILIST, HUNGRY_SPOT.x, HUNGRY_SPOT.y, { hunger: PRESSING });
  spawnActor(sim, JOB_CIVILIST, SLEEPY_SPOT.x, SLEEPY_SPOT.y, { fatigue: PRESSING });
}

/** The `Settler` values of every settler working `jobType` — the checks classify actors by trade. */
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
      label: 'the soldier never chatted — his frozen company bar is still spent whole (forbidatomic 14/15)',
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
          if (s.hunger >= systems.HUNGER_EAT_THRESHOLD || s.fatigue >= systems.FATIGUE_SLEEP_THRESHOLD)
            return false;
        }
        return true;
      },
    },
  ],
};
