import { describe, expect, it } from 'vitest';
import {
  aiControlEntity,
  ComputerColony,
  PathFollow,
  PathRoute,
  Position,
  Settler,
  setSettlerJob,
} from '../../../src/components/index.js';
import { fx } from '../../../src/core/fixed.js';
import { exportSaveGame, parseSaveGame, restoreSimulation, serializeSaveGame } from '../../../src/index.js';
import { nodeOfPosition, positionOfNode } from '../../../src/nav/halfcell.js';
import type { TerrainGraph } from '../../../src/nav/terrain/index.js';
import {
  colonyBuildingsOn,
  colonySettlersOn,
  homeBuildings,
  homeSettlers,
} from '../../../src/systems/ai-shared/home-roster.js';
import { ownedBuildings, ownedSettlers } from '../../../src/systems/ai-shared/seat-roster.js';
import { seatBaseOf } from '../../../src/systems/computer-player/base.js';
import { homeStockOf } from '../../../src/systems/computer-player/home-stock.js';
import { seatStockOf } from '../../../src/systems/stores/index.js';
import { aiContent } from '../../fixtures/ai-content.js';
import { blankColony } from '../../fixtures/colony-islands.js';
import { ctxOf } from '../../fixtures/context.js';
import {
  COLONIST_AT,
  colonyLand,
  foundColony,
  HOME_HQ,
  islandMap,
  STRAIT_TO,
  seatOverSea,
  seatWithTwoColonies,
  storeOnColony,
} from '../../fixtures/seat-over-sea.js';
import { CIVILIST, SEAT, SPEARMAN } from '../computer-player/support.js';

/** Samples along a column step at which its position is read. */
const STEP_SAMPLES = 16;

/** A column step on `land` beside the strait, with a point on it whose position alone reads off `land`. */
function shoreColumnStep(terrain: TerrainGraph, land: number) {
  const onLand = (hx: number, hy: number) => terrain.componentOf(terrain.nodeAt(hx, hy)) === land;
  const shore = 2 * STRAIT_TO;
  for (let hx = shore - 1; hx <= shore + 1; hx++) {
    for (let hy = COLONIST_AT.y; hy < COLONIST_AT.y + 2; hy++) {
      if (!onLand(hx, hy) || !onLand(hx, hy + 2)) continue;
      const from = positionOfNode(hx, hy);
      const to = positionOfNode(hx, hy + 2);
      for (let i = 1; i < STEP_SAMPLES; i++) {
        const y = fx.add(
          from.y,
          fx.div(fx.mul(fx.sub(to.y, from.y), fx.fromInt(i)), fx.fromInt(STEP_SAMPLES)),
        );
        const read = nodeOfPosition(from.x, y);
        if (!onLand(read.hx, read.hy))
          return { from: { hx, hy }, to: { hx, hy: hy + 2 }, between: { x: from.x, y } };
      }
    }
  }
  throw new Error('setup: no column step passing over the water');
}

