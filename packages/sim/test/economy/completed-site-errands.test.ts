import { parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  addCurrentAtomic,
  Building,
  Carrying,
  Chat,
  CurrentAtomic,
  JobAssignment,
  MoveGoal,
  PathFollow,
  PathRequest,
  PathRoute,
  PlayerOrder,
  Position,
  ResourceFootprint,
  SiteAssignment,
  Stockpile,
  Stranded,
  SupplyRun,
  UnderConstruction,
  UnreachableGoals,
} from '../../src/components/index.js';
import { ZERO } from '../../src/core/fixed.js';
import type { Entity } from '../../src/ecs/world.js';
import { ONE, positionOfNode, Simulation } from '../../src/index.js';
import { nodeOfPosition } from '../../src/nav/halfcell.js';
import { forceFinishConstruction } from '../../src/systems/economy/construction.js';
import {
  constructionSystem,
  constructionWorkCell,
  dynamicBlockOverlay,
  walkBlockedBodyOf,
} from '../../src/systems/index.js';
import { collectInboundSupply } from '../../src/systems/stores/supply-tally.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { settlerAt } from '../fixtures/settler.js';
import { grassNodeMap } from '../fixtures/terrain.js';

function scenario() {
  const base = testContent();
  const content = parseContentSet({
    ...base,
    jobs: base.jobs.map((job) => (job.typeId === 7 ? { ...job, id: 'builder', allowedAtomics: [39] } : job)),
    buildings: [
      ...base.buildings.filter((b) => b.typeId !== 2),
      {
        typeId: 2,
        id: 'home_small',
        kind: 'home',
        homeSize: 1,
        upgradeTarget: 98,
        footprint: { blocked: [{ dx: 0, dy: 0 }], door: { dx: 1, dy: 0 } },
      },
      {
        typeId: 98,
        id: 'home_large',
        kind: 'home',
        homeSize: 2,
        construction: [{ goodType: 1, amount: 1 }],
        footprint: { blocked: [-2, -1, 0, 1].map((dx) => ({ dx, dy: 0 })), door: { dx: 2, dy: 0 } },
      },
    ],
  });
  const sim = new Simulation({ seed: 1, content, map: grassNodeMap(128, 40) });
  const site = sim.world.create();
  sim.world.add(site, Position, positionOfNode(90, 20));
  sim.world.add(site, Building, { buildingType: 2, tribe: 1, built: ONE, level: 0 });
  sim.world.add(site, Stockpile, { amounts: new Map([[1, 1]]) });
  const builder = settlerAt(sim, { jobType: 7, position: positionOfNode(10, 20) });
  sim.enqueueSetup({ kind: 'upgradeBuilding', building: site });
  sim.step();
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('missing terrain');
  const goal = sim.world.get(builder, MoveGoal).cell;
  expect(sim.world.get(builder, SiteAssignment).site).toBe(site);
  return { sim, site, builder, terrain, goal };
}

function observe(sim: Simulation, builder: Entity, oldGoal: number, ticks: number) {
  let lost = 0;
  for (let i = 0; i < ticks; i++) {
    sim.step();
    expect(sim.world.has(builder, Stranded)).toBe(false);
    expect(
      sim.world.tryGet(builder, UnreachableGoals)?.entries.some((entry) => entry.cell === oldGoal),
    ).not.toBe(true);
    lost += sim.events
      .current()
      .filter((event) => event.kind === 'settlerLost' && event.entity === builder).length;
  }
  expect(lost).toBe(0);
}

function anotherSite(sim: Simulation) {
  const site = sim.world.create();
  sim.world.add(site, Position, positionOfNode(30, 20));
  sim.world.add(site, Building, { buildingType: 98, tribe: 1, built: ZERO, level: 0 });
  sim.world.add(site, Stockpile, { amounts: new Map([[1, 1]]) });
  sim.world.add(site, UnderConstruction, { labor: ZERO });
  return site;
}

