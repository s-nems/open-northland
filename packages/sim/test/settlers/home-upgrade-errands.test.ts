import { parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  Building,
  CurrentAtomic,
  HomeQuality,
  MoveGoal,
  PathFollow,
  PathRequest,
  PlayerOrder,
  Position,
  Residence,
  ResourceFootprint,
  Resting,
  Settler,
  SiteAssignment,
  Stockpile,
  Stranded,
  setSettlerJob,
  UnreachableGoals,
} from '../../src/components/index.js';
import { ZERO } from '../../src/core/fixed.js';
import type { Entity } from '../../src/ecs/world.js';
import { ONE, positionOfNode, Simulation } from '../../src/index.js';
import type { NodeId } from '../../src/nav/terrain/index.js';
import { residentsOf } from '../../src/systems/family/households.js';
import { constructionWorkCell, dynamicBlockOverlay, plannerSystem } from '../../src/systems/index.js';
import { prayAtHome } from '../../src/systems/settlers/drives/home-errands.js';
import { interactionCell } from '../../src/systems/settlers/targets/workplaces.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { settlerAt } from '../fixtures/settler.js';
import { grassNodeMap } from '../fixtures/terrain.js';

function scenario(tribe = 1, unchangedDoor = false) {
  const base = testContent();
  // Opposite-side entrances exercise both base and nation-specific footprint selection.
  const footprint = (door: number, grown: boolean) => ({
    door: { dx: door, dy: 0 },
    blocked: [-2, -1, 0, 1, 2].filter((x) => x !== door && (grown || x === 0)).map((dx) => ({ dx, dy: 0 })),
  });
  const content = parseContentSet({
    ...base,
    goods: [
      ...base.goods,
      {
        typeId: 99,
        id: 'oil',
        homeQuality: {
          effect: 'piety',
          capacity: 1000,
          deliveryValue: 1000,
          useCost: 1,
          fetchBelow: 100,
          minimumHomeLevel: 0,
        },
      },
    ],
    atomicAnimations: [
      ...base.atomicAnimations,
      {
        id: 'viking_pray_home',
        name: 'viking_pray_home',
        length: 5,
        events: [{ at: 1, type: 4, value: 800 }],
      },
    ],
    jobs: base.jobs.map((job) => (job.typeId === 7 ? { ...job, id: 'builder', allowedAtomics: [39] } : job)),
    tribes: [...base.tribes, { ...base.tribes[0], typeId: 7, id: 'egypt' }],
    buildings: [
      ...base.buildings.filter((b) => b.typeId !== 2),
      {
        typeId: 2,
        id: 'home_small',
        kind: 'home',
        homeSize: 1,
        upgradeTarget: 98,
        footprint: footprint(-2, false),
        tribeVariants: [{ tribe: 7, footprint: footprint(2, false) }],
      },
      {
        typeId: 98,
        id: 'home_large',
        kind: 'home',
        homeSize: 2,
        construction: [{ goodType: 1, amount: 1 }],
        footprint: footprint(unchangedDoor ? -2 : 2, true),
        tribeVariants: [{ tribe: 7, footprint: footprint(unchangedDoor ? 2 : -2, true) }],
      },
    ],
  });
  const sim = new Simulation({ seed: 1, content, map: grassNodeMap(128, 40) });
  const home = sim.world.create();
  sim.world.add(home, Position, positionOfNode(90, 20));
  sim.world.add(home, Building, { buildingType: 2, tribe, built: ONE, level: 0 });
  sim.world.add(home, Stockpile, {
    amounts: new Map([
      [1, 1],
      [3, 2],
    ]),
  });
  const resident = settlerAt(sim, {
    tribe,
    jobType: 1,
    needs: { fatigue: ONE },
    position: positionOfNode(10, 20),
  });
  sim.world.add(resident, Residence, { home });
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('missing terrain');
  const oldDoor = interactionCell(sim.world, ctxOf(sim), terrain, home);
  return { sim, home, resident, terrain, oldDoor };
}

function finish(sim: Simulation, home: Entity) {
  sim.enqueueSetup({ kind: 'upgradeBuilding', building: home });
  sim.enqueueSetup({ kind: 'debugCompleteConstruction', target: home });
  sim.step();
}

function observe(sim: Simulation, resident: Entity, home: Entity, oldDoor: NodeId, ticks = 1000) {
  let entered = false;
  let lost = 0;
  for (let i = 0; i < ticks; i++) {
    sim.step();
    expect(sim.world.has(resident, Stranded)).toBe(false);
    expect(
      sim.world.tryGet(resident, UnreachableGoals)?.entries.some((entry) => entry.cell === oldDoor),
    ).not.toBe(true);
    lost += sim.events
      .current()
      .filter((event) => event.kind === 'settlerLost' && event.entity === resident).length;
    entered ||= sim.world.tryGet(resident, Resting)?.at === home;
  }
  return { entered, lost };
}

