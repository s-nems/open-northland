import type { Entity, Fixed, Simulation } from '@open-northland/sim';
import { components, fx, systems } from '@open-northland/sim';
import { grassTerrain } from '../../catalog/buildings.js';
import { JOB_COLLECTOR, JOB_SOLDIER_SWORD } from '../../catalog/jobs.js';
import { ENEMY_PLAYER, HUMAN_PLAYER } from '../../game/rules.js';
import { spawnSettlerDirect } from '../../game/sandbox/index.js';
import { goodBySlug } from '../sandbox-queries.js';
import type { SceneDefinition } from '../types.js';

const { Equipment, Health, MISC_EQUIP_SLOTS, Settler } = components;

const MAP_W = 24;
const MAP_H = 16;
/** Each row sips in turn from west to east, one drinker every few seconds. */
const DRINKERS_PER_ROW = 4;
const FIRST_DRINKER_X = 6;
const DRINKER_SPACING = 3;
const FOOD_ROW_Y = 4;
const STAMINA_ROW_Y = 7;
const SIP_GAP_TICKS = 36;
/** The stamina row sips between the food row's turns. */
const STAMINA_ROW_DELAY_TICKS = SIP_GAP_TICKS / 2;
/** A wounded swordsman with healing potions holds against three rivals, sipping as their blows land. */
const DUEL_Y = 11;
const DEFENDER_X = 11;
const RIVAL_XS = [13, 14, 15] as const;
const DEFENDER_HEALTH_PCT = 55;
const PERCENT = 100;
const RUN_TICKS = 400;

function carrying(sim: Simulation, e: Entity, slugs: readonly string[]): void {
  const misc = Array.from({ length: MISC_EQUIP_SLOTS }, (_, slot) => {
    const slug = slugs[slot];
    return slug === undefined ? null : { goodType: goodBySlug(sim, slug), degreeOfUse: fx.fromInt(0) };
  });
  sim.world.add(e, Equipment, { boots: null, tool: null, weapon: null, armor: null, misc });
}

/** The need level that reaches the drive level `ticks` drain passes from now; a pass drains one of the
 *  bar's reserve units. */
function pressingIn(ticks: number): Fixed {
  const drained = fx.div(fx.fromInt(ticks), fx.fromInt(systems.NEED_RESERVE_UNITS));
  return fx.sub(systems.NEED_DRIVE_THRESHOLD, drained);
}

function drinkerRow(sim: Simulation, y: number, potion: string, need: 'hunger' | 'fatigue', delay: number) {
  for (let i = 0; i < DRINKERS_PER_ROW; i++) {
    const e = spawnSettlerDirect(sim, JOB_COLLECTOR, FIRST_DRINKER_X + i * DRINKER_SPACING, y, HUMAN_PLAYER);
    carrying(sim, e, [potion]);
    const needs = systems.mutNeeds(sim.world, e, sim.tick);
    needs.hunger = fx.fromInt(0);
    needs.fatigue = fx.fromInt(0);
    needs[need] = pressingIn(delay + (i + 1) * SIP_GAP_TICKS);
  }
}

function build(sim: Simulation): void {
  drinkerRow(sim, FOOD_ROW_Y, 'potion_food_big', 'hunger', 0);
  drinkerRow(sim, STAMINA_ROW_Y, 'potion_stamina_big', 'fatigue', STAMINA_ROW_DELAY_TICKS);

  const defender = spawnSettlerDirect(sim, JOB_SOLDIER_SWORD, DEFENDER_X, DUEL_Y, HUMAN_PLAYER);
  carrying(sim, defender, new Array<string>(MISC_EQUIP_SLOTS).fill('potion_heal_big'));
  const health = sim.world.mut(defender, Health);
  health.hitpoints = Math.round((health.max * DEFENDER_HEALTH_PCT) / PERCENT);
  for (const x of RIVAL_XS) spawnSettlerDirect(sim, JOB_SOLDIER_SWORD, x, DUEL_Y, ENEMY_PLAYER);
}

/** How many settlers of `jobType` that started with a full misc row of `bottles` fresh bottles have
 *  sipped: one is opened, or drunk dry and gone from its slot. */
function sippers(sim: Simulation, jobType: number, bottles: number): number {
  let count = 0;
  for (const e of sim.world.query(Equipment, Settler)) {
    if (sim.world.get(e, Settler).jobType !== jobType) continue;
    const fresh = sim.world
      .get(e, Equipment)
      .misc.filter((slot) => slot !== null && slot.degreeOfUse === 0).length;
    if (fresh < bottles) count++;
  }
  return count;
}

export const potionSipsScene: SceneDefinition = {
  id: 'potion-sips',
  seed: 3,
  terrain: grassTerrain(MAP_W, MAP_H),
  needs: true,
  build,
  runTicks: RUN_TICKS,
  checks: [
    {
      label: 'every hungry and every tired settler sipped its potion',
      predicate: (sim) => sippers(sim, JOB_COLLECTOR, 1) === 2 * DRINKERS_PER_ROW,
    },
    {
      label: 'the wounded swordsman sipped a healing potion under the blows',
      predicate: (sim) => sippers(sim, JOB_SOLDIER_SWORD, MISC_EQUIP_SLOTS) === 1,
    },
  ],
};
