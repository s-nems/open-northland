import { type EntitySnapshot, ONE, type Simulation, type WorldSnapshot } from '@open-northland/sim';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from '../../src/game/rules.js';
import type { UnitPanelModelContext } from '../../src/hud/details-panel/index.js';
import { createSceneSim } from '../../src/scenes/index.js';
import { sandboxScene } from '../../src/scenes/sandbox.js';

/** The details-panel model context `{ buildings, goods, jobs }` a sim's content provides — the content half
 *  every `buildUnitPanelModel` assertion runs against. */
export function ctxOf(sim: Simulation): UnitPanelModelContext {
  return { buildings: sim.content.buildings, goods: sim.content.goods, jobs: sim.content.jobs };
}

/** {@link ctxOf} for a fresh `sandbox` scene sim. A fresh sim per call keeps each test isolated (each sim
 *  owns its component stores; see {@link createSceneSim}). */
export function sandboxCtx(): UnitPanelModelContext {
  return ctxOf(createSceneSim(sandboxScene));
}

/** A hand-built snapshot for the pure HUD model/layout tests: the given entities at `tick`, no events. */
export function snapshotOf(entities: readonly EntitySnapshot[], tick = 0): WorldSnapshot {
  return { tick, events: [], entities };
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