describe('home errands during an entrance-changing upgrade', () => {
  it.each([1, 7])('retargets a travelling resident during ordinary completion for tribe %i', (tribe) => {
    const { sim, home, resident, terrain, oldDoor } = scenario(tribe);
    plannerSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(resident, MoveGoal).cell).toBe(oldDoor);
    sim.step();
    sim.enqueueSetup({ kind: 'upgradeBuilding', building: home });
    sim.step();
    const stance = constructionWorkCell(
      sim.world,
      ctxOf(sim),
      terrain,
      home,
      dynamicBlockOverlay(sim.world, ctxOf(sim), terrain),
      oldDoor,
    );
    if (stance === null) throw new Error('missing work cell');
    settlerAt(sim, { tribe, jobType: 7, position: positionOfNode(terrain.xOf(stance), terrain.yOf(stance)) });
    expect(observe(sim, resident, home, oldDoor)).toEqual({ entered: true, lost: 0 });
    expect(sim.world.get(home, Building).buildingType).toBe(98);
  });

  it('keeps a live step when retargeting a mid-step resident', () => {
    const { sim, home, resident, terrain, oldDoor } = scenario();
    plannerSystem(sim.world, ctxOf(sim));
    sim.step();
    sim.step();
    expect(sim.world.has(resident, PathFollow)).toBe(true);
    finish(sim, home);
    expect(sim.world.get(resident, MoveGoal).cell).toBe(
      interactionCell(sim.world, ctxOf(sim), terrain, home),
    );
    expect(sim.world.has(resident, PathFollow)).toBe(true);
    expect(observe(sim, resident, home, oldDoor)).toEqual({ entered: true, lost: 0 });
  });

  it('leaves a sleeping resident at the old entrance able to use its home', () => {
    const { sim, home, resident, terrain, oldDoor } = scenario();
    sim.world.add(resident, Position, positionOfNode(terrain.xOf(oldDoor), terrain.yOf(oldDoor)));
    plannerSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(resident, CurrentAtomic).effect.kind).toBe('sleep');
    finish(sim, home);
    expect(sim.world.get(resident, Resting).at).toBe(home);
    expect(observe(sim, resident, home, oldDoor, 100).lost).toBe(0);
  });

  it('does not replace an unrelated player route even when it names the old door', () => {
    const { sim, home, resident, oldDoor } = scenario();
    sim.world.add(resident, PlayerOrder, {});
    sim.world.add(resident, MoveGoal, { cell: oldDoor });
    finish(sim, home);
    expect(sim.world.get(resident, MoveGoal).cell).toBe(oldDoor);
  });

  it('retargets sleep while a builder retains crew affiliation elsewhere', () => {
    const { sim, home, resident, terrain, oldDoor } = scenario();
    const otherSite = sim.world.create();
    setSettlerJob(sim.world, resident, 7);
    sim.world.add(resident, SiteAssignment, { site: otherSite, pinned: false });
    plannerSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(resident, MoveGoal).cell).toBe(oldDoor);
    finish(sim, home);
    expect(sim.world.get(resident, MoveGoal).cell).toBe(
      interactionCell(sim.world, ctxOf(sim), terrain, home),
    );
    expect(observe(sim, resident, home, oldDoor)).toEqual({ entered: true, lost: 0 });
  });

  it('retains the existing destination when the entrance stays put', () => {
    const { sim, home, resident, oldDoor } = scenario(1, true);
    plannerSystem(sim.world, ctxOf(sim));
    finish(sim, home);
    expect(sim.world.get(resident, MoveGoal).cell).toBe(oldDoor);
    expect(observe(sim, resident, home, oldDoor)).toEqual({ entered: true, lost: 0 });
  });

  it('retargets an eat errand at the resident home', () => {
    const { sim, home, resident, terrain, oldDoor } = scenario();
    const needs = sim.world.mut(resident, Settler);
    needs.fatigue = ZERO;
    needs.hunger = ONE;
    plannerSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(resident, MoveGoal).cell).toBe(oldDoor);
    finish(sim, home);
    expect(sim.world.get(resident, MoveGoal).cell).toBe(
      interactionCell(sim.world, ctxOf(sim), terrain, home),
    );
  });

  it('keeps genuine failure recovery when the new entrance is blocked', () => {
    const { sim, home, resident, terrain } = scenario();
    const obstruction = sim.world.create();
    sim.world.add(obstruction, Position, positionOfNode(92, 20));
    sim.world.add(obstruction, ResourceFootprint, { walk: [{ dx: 0, dy: 0 }], build: [], work: [] });
    plannerSystem(sim.world, ctxOf(sim));
    finish(sim, home);
    const newDoor = interactionCell(sim.world, ctxOf(sim), terrain, home);
    expect(sim.world.get(resident, PathRequest)).toMatchObject({ goal: newDoor, failed: true });
    let lost = 0;
    for (let tick = 0; tick < 100; tick++) {
      sim.step();
      lost += sim.events
        .current()
        .filter((event) => event.kind === 'settlerLost' && event.entity === resident).length;
    }
    expect(lost).toBe(1);
    expect(sim.world.get(resident, UnreachableGoals).entries.some((entry) => entry.cell === newDoor)).toBe(
      true,
    );
  });

  it('retargets the home prayer route through the same entrance', () => {
    const { sim, home, resident, terrain } = scenario();
    sim.world.add(home, HomeQuality, { cooking: 0, rest: 0, piety: 1000 });
    expect(
      prayAtHome(
        sim.world,
        ctxOf(sim),
        terrain,
        resident,
        sim.world.get(resident, Settler),
        terrain.nodeAt(10, 20),
        null,
      ),
    ).toBe(true);
    finish(sim, home);
    expect(sim.world.get(resident, MoveGoal).cell).toBe(
      interactionCell(sim.world, ctxOf(sim), terrain, home),
    );
  });
});

it('updates the resident index for reassignment, in-place changes and destruction', () => {
  const { sim, home, resident } = scenario();
  const otherHome = sim.world.create();
  expect(residentsOf(sim.world, home)).toEqual([resident]);
  sim.world.add(resident, Residence, { home: otherHome });
  expect(residentsOf(sim.world, home)).toEqual([]);
  expect(residentsOf(sim.world, otherHome)).toEqual([resident]);
  sim.world.mut(resident, Residence).home = home;
  expect(residentsOf(sim.world, home)).toEqual([resident]);
  sim.world.destroy(resident);
  expect(residentsOf(sim.world, home)).toEqual([]);
  expect(sim.world.verifyCaches()).toEqual([]);
});
