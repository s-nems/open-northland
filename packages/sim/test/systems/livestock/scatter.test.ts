import { describe, expect, it } from 'vitest';
import {
  FarmAnimal,
  Frightened,
  Position,
  Stockpile,
  setDiplomacyStance,
  setPeaceTime,
} from '../../../src/components/index.js';
import type { Entity, Simulation } from '../../../src/index.js';
import { positionOfNode } from '../../../src/index.js';
import { animalFrightSystem } from '../../../src/systems/conflict/fright.js';
import { FARM_HERD_LEASH_NODES, livestockCaptureSystem } from '../../../src/systems/index.js';
import { SCATTER_CALM_TICKS, SCATTER_RANGE } from '../../../src/systems/livestock/scatter.js';
import { hexNodeDistance, manhattan } from '../../../src/systems/spatial/metric.js';
import { entityNode } from '../../../src/systems/spatial/nodes.js';
import { nextTickCtxOf } from '../../fixtures/context.js';
import { breederAt, COW_GOOD, cowAt, ctxOf, farmAt, livestockSim, scoutAt } from './support.js';

const P0 = 0;
const P1 = 1;
const P2 = 2;

function stepTo(sim: Simulation, e: Entity, hx: number, hy: number): void {
  const at = positionOfNode(hx, hy);
  const p = sim.world.mut(e, Position);
  p.x = at.x;
  p.y = at.y;
}

function nodeOf(sim: Simulation, e: Entity) {
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('livestockSim has a map');
  return { terrain, node: entityNode(sim.world, terrain, e) };
}

function scattering(sim: Simulation, e: Entity): boolean {
  return sim.world.tryGet(e, Frightened)?.scatter === true;
}

