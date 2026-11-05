import { describe, expect, it } from 'vitest';
import {
  Building,
  Carrying,
  FishSwarm,
  GroundDrop,
  HaulFlag,
  JobAssignment,
  Position,
  ProductionCounters,
  Resource,
  Stockpile,
  WorkFlag,
} from '../../../../src/components/index.js';
import { type Fixed, ONE, positionOfNode, Simulation } from '../../../../src/index.js';
import { anchorOnlyFootprint, stampResourceFootprintData } from '../../../../src/systems/index.js';
import { testContent } from '../../../fixtures/content.js';
import { settlerAt } from '../../../fixtures/settler.js';
import { grassNodeMap } from '../../../fixtures/terrain.js';
import { bindToFlag, riverMap } from './gatherer-flag/support.js';

function tree(sim: Simulation, hx: number, hy: number): void {
  const entity = sim.world.create();
  sim.world.add(entity, Position, positionOfNode(hx, hy));
  sim.world.add(entity, Resource, { goodType: 1, remaining: 3, harvestAtomic: 24 });
  stampResourceFootprintData(sim.world, entity, anchorOnlyFootprint());
}

function pile(sim: Simulation, at: { x: Fixed; y: Fixed }): void {
  const entity = sim.world.create();
  sim.world.add(entity, Position, { x: at.x, y: at.y });
  sim.world.add(entity, Stockpile, { amounts: new Map([[1, 1]]) });
  sim.world.add(entity, GroundDrop, { goodType: 1 });
}

function worker(sim: Simulation) {
  return settlerAt(sim, { jobType: 1, tribe: 1, position: positionOfNode(2, 4) });
}

