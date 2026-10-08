import { describe, expect, it } from 'vitest';
import { BonePile, Health } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import {
  exportSaveGame,
  fx,
  parseSaveGame,
  restoreSimulation,
  Simulation,
  serializeSaveGame,
} from '../../src/index.js';
import { nodeOfPosition } from '../../src/nav/halfcell.js';
import { cleanupSystem } from '../../src/systems/index.js';
import { MAX_BONE_PILES } from '../../src/systems/lifecycle/death.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { settlerAt } from '../fixtures/settler.js';
import { grassCellMap } from '../fixtures/terrain.js';

/** A fallen human leaves a saved bone pile; the presentation fades it, no rule reads it. */

const BEAR = 10;
const DEATH_TILE = { x: fx.fromInt(6), y: fx.fromInt(6) };
const MAP_SIDE = 16;

const mappedSim = (): Simulation =>
  new Simulation({ seed: 1, content: testContent(), map: grassCellMap(MAP_SIDE, MAP_SIDE) });

function doomed(sim: Simulation, tribe?: number): Entity {
  const e = settlerAt(sim, {
    jobType: null,
    position: DEATH_TILE,
    ...(tribe !== undefined ? { tribe } : {}),
  });
  sim.world.add(e, Health, { hitpoints: 0, max: 1000 });
  return e;
}

const piles = (sim: Simulation) =>
  [...sim.world.canonicalQuery(BonePile)].map((e) => sim.world.get(e, BonePile));

describe('bone piles', () => {
  it('lies where a human fell, stamped with the tick, and never for an animal', () => {
    const sim = mappedSim();
    doomed(sim);
    doomed(sim, BEAR);
    const ctx = ctxOf(sim);
    cleanupSystem(sim.world, ctx);
    const at = nodeOfPosition(DEATH_TILE.x, DEATH_TILE.y);
    expect(piles(sim)).toEqual([{ hx: at.hx, hy: at.hy, tick: ctx.tick }]);
  });

  it('drops the oldest pile past the bound', () => {
    const sim = mappedSim();
    for (let i = 0; i < MAX_BONE_PILES; i++) doomed(sim);
    cleanupSystem(sim.world, ctxOf(sim));
    const first = [...sim.world.canonicalQuery(BonePile)];
    const [oldest] = first;
    doomed(sim);
    cleanupSystem(sim.world, ctxOf(sim));
    const held = sim.world.canonicalQuery(BonePile);
    expect(held).toHaveLength(MAX_BONE_PILES);
    expect(held).not.toContain(oldest);
    expect(held.at(-1)).toBeGreaterThan(Math.max(...first));
  });

  it('survives a save and load', () => {
    const sim = mappedSim();
    doomed(sim);
    cleanupSystem(sim.world, ctxOf(sim));
    const saved = serializeSaveGame(exportSaveGame(sim));
    const restored = restoreSimulation(parseSaveGame(JSON.parse(saved)), {
      content: testContent(),
      map: grassCellMap(MAP_SIDE, MAP_SIDE),
    });
    expect(piles(restored)).toEqual(piles(sim));
  });
});