describe('livestock scatter - owned stock runs from an enemy scout', () => {
  it('each animal near an enemy scout runs its own way, away from the scout', () => {
    const sim = livestockSim();
    setDiplomacyStance(sim.world, P0, P1, 'enemy');
    const herd = [
      cowAt(sim, 30, 30, { owner: P1 }),
      cowAt(sim, 30, 30, { owner: P1 }),
      cowAt(sim, 30, 30, { owner: P1 }),
    ];
    const straggler = cowAt(sim, 40, 30, { owner: P1 }); // out of the scout's scatter range
    const scout = scoutAt(sim, 30 - SCATTER_RANGE, 30, P0);

    livestockCaptureSystem(sim.world, ctxOf(sim));
    animalFrightSystem(sim.world, nextTickCtxOf(sim));

    expect(sim.world.has(straggler, Frightened)).toBe(false);

    const { terrain, node: scoutNode } = nodeOf(sim, scout);
    const dests = herd.map((cow) => {
      const f = sim.world.get(cow, Frightened);
      expect(f.scatter).toBe(true);
      if (f.dest === null) throw new Error('the flight is aimed on its first tick');
      expect(hexNodeDistance(terrain, f.dest, scoutNode)).toBeGreaterThan(
        hexNodeDistance(terrain, nodeOf(sim, cow).node, scoutNode),
      );
      return f.dest;
    });
    expect(new Set(dests).size).toBe(herd.length);
  });

  it('an own, allied or neutral scout sets no one running, and wild stock never scatters', () => {
    const sim = livestockSim();
    setDiplomacyStance(sim.world, P0, P1, 'friend');
    setDiplomacyStance(sim.world, P2, P1, 'neutral');
    const own = cowAt(sim, 30, 30, { owner: P1 });
    const wild = cowAt(sim, 31, 30); // beyond every scout's claim reach, inside the scatter range
    scoutAt(sim, 26, 30, P1);
    scoutAt(sim, 26, 31, P0);
    scoutAt(sim, 26, 32, P2);

    livestockCaptureSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(own, Frightened)).toBe(false);
    expect(sim.world.has(wild, Frightened)).toBe(false);
  });

  it("a peace partner's scout sets no one running while the lobby peace holds", () => {
    const sim = livestockSim();
    setDiplomacyStance(sim.world, P0, P1, 'enemy');
    setPeaceTime(sim.world, sim.tick, sim.tick + 1, [P0, P1]);
    const cow = cowAt(sim, 30, 30, { owner: P1 });
    scoutAt(sim, 30 - SCATTER_RANGE, 30, P0);

    livestockCaptureSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(cow, Frightened)).toBe(false);
  });

  it('only a scout step scatters: stock that wanders up to a standing scout stays calm', () => {
    const sim = livestockSim();
    setDiplomacyStance(sim.world, P0, P1, 'enemy');
    const scout = scoutAt(sim, 20, 20, P0);
    const cow = cowAt(sim, 50, 50, { owner: P1 });
    livestockCaptureSystem(sim.world, ctxOf(sim)); // first sight, nothing in range

    stepTo(sim, cow, 24, 20);
    livestockCaptureSystem(sim.world, nextTickCtxOf(sim));
    expect(sim.world.has(cow, Frightened)).toBe(false);

    stepTo(sim, scout, 20, 21);
    livestockCaptureSystem(sim.world, nextTickCtxOf(sim));
    expect(scattering(sim, cow)).toBe(true);
  });

  it('a scattered animal ignores further scout steps until it has calmed down', () => {
    const sim = livestockSim();
    setDiplomacyStance(sim.world, P0, P1, 'enemy');
    const scout = scoutAt(sim, 20, 20, P0);
    const cow = cowAt(sim, 24, 20, { owner: P1 });
    livestockCaptureSystem(sim.world, ctxOf(sim));
    expect(scattering(sim, cow)).toBe(true);
    sim.world.remove(cow, Frightened); // its flight ended where it stood

    stepTo(sim, scout, 20, 21);
    livestockCaptureSystem(sim.world, nextTickCtxOf(sim));
    expect(sim.world.has(cow, Frightened)).toBe(false);

    for (let i = 0; i < SCATTER_CALM_TICKS; i++) nextTickCtxOf(sim);
    stepTo(sim, scout, 20, 22);
    livestockCaptureSystem(sim.world, ctxOf(sim));
    expect(scattering(sim, cow)).toBe(true);
  });

  it('a farm animal runs, then comes back inside its leash still in its farm herd', () => {
    const sim = livestockSim();
    setDiplomacyStance(sim.world, P0, P1, 'enemy');
    const farm = farmAt(sim, 30, 30, { owner: P1, stock: [[COW_GOOD, 1]] });
    breederAt(sim, 30, 30, farm);
    const cow = cowAt(sim, 30, 34, { owner: P1, farm });
    const scout = scoutAt(sim, 30, 34 + SCATTER_RANGE, P0);
    livestockCaptureSystem(sim.world, ctxOf(sim));
    expect(scattering(sim, cow)).toBe(true);
    sim.world.destroy(scout); // only the flight and the herding drives are under test

    const door = nodeOf(sim, farm).node;
    let ranOff = false;
    for (let t = 0; t < SCATTER_CALM_TICKS && !(ranOff && !sim.world.has(cow, Frightened)); t++) {
      sim.step();
      const { terrain, node } = nodeOf(sim, cow);
      ranOff ||= manhattan(terrain, node, door) > FARM_HERD_LEASH_NODES;
    }
    expect(ranOff).toBe(true);
    for (let t = 0; t < SCATTER_CALM_TICKS; t++) sim.step();

    const { terrain, node } = nodeOf(sim, cow);
    expect(manhattan(terrain, node, door)).toBeLessThanOrEqual(FARM_HERD_LEASH_NODES);
    expect(sim.world.tryGet(cow, FarmAnimal)?.farm).toBe(farm);
    expect(sim.world.get(farm, Stockpile).amounts.get(COW_GOOD)).toBe(1);
  });
});
