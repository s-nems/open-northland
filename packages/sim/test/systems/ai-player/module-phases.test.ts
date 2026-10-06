import { describe, expect, it } from 'vitest';
import { AiPlayer, Building } from '../../../src/components/index.js';
import type { PlayerCommand } from '../../../src/core/commands/index.js';
import { exportSaveGame, parseSaveGame, restoreSimulation, serializeSaveGame } from '../../../src/index.js';
import {
  AI_DECISION_INTERVAL_TICKS,
  AI_MODULE_PHASE_TICKS,
  type AiPlayerModule,
  aiDecisionDue,
  runAiPlayerModules,
} from '../../../src/systems/ai-player/index.js';
import { aiContent } from '../../fixtures/ai-content.js';
import { grassNodeMap } from '../../fixtures/terrain.js';
import { aiSim, ctxOf, HOME_TYPE, placeHq, placeResources, SEAT, spawnMen, VIKING } from './support.js';

const SITE = { x: 30, y: 20 };
/** Ticks the round trip plays on, a few decisions of every module. */
const PLAYED_TICKS = 4 * AI_DECISION_INTERVAL_TICKS;
const MEN = 12;

/** The first tick from `from` on which `SEAT`'s decision begins. */
function slotFrom(from: number): number {
  let tick = from;
  while (!aiDecisionDue(tick, SEAT)) tick++;
  return tick;
}

describe('AI decision phases', () => {
  it('lets a later module of one decision see the site an earlier one placed standing', () => {
    const sim = aiSim();
    placeHq(sim);
    sim.world.add(sim.world.create(), AiPlayer, {
      player: SEAT,
      modules: {
        collectResources: false,
        guideBuild: false,
        homeExpansion: false,
        houseBuild: true,
        houseUpgrade: false,
        military: false,
        roadBuild: true,
      },
      scripted: false,
      difficulty: 'hard',
    });
    sim.step();
    let sawSite: boolean | null = null;
    const place: AiPlayerModule = {
      id: 'houseBuild',
      run: (): PlayerCommand[] => [
        {
          kind: 'placeBuilding',
          buildingType: HOME_TYPE,
          x: SITE.x,
          y: SITE.y,
          tribe: VIKING,
          owner: SEAT,
          underConstruction: true,
        },
      ],
    };
    const road: AiPlayerModule = {
      id: 'roadBuild',
      run: (world): PlayerCommand[] => {
        sawSite = [...world.query(Building)].some((e) => world.get(e, Building).buildingType === HOME_TYPE);
        return [];
      },
    };
    const slot = slotFrom(sim.tick);
    const ctx = { ...ctxOf(sim, slot), commands: sim.commands };
    runAiPlayerModules(sim.world, ctx, [place, road]);
    expect(sawSite).toBeNull(); // the road module waits for its own phase
    sim.step(); // the next command pass applies the placement
    runAiPlayerModules(sim.world, { ...ctx, tick: slot + AI_MODULE_PHASE_TICKS }, [place, road]);
    expect(sawSite).toBe(true);
  });

  it('restores a save taken between the modules of one decision and plays on identically', () => {
    const sim = aiSim();
    placeHq(sim);
    spawnMen(sim, MEN);
    placeResources(sim);
    sim.world.add(sim.world.create(), AiPlayer, {
      player: SEAT,
      modules: {
        collectResources: true,
        guideBuild: true,
        homeExpansion: true,
        houseBuild: true,
        houseUpgrade: true,
        military: true,
        roadBuild: true,
      },
      scripted: false,
      difficulty: 'hard',
    });
    // Stop just after a decision's first module, with the rest still to run.
    const stopAt = slotFrom(AI_DECISION_INTERVAL_TICKS) + AI_MODULE_PHASE_TICKS;
    while (sim.tick < stopAt) sim.step();
    const bytes = serializeSaveGame(exportSaveGame(sim));
    const restored = restoreSimulation(parseSaveGame(JSON.parse(bytes)), {
      content: aiContent(),
      map: grassNodeMap(64, 32),
    });
    expect(restored.hashState()).toBe(sim.hashState());
    for (let i = 0; i < PLAYED_TICKS; i++) {
      sim.step();
      restored.step();
    }
    expect(restored.hashState()).toBe(sim.hashState());
  });
});
