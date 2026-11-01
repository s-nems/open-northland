import { describe, expect, it } from 'vitest';
import {
  AiControl,
  aiControlEntity,
  ComputerStrategy,
  mapBriefOf,
} from '../../../../src/components/index.js';
import {
  exportSaveGame,
  parseSaveGame,
  restoreSimulation,
  Simulation,
  serializeSaveGame,
} from '../../../../src/index.js';
import { seatBriefOf } from '../../../../src/systems/computer-player/index.js';
import { aiContent } from '../../../fixtures/ai-content.js';
import { grassNodeMap } from '../../../fixtures/terrain.js';
import { makeAiSeat, placeHq, SEAT, VIKING } from '../support.js';

const MAP_W = 64;
const MAP_H = 32;
const MAP_AI_SEAT = 3;

function strategySim(): Simulation {
  const sim = new Simulation({ seed: 1, content: aiContent(), map: grassNodeMap(MAP_W, MAP_H) });
  makeAiSeat(sim, SEAT);
  placeHq(sim);
  return sim;
}

/** The seat's saved strategy, as the debug view reads it off the carrier. */
function strategyOf(sim: Simulation) {
  const carrier = aiControlEntity(sim.world, SEAT);
  return carrier === null ? undefined : sim.world.tryGet(carrier, ComputerStrategy);
}

describe('computer strategy step', () => {
  it('decides only the seats whose computer controller runs, once the map brief exists', () => {
    const sim = strategySim();
    makeAiSeat(sim, MAP_AI_SEAT);
    const mapOnly = aiControlEntity(sim.world, MAP_AI_SEAT);
    if (mapOnly === null) throw new Error('no map AI seat');
    sim.world.mut(mapOnly, AiControl).computerEnabled = false;
    sim.enqueueSetup({ kind: 'spawnSettler', jobType: 6, x: 50, y: 10, tribe: VIKING, owner: MAP_AI_SEAT });
    sim.step();
    // The small test map leaves the home band little room.
    expect(strategyOf(sim)?.economy).toEqual(expect.objectContaining({ archetype: 'cramped' }));
    const brief = mapBriefOf(sim.world);
    expect(brief === null ? null : seatBriefOf(brief, SEAT)?.player).toBe(SEAT);
    expect(sim.world.has(mapOnly, ComputerStrategy)).toBe(false);
  });

  it('survives a save and restore unchanged', () => {
    const sim = strategySim();
    sim.step();
    const before = strategyOf(sim);
    expect(before).toBeDefined();
    const restored = restoreSimulation(parseSaveGame(JSON.parse(serializeSaveGame(exportSaveGame(sim)))), {
      content: aiContent(),
      map: grassNodeMap(MAP_W, MAP_H),
    });
    expect(strategyOf(restored)).toEqual(before);
  });
});