describe('selected gatherer work diagnostics', () => {
  it('reports absent work and stays pure when repeated', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassNodeMap(20, 12) });
    const entity = worker(sim);
    const before = sim.hashState();
    expect(sim.workStatus(entity)).toEqual({ kind: 'noEligibleResource', goodTypes: [1], scope: 'map' });
    expect(sim.workStatus(entity)).toEqual({ kind: 'noEligibleResource', goodTypes: [1], scope: 'map' });
    expect(sim.hashState()).toBe(before);
    tree(sim, 5, 4);
    expect(sim.workStatus(entity)).toEqual({ kind: 'unknown', reason: 'gatherSearch' });
  });

  it('distinguishes resources outside a flag area from resources behind a river', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: riverMap(20, 12, [8]) });
    const entity = worker(sim);
    tree(sim, 12, 4);
    expect(sim.workStatus(entity)).toEqual({ kind: 'resourceRouteBlocked', goodTypes: [1] });
    bindToFlag(sim, entity, 1, 2, 3);
    expect(sim.workStatus(entity)).toEqual({ kind: 'noEligibleResource', goodTypes: [1], scope: 'workArea' });
  });

  it("bounds a posted gatherer's search to the flag its post took", () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassNodeMap(60, 12) });
    const entity = worker(sim);
    const post = sim.world.create();
    sim.world.add(post, Position, positionOfNode(4, 4));
    sim.world.add(post, Building, { buildingType: 1, tribe: 1, built: ONE, level: 0 });
    sim.world.add(post, Stockpile, { amounts: new Map() });
    sim.world.add(entity, JobAssignment, { workplace: post });
    tree(sim, 8, 4);
    expect(sim.workStatus(entity)).toEqual({ kind: 'unknown', reason: 'gatherSearch' });

    const flag = bindToFlag(sim, entity, 25, 2, 3);
    const radius = sim.world.get(entity, WorkFlag).radius;
    sim.world.remove(entity, WorkFlag);
    sim.world.add(entity, HaulFlag, { flag, radius });
    expect(sim.workStatus(entity)).toEqual({ kind: 'noEligibleResource', goodTypes: [1], scope: 'workArea' });
    // A loose trunk by the post is no work for it; one by the flag is.
    pile(sim, positionOfNode(4, 4));
    expect(sim.workStatus(entity)).toEqual({ kind: 'noEligibleResource', goodTypes: [1], scope: 'workArea' });
    pile(sim, sim.world.get(flag, Position));
    expect(sim.workStatus(entity)).toEqual({ kind: 'unknown', reason: 'gatherSearch' });
  });

  it('reports blocked approaches when a building covers the resource work cell', () => {
    const base = testContent();
    const content = {
      ...base,
      buildings: base.buildings.map((building) =>
        building.typeId === 9
          ? {
              ...building,
              footprint: { blocked: [{ dx: 0, dy: 0 }], familyBody: [], reserved: [], workArea: [] },
            }
          : building,
      ),
    };
    const sim = new Simulation({ seed: 1, content, map: grassNodeMap(20, 12) });
    const entity = worker(sim);
    tree(sim, 5, 4);
    const building = sim.world.create();
    sim.world.add(building, Position, positionOfNode(5, 4));
    sim.world.add(building, Building, { buildingType: 9, tribe: 1, built: ONE, level: 0 });
    expect(sim.workStatus(entity)).toEqual({ kind: 'resourceRouteBlocked', goodTypes: [1] });
  });

  it('diagnoses a stranded last load before the exhausted gathering counter', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassNodeMap(20, 12) });
    const entity = worker(sim);
    sim.world.add(entity, ProductionCounters, { counters: [[1, 0]], cursor: 0 });
    sim.world.add(entity, Carrying, { goodType: 1, amount: 1 });
    expect(sim.workStatus(entity)).toEqual({ kind: 'noOutputDestination', goodType: 1, reason: 'noStorage' });
    sim.world.remove(entity, Carrying);
    expect(sim.workStatus(entity)).toEqual({ kind: 'nothingSelected' });
  });

  it('reports a stopped fisher selection, and no fish once no swarm with fish lies in reach', () => {
    const base = testContent();
    const content = {
      ...base,
      jobs: base.jobs.map((job) => (job.typeId === 1 ? { ...job, id: 'fisher' } : job)),
    };
    const sim = new Simulation({ seed: 1, content, map: grassNodeMap(160, 12) });
    const entity = worker(sim);
    sim.world.add(entity, ProductionCounters, { counters: [[1, 0]], cursor: 0 });
    expect(sim.workStatus(entity)).toEqual({ kind: 'nothingSelected' });
    sim.world.remove(entity, ProductionCounters);
    expect(sim.workStatus(entity)).toEqual({ kind: 'noFish' });

    // A fished-out swarm is no work; one with fish left in reach of the shore search may be.
    const swarm = sim.world.create();
    sim.world.add(swarm, Position, positionOfNode(30, 4));
    sim.world.add(swarm, FishSwarm, { count: 0, continent: 0, shore: null });
    expect(sim.workStatus(entity)).toEqual({ kind: 'noFish' });
    sim.world.mut(swarm, FishSwarm).count = 1;
    expect(sim.workStatus(entity)).toEqual({ kind: 'unknown', reason: 'gatherSearch' });

    // A flag moves where the search starts, the one a post took as well.
    const flag = bindToFlag(sim, entity, 70, 2, 3);
    expect(sim.workStatus(entity)).toEqual({ kind: 'noFish' });
    const radius = sim.world.get(entity, WorkFlag).radius;
    sim.world.remove(entity, WorkFlag);
    const post = sim.world.create();
    sim.world.add(post, Position, positionOfNode(4, 4));
    sim.world.add(post, Building, { buildingType: 1, tribe: 1, built: ONE, level: 0 });
    sim.world.add(post, Stockpile, { amounts: new Map() });
    sim.world.add(entity, JobAssignment, { workplace: post });
    expect(sim.workStatus(entity)).toEqual({ kind: 'unknown', reason: 'gatherSearch' });
    sim.world.add(entity, HaulFlag, { flag, radius });
    expect(sim.workStatus(entity)).toEqual({ kind: 'noFish' });
  });

  it('keeps an incomplete search explicit', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassNodeMap(40, 20) });
    const entity = worker(sim);
    for (let i = 0; i < 129; i++) tree(sim, 10 + (i % 20), 6 + Math.floor(i / 20));
    expect(sim.workStatus(entity)).toEqual({ kind: 'unknown', reason: 'gatherSearch' });
  });
});
