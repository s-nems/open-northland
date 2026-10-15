import type { Entity, Simulation } from '@open-northland/sim';
import { components, systems } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_COLLECTOR, JOB_SOLDIER_SWORD } from '../catalog/jobs.js';
import { HUMAN_PLAYER } from '../game/rules.js';
import { spawnSettlerDirect } from '../game/sandbox/index.js';
import { computeExperienceStars, experienceStarRules } from '../view/projections/experience-stars.js';
import type { SceneDefinition } from './types.js';

const MAP_W = 20;
const MAP_H = 14;
const ROW_Y = 6;
const FIRST_X = 5;
const SPACING = 2;
/** Landed sword hits per soldier, one per star size. */
const SWORD_HITS = [25, 50, 75, 100] as const;
/** The life each of those soldiers keeps, in percent, so a selection shows the heart's steps. */
const SOLDIER_LIFE_PERCENT = [100, 70, 30, 10] as const;
/** The wounded soldier's hits and the life he keeps, in percent. */
const WOUNDED_HITS = 75;
const WOUNDED_LIFE_PERCENT = 40;
/** The collector general track of the sandbox content, and raw experience past its mastery. */
const COLLECTOR_TRACK = 2;
const MASTER_XP = 1_000_000;

const { Health, SettlerProgress } = components;

function placeSoldier(sim: Simulation, x: number, hits: number): Entity {
  const soldier = spawnSettlerDirect(sim, JOB_SOLDIER_SWORD, x, ROW_Y, HUMAN_PLAYER);
  sim.world.mut(soldier, SettlerProgress).experience.set(systems.FIGHT_EXPERIENCE_TYPE.SWORD, hits);
  return soldier;
}

function wound(sim: Simulation, e: Entity, lifePercent = WOUNDED_LIFE_PERCENT): void {
  const health = sim.world.mut(e, Health);
  health.hitpoints = Math.trunc((health.max * lifePercent) / 100);
}

function build(sim: Simulation): void {
  SWORD_HITS.forEach((hits, i) => {
    wound(sim, placeSoldier(sim, FIRST_X + i * SPACING, hits), SOLDIER_LIFE_PERCENT[i]);
  });
  const column = placeSoldier(sim, FIRST_X + SWORD_HITS.length * SPACING, WOUNDED_HITS);
  wound(sim, column);
  components.setMissionBehaviour(sim.world, column, components.MISSION_BEHAVIOUR.IMPORTED, true);

  const master = spawnSettlerDirect(sim, JOB_COLLECTOR, FIRST_X, ROW_Y + 3, HUMAN_PLAYER);
  sim.world.mut(master, SettlerProgress).experience.set(COLLECTOR_TRACK, MASTER_XP);
  const marked = spawnSettlerDirect(sim, JOB_COLLECTOR, FIRST_X + 2 * SPACING, ROW_Y + 3, HUMAN_PLAYER);
  wound(sim, marked);
  components.setMissionBehaviour(sim.world, marked, components.MISSION_BEHAVIOUR.IMPORTED, true);
}

/** The weapon star sizes the projection gives the unselected people, left to right. */
function weaponTiers(sim: Simulation): number[] {
  const rules = experienceStarRules(sim.content);
  const stars = computeExperienceStars(sim.snapshot(), { ...rules, viewer: HUMAN_PLAYER });
  return stars.map((s) => s.weaponTier);
}

export const overheadIconsScene: SceneDefinition = {
  id: 'overhead-icons',
  seed: 53,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: 20,
  initialZoom: 1.5,
  checks: [
    {
      label: 'the soldiers wear one star size per quarter of their sword hits, the collectors none',
      predicate: (sim) => weaponTiers(sim).join() === [1, 2, 3, 4, 3].join(),
    },
  ],
};
