import type { Entity, Simulation } from '@open-northland/sim';
import { cellAnchorNode, components, fx, systems } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_COLLECTOR, JOB_SOLDIER_SWORD } from '../catalog/jobs.js';
import { ENEMY_PLAYER, HUMAN_PLAYER } from '../game/rules.js';
import { spawnSettlerDirect } from '../game/sandbox/index.js';
import { goodBySlug } from './sandbox-queries.js';
import type { SceneDefinition } from './types.js';

const { Equipment, Health, MISC_EQUIP_SLOTS, Position, Settler } = components;

const MAP_W = 40;
const MAP_H = 18;
/** Two walkers race east on the same grass; the speed amulet saves two of a barefoot step's eight
 *  ticks, so it covers a third more ground. Neither reaches the line within the run. */
const RACE_START_X = 3;
const RACE_FINISH_X = 37;
const RACE_BARE_Y = 3;
const RACE_AMULET_Y = 5;
/** The amuleted swordsman faces an equal rival: blows at 3/2, one in five doubled, and half taken. */
const DUEL_Y = 10;
const DUEL_AMULET_X = 8;
const DUEL_RIVAL_X = 10;
/** Past the drive level at 8/10, so the food and stamina amulets fire on the first ticks. */
const WEARER = { x: 20, y: 14 } as const;
const PRESSING_NEED = fx.div(fx.fromInt(9), fx.fromInt(10));
const RUN_TICKS = 300;
const INITIAL_ZOOM = 0.8;

function carrying(sim: Simulation, e: Entity, slugs: readonly string[]): void {
  const misc = Array.from({ length: MISC_EQUIP_SLOTS }, (_, slot) => {
    const slug = slugs[slot];
    return slug === undefined ? null : { goodType: goodBySlug(sim, slug), degreeOfUse: fx.fromInt(0) };
  });
  sim.world.add(e, Equipment, { boots: null, tool: null, weapon: null, armor: null, misc });
}

function racer(sim: Simulation, y: number, slugs: readonly string[]): void {
  const e = spawnSettlerDirect(sim, JOB_COLLECTOR, RACE_START_X, y, HUMAN_PLAYER);
  carrying(sim, e, slugs);
  const finish = cellAnchorNode(RACE_FINISH_X, y);
  sim.enqueueSetup({ kind: 'moveUnit', entity: e, x: finish.hx, y: finish.hy });
}

function build(sim: Simulation): void {
  racer(sim, RACE_BARE_Y, []);
  racer(sim, RACE_AMULET_Y, ['amulet_speed']);

  const champion = spawnSettlerDirect(sim, JOB_SOLDIER_SWORD, DUEL_AMULET_X, DUEL_Y, HUMAN_PLAYER);
  carrying(sim, champion, ['amulet_strength', 'amulet_crithit', 'amulet_defense']);
  spawnSettlerDirect(sim, JOB_SOLDIER_SWORD, DUEL_RIVAL_X, DUEL_Y, ENEMY_PLAYER);

  const wearer = spawnSettlerDirect(sim, JOB_COLLECTOR, WEARER.x, WEARER.y, HUMAN_PLAYER);
  carrying(sim, wearer, ['amulet_food', 'amulet_stamina']);
  const needs = sim.world.mut(wearer, Settler);
  needs.hunger = PRESSING_NEED;
  needs.fatigue = PRESSING_NEED;
}

function carriers(sim: Simulation, slug: string): Entity[] {
  const good = goodBySlug(sim, slug);
  return [...sim.world.query(Equipment)].filter((e) =>
    sim.world.get(e, Equipment).misc.some((slot) => slot?.goodType === good),
  );
}

/** The collector that carries nothing: the bare racer. */
function bareRacer(sim: Simulation): Entity | undefined {
  return [...sim.world.query(Equipment)].find(
    (e) =>
      sim.world.get(e, Settler).jobType === JOB_COLLECTOR &&
      sim.world.get(e, Equipment).misc.every((slot) => slot === null),
  );
}

export const amuletsScene: SceneDefinition = {
  id: 'amulets',
  seed: 5,
  terrain: grassTerrain(MAP_W, MAP_H),
  needs: true,
  initialZoom: INITIAL_ZOOM,
  build,
  runTicks: RUN_TICKS,
  checks: [
    {
      label: 'the speed amulet walker leads the bare one',
      predicate: (sim) => {
        const bare = bareRacer(sim);
        const fast = carriers(sim, 'amulet_speed')[0];
        return (
          bare !== undefined &&
          fast !== undefined &&
          sim.world.get(fast, Position).x > sim.world.get(bare, Position).x
        );
      },
    },
    {
      label: 'the amuleted swordsman won the duel',
      predicate: (sim) => {
        const champion = carriers(sim, 'amulet_strength')[0];
        const rivals = [...sim.world.query(Settler)].filter(
          (e) => sim.world.get(e, Settler).jobType === JOB_SOLDIER_SWORD && e !== champion,
        );
        return champion !== undefined && sim.world.get(champion, Health).hitpoints > 0 && rivals.length === 0;
      },
    },
    {
      label: 'the food and stamina amulets topped both needs up below the drive level and stayed whole',
      predicate: (sim) => {
        const wearer = carriers(sim, 'amulet_food')[0];
        if (wearer === undefined) return false;
        const s = sim.world.get(wearer, Settler);
        const whole = sim.world
          .get(wearer, Equipment)
          .misc.every((slot) => slot === null || slot.degreeOfUse === fx.fromInt(0));
        return s.hunger < systems.NEED_DRIVE_THRESHOLD && s.fatigue < systems.NEED_DRIVE_THRESHOLD && whole;
      },
    },
  ],
};
