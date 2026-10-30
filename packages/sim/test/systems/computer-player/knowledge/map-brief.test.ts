import { describe, expect, it } from 'vitest';
import { AiControl, MapBrief, mapBriefOf, Position, Resource } from '../../../../src/components/index.js';
import {
  exportSaveGame,
  parseSaveGame,
  positionOfNode,
  restoreSimulation,
  Simulation,
  serializeSaveGame,
  type TerrainMap,
} from '../../../../src/index.js';
import { stampResourceFootprintData } from '../../../../src/systems/index.js';
import { setAiControl } from '../../../../src/systems/orders/ai.js';
import { aiContent } from '../../../fixtures/ai-content.js';
import { grassNodeMap } from '../../../fixtures/terrain.js';
import {
  ctxOf,
  HQ_TYPE,
  makeAiSeat,
  placeHq,
  placeResources,
  RESOURCE_SPOTS,
  SEAT,
  spawnMen,
  VIKING,
  WOOD,
  WOOD_HARVEST,
} from '../support.js';

/** Two zones side by side: the map is two 32-node zones wide and one high. */
const MAP_W = 64;
const MAP_H = 32;
const EAST_ZONE = 1;
const BLOCKER_TYPE = 1;

/** Grass with one build-blocking landscape (a script's `blocker`, which no player removes) per node. */
function briefMap(blockers: readonly { hx: number; hy: number }[]): TerrainMap {
  return {
    ...grassNodeMap(MAP_W, MAP_H),
    landscapes: {
      types: [{ typeId: BLOCKER_TYPE, walk: [], build: [{ dx: 0, dy: 0 }], groups: ['blocker'] }],
      placements: blockers.map((at, id) => ({ id, typeId: BLOCKER_TYPE, ...at, level: 0 })),
    },
  };
}

function briefSim(blockers: readonly { hx: number; hy: number }[] = []): Simulation {
  return new Simulation({ seed: 1, content: aiContent(), map: briefMap(blockers) });
}

/** A felled-type resource at `at` whose footprint walk-blocks its own node and the one east of it. */
function tree(sim: Simulation, at: { hx: number; hy: number }): void {
  const e = sim.world.create();
  sim.world.add(e, Position, positionOfNode(at.hx, at.hy));
  sim.world.add(e, Resource, { goodType: WOOD, remaining: 4, harvestAtomic: WOOD_HARVEST });
  stampResourceFootprintData(sim.world, e, {
    walk: [
      { dx: 0, dy: 0 },
      { dx: 1, dy: 0 },
    ],
    build: [],
    work: [],
  });
}

function briefOf(sim: Simulation) {
  const brief = mapBriefOf(sim.world);
  if (brief === null) throw new Error('the computer player scanned no brief');
  return brief;
}

describe('map brief', () => {
  it('counts buildable ground as free, clearable under a tree and blocked under unremovable landscape', () => {
    const sim = briefSim([
      { hx: 40, hy: 10 },
      { hx: 50, hy: 20 },
    ]);
    tree(sim, { hx: 44, hy: 4 });
    makeAiSeat(sim, SEAT);
    sim.step();
    const brief = briefOf(sim);
    const zoneNodes = brief.zoneNodes * brief.zoneNodes;
    expect(brief.blocked[EAST_ZONE]).toBe(2);
    expect(brief.clearable[EAST_ZONE]).toBe(2);
    expect(brief.free[EAST_ZONE]).toBe(zoneNodes - 4);
    expect(brief.plantable[EAST_ZONE]).toBe(brief.free[EAST_ZONE]);
  });

  it('sums each deposit into the zone its node lies in', () => {
    const sim = briefSim();
    makeAiSeat(sim, SEAT);
    const iron = RESOURCE_SPOTS.iron;
    placeResources(
      sim,
      [
        { ...iron, x: 10, y: 5 },
        { ...iron, x: 40, y: 5 },
        { ...iron, x: 41, y: 20 },
      ],
      3,
    );
    sim.step();
    const brief = briefOf(sim);
    const column = brief.goods.indexOf('iron');
    expect(brief.deposits.filter((_, i) => i % brief.goods.length === column)).toEqual([3, 6]);
  });

  it('anchors a seat without a headquarters on its settlers', () => {
    const sim = briefSim();
    makeAiSeat(sim, SEAT);
    sim.enqueueSetup({ kind: 'spawnSettler', jobType: 6, x: 10, y: 10, tribe: VIKING, owner: SEAT });
    sim.enqueueSetup({ kind: 'spawnSettler', jobType: 6, x: 20, y: 14, tribe: VIKING, owner: SEAT });
    sim.step();
    expect(briefOf(sim).seats).toEqual([
      expect.objectContaining({ player: SEAT, hx: 15, hy: 12, buildings: [] }),
    ]);
  });

  it('is never taken while no seat runs a computer controller', () => {
    const sim = briefSim();
    makeAiSeat(sim, SEAT);
    for (const e of sim.world.query(AiControl)) sim.world.mut(e, AiControl).computerEnabled = false;
    spawnMen(sim, 2);
    sim.step();
    sim.step();
    expect(mapBriefOf(sim.world)).toBeNull();
    expect([...sim.world.query(MapBrief)]).toEqual([]);
  });

  it('passes to the next seat when its carrier hands its seat back to a human', () => {
    const sim = briefSim();
    const SECOND_SEAT = SEAT + 1;
    makeAiSeat(sim, SEAT);
    makeAiSeat(sim, SECOND_SEAT);
    sim.step();
    const brief = briefOf(sim);
    setAiControl(sim.world, ctxOf(sim), { kind: 'setAiControl', player: SEAT, enabled: false });
    expect(mapBriefOf(sim.world)).toBe(brief);
    expect([...sim.world.query(MapBrief)].map((e) => sim.world.get(e, AiControl).player)).toEqual([
      SECOND_SEAT,
    ]);
  });

  it('survives a save and restore unchanged', () => {
    const content = aiContent();
    const blockers = [{ hx: 40, hy: 10 }];
    const sim = briefSim(blockers);
    makeAiSeat(sim, SEAT);
    placeHq(sim);
    placeResources(sim);
    sim.step();
    const brief = briefOf(sim);
    expect(brief.seats.map((seat) => seat.buildings.map((b) => b.buildingType))).toEqual([[HQ_TYPE]]);
    const restored = restoreSimulation(parseSaveGame(JSON.parse(serializeSaveGame(exportSaveGame(sim)))), {
      content,
      map: briefMap(blockers),
    });
    expect(mapBriefOf(restored.world)).toEqual(brief);
  });
});