describe('the home view of a seat', () => {
  it('hands back the shared rosters and stock object while it holds no colony', () => {
    const sim = seatOverSea();
    const ctx = ctxOf(sim);
    expect(homeBuildings(sim.world, ctx, SEAT)).toBe(ownedBuildings(sim.world, SEAT));
    expect(homeSettlers(sim.world, ctx, SEAT)).toBe(ownedSettlers(sim.world, SEAT));
    expect(homeStockOf(sim.world, ctx, SEAT)).toBe(seatStockOf(sim.world, SEAT));
  });

  it('leaves the colony land out, but not a fighter standing there', () => {
    const sim = seatOverSea();
    const ctx = ctxOf(sim);
    const store = storeOnColony(sim);
    foundColony(sim);
    expect(homeBuildings(sim.world, ctx, SEAT)).toEqual(
      ownedBuildings(sim.world, SEAT).filter((e) => e !== store),
    );
    const settlers = ownedSettlers(sim.world, SEAT);
    expect(settlers).toHaveLength(3);
    expect(homeSettlers(sim.world, ctx, SEAT)).toHaveLength(2);
  });

  it('keeps its split through a colony write that moves no land, list or ship, and redoes it for one that does', () => {
    const sim = seatOverSea();
    foundColony(sim);
    const ctx = ctxOf(sim);
    const carrier = aiControlEntity(sim.world, SEAT);
    if (carrier === null) throw new Error('setup: no carrier');
    const colony = () => sim.world.mut(carrier, ComputerColony).colonies[0] ?? blankColony(0);
    const home = homeSettlers(sim.world, ctx, SEAT);
    colony().delivered = sim.tick;
    expect(homeSettlers(sim.world, ctx, SEAT)).toBe(home);
    const listed = home[0];
    if (listed === undefined) throw new Error('setup: nobody at home');
    colony().rest.push(listed);
    expect(homeSettlers(sim.world, ctx, SEAT)).not.toContain(listed);
  });

  it('reads a trade change on colony land as a restored game reads it', () => {
    const sim = seatOverSea();
    foundColony(sim);
    const soldier = ownedSettlers(sim.world, SEAT).find(
      (e) => sim.world.get(e, Settler).jobType === SPEARMAN,
    );
    if (soldier === undefined) throw new Error('setup: no soldier');
    expect(homeSettlers(sim.world, ctxOf(sim), SEAT)).toContain(soldier);
    setSettlerJob(sim.world, soldier, CIVILIST);
    const saved = parseSaveGame(JSON.parse(serializeSaveGame(exportSaveGame(sim))));
    const copy = restoreSimulation(saved, { content: aiContent(), map: islandMap() });
    expect(homeSettlers(sim.world, ctxOf(sim), SEAT)).not.toContain(soldier);
    expect(homeSettlers(sim.world, ctxOf(sim), SEAT)).toEqual(homeSettlers(copy.world, ctxOf(copy), SEAT));
  });

  it('keeps a colonist on the colony while a column step along its shore passes over the water', () => {
    const sim = seatOverSea();
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('setup: no terrain');
    const land = colonyLand(sim);
    const colonist = ownedSettlers(sim.world, SEAT).find((e) => {
      const { hx, hy } = nodeOfPosition(sim.world.get(e, Position).x, sim.world.get(e, Position).y);
      return (
        sim.world.get(e, Settler).jobType === CIVILIST && terrain.componentOf(terrain.nodeAt(hx, hy)) === land
      );
    });
    if (colonist === undefined) throw new Error('setup: no colonist');
    const step = shoreColumnStep(terrain, land);
    sim.world.add(colonist, PathRoute, {
      waypoints: [step.from, step.to].map(({ hx, hy }) => ({
        ...positionOfNode(hx, hy),
        node: terrain.nodeAt(hx, hy),
      })),
    });
    sim.world.add(colonist, PathFollow, { index: 1, legElapsed: 0, legCost: 0 });
    Object.assign(sim.world.mut(colonist, Position), step.between);
    foundColony(sim);
    expect(colonySettlersOn(sim.world, ctxOf(sim), SEAT, land)).toContain(colonist);
  });

  it('reports a split its key missed under the cache check', () => {
    const sim = seatOverSea();
    foundColony(sim);
    const colonist = colonySettlersOn(sim.world, ctxOf(sim), SEAT, colonyLand(sim))[0];
    if (colonist === undefined) throw new Error('setup: no colonist');
    expect(sim.world.verifyCaches()).toEqual([]);
    // A move by no ship, which the split's key never sees.
    Object.assign(sim.world.mut(colonist, Position), positionOfNode(HOME_HQ.x, HOME_HQ.y));
    expect(sim.world.verifyCaches()).toEqual([
      `homeSettlerSplit of seat ${SEAT} disagrees with a fresh derivation: its key missed a change`,
    ]);
  });

  it('never elects a colony store as the seat base', () => {
    const sim = seatOverSea();
    const ctx = ctxOf(sim);
    const hq = seatBaseOf(sim.world, ctx, SEAT);
    if (hq === null) throw new Error('setup: no base');
    foundColony(sim);
    sim.world.destroy(hq);
    expect(seatBaseOf(sim.world, ctx, SEAT)).toBeNull();
  });

  it('parts the seat between its colonies, each with its own land', () => {
    const { sim, lands } = seatWithTwoColonies();
    const ctx = ctxOf(sim);
    const [near, far] = lands;
    const buildings = ownedBuildings(sim.world, SEAT);
    const hq = seatBaseOf(sim.world, ctx, SEAT);
    expect(homeBuildings(sim.world, ctx, SEAT)).toEqual([hq]);
    const nearBuildings = colonyBuildingsOn(sim.world, ctx, SEAT, near);
    const farBuildings = colonyBuildingsOn(sim.world, ctx, SEAT, far);
    expect(nearBuildings).toHaveLength(1);
    expect(farBuildings).toHaveLength(1);
    expect([hq, ...nearBuildings, ...farBuildings].sort((a, b) => Number(a) - Number(b))).toEqual(buildings);
    expect(colonySettlersOn(sim.world, ctx, SEAT, near)).toHaveLength(1);
    expect(colonySettlersOn(sim.world, ctx, SEAT, far)).toHaveLength(1);
    expect(homeSettlers(sim.world, ctx, SEAT)).toHaveLength(2);
  });

  it('counts a man listed for the far colony its own while he still stands at home', () => {
    const { sim, lands } = seatWithTwoColonies();
    const ctx = ctxOf(sim);
    const [, far] = lands;
    const man = homeSettlers(sim.world, ctx, SEAT).find(
      (e) => sim.world.get(e, Settler).jobType === CIVILIST,
    );
    if (man === undefined) throw new Error('setup: no civilian at home');
    const carrier = aiControlEntity(sim.world, SEAT);
    if (carrier === null) throw new Error('setup: no carrier');
    sim.world.mut(carrier, ComputerColony).colonies[1]?.rest.push(man);
    expect(colonySettlersOn(sim.world, ctx, SEAT, far)).toContain(man);
    expect(homeSettlers(sim.world, ctx, SEAT)).not.toContain(man);
  });

  it('keeps a colony write off another seat', () => {
    const { sim } = seatWithTwoColonies();
    const ctx = ctxOf(sim);
    const before = homeSettlers(sim.world, ctx, SEAT);
    const other = sim.world.create();
    sim.world.add(other, ComputerColony, { colonies: [], rejected: [], retryAt: 0 });
    sim.world.mut(other, ComputerColony).retryAt = 1;
    expect(homeSettlers(sim.world, ctx, SEAT)).toBe(before);
  });
});
