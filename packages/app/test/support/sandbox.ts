import { type EntitySnapshot, ONE, type Simulation, systems, type WorldSnapshot } from '@open-northland/sim';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from '../../src/game/rules.js';
import { fixedViewerSeat } from '../../src/game/viewer-seat.js';
import type { UnitPanelModelContext } from '../../src/hud/details-panel/index.js';
import { createSceneSim, SCENES } from '../../src/scenes/index.js';
import { sandboxScene } from '../../src/scenes/sandbox/index.js';
import type { SceneDefinition } from '../../src/scenes/types.js';

/** The details-panel model context a sim's content provides - the content half every
 *  `buildUnitPanelModel` assertion runs against, livestock seams wired like `unit-controls`. */
export function ctxOf(sim: Simulation): UnitPanelModelContext {
  return {
    viewer: fixedViewerSeat(HUMAN_PLAYER),
    buildings: sim.content.buildings,
    goods: sim.content.goods,
    jobs: sim.content.jobs,
    jobExperience: sim.content.jobExperience,
    tribes: sim.content.tribes,
    vehicles: sim.content.vehicles,
    weapons: sim.content.weapons,
    armor: sim.content.armor,
    isLivestockWorkplace: (typeId) => systems.isLivestockWorkplaceType(sim.content, typeId),
    gatherGoods: (jobType) => systems.jobGatherGoods({ content: sim.content }, jobType),
    livestockTribeOfGood: (goodType) => systems.livestockTribeOfGood(sim.content, goodType),
    edibleGoodForm: (goodType) => systems.edibleGoodFormOf(sim.content, goodType),
    isTraderJob: (jobType) => systems.isTraderJob(sim.content, jobType),
    fightEffects: (settler, worn, experience) =>
      systems.fightExperienceEffects(sim.content, settler, worn, experience),
  };
}

/** {@link ctxOf} for a fresh `sandbox` scene sim. A fresh sim per call keeps each test isolated (each sim
 *  owns its component stores; see {@link createSceneSim}). */
export function sandboxCtx(): UnitPanelModelContext {
  return ctxOf(createSceneSim(sandboxScene));
}

/** A hand-built snapshot for the pure HUD model/layout tests: the given entities at `tick`, no events,
 *  canonicalized to the ascending-id order `takeSnapshot` guarantees and `entityById` binary-searches. */
export function snapshotOf(entities: readonly EntitySnapshot[], tick = 0): WorldSnapshot {
  return { tick, events: [], entities: [...entities].sort((a, b) => a.id - b.id) };
}

/** A human-owned viking building entity: the `Building` + `Owner` preamble the panel tests all repeat.
 *  `built` defaults to finished; `components` adds what the test is actually about (Stockpile, Production,
 *  UnderConstruction, …). */
export function buildingEntity(
  id: number,
  buildingType: number,
  opts: { built?: number; components?: Readonly<Record<string, unknown>> } = {},
): EntitySnapshot {
  return {
    id,
    components: {
      Building: { buildingType, tribe: PRIMARY_TRIBE, built: opts.built ?? ONE, level: 0 },
      Owner: { player: HUMAN_PLAYER },
      ...opts.components,
    },
  };
}

/** A registered acceptance scene by id; throws when the registry lacks it. */
export function registeredScene(id: string): SceneDefinition {
  const scene = SCENES.find((s) => s.id === id);
  if (scene === undefined) throw new Error(`${id} scene missing`);
  return scene;
}
