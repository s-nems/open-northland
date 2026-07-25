import type { ContentSet, JobRequirement } from '@open-northland/data';
import type { Simulation } from '@open-northland/sim';
import { components } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { PRIMARY_TRIBE } from '../game/rules.js';
import { BUILDING_JOINERY, placeBuiltSandboxBuilding, spawnIdleSettler } from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

/**
 * The profession-progression toggle scene: a built joinery whose worker job is XP-gated (an injected
 * `needforjob` threshold nobody has trained toward), plus idle settlers — and the scene builds with
 * `progression: false`, so the JobSystem staffs the gated trade from zero experience anyway. Headless
 * proves the free-start staffing; in the browser a human sees the workshop manned and the settler
 * panel's Doświadczenie section WITHOUT upcoming-unlock promises (the toggle hides them).
 *
 * The gate rides `amendContent`, which copies the tribe row before adding the requirement — the
 * resolved set may be the browser's shared memoized real content, which no scene may mutate.
 */

const MAP_W = 20;
const MAP_H = 14;
const JOINERY = { x: 9, y: 6 } as const;
const SETTLERS = [
  { x: 5, y: 8 },
  { x: 6, y: 10 },
] as const;
/** The injected gate's expType: outside the original's id space (`logicdefines.inc` max 78) and away
 *  from the scout bucket (100), so no track — raw XP = repeats — and nothing here ever accrues it. */
const GATE_EXPERIENCE_TYPE = 200;
const GATE_AMOUNT = 10;
/** Staffing is an early-tick pass; a small budget keeps the headless run tight. */
const RUN_TICKS = 50;

const { Settler } = components;

/** The joinery's worker-slot job in `content` — the trade the injected gate thresholds. */
function joineryWorkerJob(content: ContentSet): number {
  const slot = content.buildings.find((b) => b.typeId === BUILDING_JOINERY)?.workers[0];
  if (slot === undefined) throw new Error('content declares no joinery worker slot');
  return slot.jobType;
}

/** Gate the joinery's trade behind XP nobody has: with progression ON this workshop would stand
 *  empty forever. Copies the set and the tribe row — never mutates the (possibly shared) input. */
function gatedContent(content: ContentSet): ContentSet {
  const gate: JobRequirement = {
    requirement: 'need',
    target: 'job',
    targetId: joineryWorkerJob(content),
    amount: GATE_AMOUNT,
    experienceTypes: [GATE_EXPERIENCE_TYPE],
  };
  return {
    ...content,
    tribes: content.tribes.map((tribe) =>
      tribe.typeId === PRIMARY_TRIBE
        ? { ...tribe, jobRequirements: [...tribe.jobRequirements, gate] }
        : tribe,
    ),
  };
}

function build(sim: Simulation): void {
  placeBuiltSandboxBuilding(sim, BUILDING_JOINERY, JOINERY.x, JOINERY.y);
  for (const spot of SETTLERS) spawnIdleSettler(sim, spot.x, spot.y);
}

export const progressionScene: SceneDefinition = {
  id: 'progression',
  seed: 12,
  terrain: grassTerrain(MAP_W, MAP_H),
  amendContent: gatedContent,
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
        const gated = joineryWorkerJob(sim.content);
        for (const e of sim.world.query(Settler)) {
          if (sim.world.get(e, Settler).jobType === gated) return true;
        }
        return false;
      },
    },
  ],
};
