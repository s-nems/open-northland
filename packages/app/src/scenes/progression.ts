import type { Simulation } from '@open-northland/sim';
import { components } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { PRIMARY_TRIBE } from '../game/rules.js';
import { BUILDING_JOINERY, buildingDef, placeBuiltSandboxBuilding, spawnIdleSettler } from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

/**
 * The profession-progression toggle scene: a built joinery whose worker job is XP-gated (an injected
 * `needforjob` threshold nobody has trained toward), plus idle settlers — and the scene builds with
 * `progression: false`, so the JobSystem staffs the gated trade from zero experience anyway. Headless
 * proves the free-start staffing; in the browser a human sees the workshop manned and the settler
 * panel's Doświadczenie section WITHOUT upcoming-unlock promises (the toggle hides them).
 *
 * The gate is injected into this sim's own content copy (`sandboxContent` builds a fresh set per
 * world), so the shared sandbox catalog — and every other scene's staffing — stays untouched.
 */

const MAP_W = 20;
const MAP_H = 14;
const JOINERY = { x: 9, y: 6 } as const;
const SETTLERS = [
  { x: 5, y: 8 },
  { x: 6, y: 10 },
] as const;
/** The injected gate: an expType with no content track (raw XP = repeats) nobody ever accrues here. */
const GATE_EXPERIENCE_TYPE = 77;
const GATE_AMOUNT = 10;
/** Staffing is an early-tick pass; a small budget keeps the headless run tight. */
const RUN_TICKS = 50;

const { Settler } = components;

/** The joinery's (rebased) worker-slot job — the trade the injected gate thresholds. */
function joineryWorkerJob(sim: Simulation): number {
  const slot = buildingDef(sim, BUILDING_JOINERY)?.workers[0];
  if (slot === undefined) throw new Error('sandbox joinery declares no worker slot');
  return slot.jobType;
}

function build(sim: Simulation): void {
  placeBuiltSandboxBuilding(sim, BUILDING_JOINERY, JOINERY.x, JOINERY.y);
  // Gate the joinery's trade behind XP nobody has: with progression ON this workshop would stand
  // empty forever. This mutates only this sim's fresh content copy, never the shared catalog.
  const tribe = sim.content.tribes.find((t) => t.typeId === PRIMARY_TRIBE);
  if (tribe === undefined) throw new Error('sandbox content has no primary tribe');
  tribe.jobRequirements.push({
    requirement: 'need',
    target: 'job',
    targetId: joineryWorkerJob(sim),
    amount: GATE_AMOUNT,
    experienceTypes: [GATE_EXPERIENCE_TYPE],
  });
  for (const spot of SETTLERS) spawnIdleSettler(sim, spot.x, spot.y);
}

export const progressionScene: SceneDefinition = {
  id: 'progression',
  seed: 12,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  progression: false,
  runTicks: RUN_TICKS,
  checks: [
    {
      label: 'the world runs with profession progression off (the scene-built rules command)',
      predicate: (sim) => !sim.professionProgressionEnabled(),
    },
    {
      label: 'the XP-gated joinery trade is staffed from zero experience (free-start staffing)',
      predicate: (sim) => {
        const gated = joineryWorkerJob(sim);
        for (const e of sim.world.query(Settler)) {
          if (sim.world.get(e, Settler).jobType === gated) return true;
        }
        return false;
      },
    },
  ],
};