describe('completed construction errands', () => {
  it('retires an approaching builder during ordinary completion and lets it take another site', () => {
    const { sim, site, builder, terrain, goal } = scenario();
    const stance = constructionWorkCell(
      sim.world,
      ctxOf(sim),
      terrain,
      site,
      dynamicBlockOverlay(sim.world, ctxOf(sim), terrain),
      goal,
    );
    if (stance === null) throw new Error('missing work cell');
    settlerAt(sim, { jobType: 7, position: positionOfNode(terrain.xOf(stance), terrain.yOf(stance)) });
    let finished = false;
    for (let i = 0; i < 500; i++) {
      sim.step();
      expect(
        sim.events.current().some((event) => event.kind === 'settlerLost' && event.entity === builder),
      ).toBe(false);
      if (sim.world.get(site, Building).buildingType !== 98) continue;
      expect(walkBlockedBodyOf(sim.world, ctxOf(sim), terrain, site)?.has(goal)).toBe(true);
      expect(sim.world.has(builder, SiteAssignment)).toBe(false);
      expect(sim.world.has(builder, MoveGoal)).toBe(false);
      expect(sim.world.has(builder, PathRequest)).toBe(false);
      finished = true;
      break;
    }
    expect(finished).toBe(true);
    const next = anotherSite(sim);
    observe(sim, builder, goal, 30);
    expect(sim.world.get(builder, SiteAssignment).site).toBe(next);
  });

  it('finishes only the live step when completion catches a builder mid-stride', () => {
    const { sim, site, builder, terrain, goal } = scenario();
    const start = positionOfNode(10, 20);
    for (let i = 0; i < 20; i++) {
      sim.step();
      const p = sim.world.get(builder, Position);
      const n = nodeOfPosition(p.x, p.y);
      const centre = positionOfNode(n.hx, n.hy);
      if (p.x !== centre.x || p.y !== centre.y) break;
    }
    const before = sim.world.get(builder, Position);
    expect(before).not.toEqual(start);
    const follow = sim.world.get(builder, PathFollow);
    const stops = sim.world.get(builder, PathRoute).waypoints;
    const next = stops.slice(follow.index).find((stop) => {
      const centre = positionOfNode(terrain.xOf(stop.node), terrain.yOf(stop.node));
      return stop.x === centre.x && stop.y === centre.y;
    });
    if (next === undefined) throw new Error('missing next centre');
    expect(sim.world.has(builder, PathFollow)).toBe(true);
    forceFinishConstruction(sim.world, ctxOf(sim), site);
    expect(sim.world.get(builder, Position)).toEqual(before);
    expect(sim.world.has(builder, PathFollow)).toBe(true);
    expect(sim.world.has(builder, MoveGoal)).toBe(false);
    for (let i = 0; i < 30 && sim.world.has(builder, PathFollow); i++) sim.step();
    expect(sim.world.has(builder, PathFollow)).toBe(false);
    expect(sim.world.get(builder, Position)).toEqual({ x: next.x, y: next.y });
    observe(sim, builder, goal, 30);
  });

  it('releases an outstanding delivery promise without losing the carried unit or workplace binding', () => {
    const { sim, site, builder, goal } = scenario();
    sim.world.add(builder, Carrying, { goodType: 1, amount: 1 });
    sim.world.add(builder, SupplyRun, { site, goodType: 1, amount: 1, source: null });
    sim.world.add(builder, JobAssignment, { workplace: site });
    sim.world.add(builder, SiteAssignment, { site, pinned: true });
    forceFinishConstruction(sim.world, ctxOf(sim), site);
    expect(sim.world.has(builder, SupplyRun)).toBe(false);
    expect(sim.world.has(builder, SiteAssignment)).toBe(false);
    expect(sim.world.get(builder, JobAssignment).workplace).toBe(site);
    expect(sim.world.get(builder, Carrying)).toEqual({ goodType: 1, amount: 1 });
    expect(sim.world.get(site, Stockpile).amounts.get(1)).toBe(1);
    expect(collectInboundSupply(sim.world).inbound.size).toBe(0);
    observe(sim, builder, goal, 30);
  });

  it('releases source reservations before the redundant material is picked up', () => {
    const { sim, site, builder, terrain } = scenario();
    const source = sim.world.create();
    sim.world.add(source, Position, positionOfNode(20, 20));
    sim.world.add(source, Stockpile, { amounts: new Map([[1, 1]]) });
    sim.world.add(builder, SupplyRun, { site, goodType: 1, amount: 1, source });
    sim.world.add(builder, MoveGoal, { cell: terrain.nodeAt(20, 20) });
    forceFinishConstruction(sim.world, ctxOf(sim), site);
    expect(sim.world.has(builder, MoveGoal)).toBe(false);
    expect(sim.world.has(builder, SupplyRun)).toBe(false);
    expect(sim.world.get(source, Stockpile).amounts.get(1)).toBe(1);
    expect(collectInboundSupply(sim.world).reservedAtSource.size).toBe(0);
  });

  it('ends a redundant pickup atomic without taking its promised source goods', () => {
    const { sim, site, builder } = scenario();
    const source = sim.world.create();
    sim.world.add(source, Stockpile, { amounts: new Map([[1, 1]]) });
    sim.world.add(builder, SupplyRun, { site, goodType: 1, amount: 1, source });
    addCurrentAtomic(sim.world, builder, {
      atomicId: 22,
      duration: 5,
      effect: { kind: 'pickup', goodType: 1, amount: 1, from: source },
      targetEntity: source,
      targetTile: null,
    });
    forceFinishConstruction(sim.world, ctxOf(sim), site);
    expect(sim.world.has(builder, CurrentAtomic)).toBe(false);
    expect(sim.world.has(builder, SupplyRun)).toBe(false);
    expect(sim.world.get(source, Stockpile).amounts.get(1)).toBe(1);
  });

  it('preserves an unrelated conversation held by a former crew member', () => {
    const { sim, site, builder, goal } = scenario();
    const partner = settlerAt(sim, { jobType: 1, position: positionOfNode(30, 20) });
    sim.world.add(builder, Chat, { partner, seeker: true, speaks: true, talking: false, kind: 'company' });
    forceFinishConstruction(sim.world, ctxOf(sim), site);
    expect(sim.world.get(builder, MoveGoal).cell).toBe(goal);
    expect(sim.world.has(builder, Chat)).toBe(true);
  });

  it('leaves unrelated player routes intact when crew affiliation survives the order', () => {
    const { sim, site, builder, goal } = scenario();
    sim.world.add(builder, PlayerOrder, {});
    forceFinishConstruction(sim.world, ctxOf(sim), site);
    expect(sim.world.get(builder, MoveGoal).cell).toBe(goal);
    expect(sim.world.has(builder, SiteAssignment)).toBe(false);
  });

  it('retires a formerly valid approach even if another blocker already closed it', () => {
    const { sim, site, builder, terrain, goal } = scenario();
    const blocker = sim.world.create();
    sim.world.add(blocker, Position, positionOfNode(terrain.xOf(goal), terrain.yOf(goal)));
    sim.world.add(blocker, ResourceFootprint, { walk: [{ dx: 0, dy: 0 }], build: [], work: [] });
    sim.world.add(builder, PathRequest, { start: terrain.nodeAt(10, 20), goal, failed: true });
    sim.world.add(builder, Stranded, { retryAt: sim.tick + 50 });
    forceFinishConstruction(sim.world, ctxOf(sim), site);
    expect(sim.world.has(builder, MoveGoal)).toBe(false);
    expect(sim.world.has(builder, PathRequest)).toBe(false);
    expect(sim.world.has(builder, Stranded)).toBe(false);
    observe(sim, builder, goal, 100);
  });

  it('keeps the approach and pin while the original site remains unfinished', () => {
    const { sim, site, builder, goal } = scenario();
    sim.world.add(builder, SiteAssignment, { site, pinned: true });
    constructionSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(site, UnderConstruction)).toBe(true);
    expect(sim.world.get(builder, MoveGoal).cell).toBe(goal);
    expect(sim.world.get(builder, SiteAssignment)).toEqual({ site, pinned: true });
  });
});
