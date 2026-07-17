import { describe, expect, it } from 'vitest';
import {
  Building,
  GatherSelection,
  JobAssignment,
  Marriage,
  Owner,
  Position,
  Settler,
  SIGNPOST_NAV_RADIUS_NODES,
  SIGNPOST_SPACING_RADIUS_NODES,
  Signpost,
  UnderConstruction,
} from '../../src/components/index.js';
import type { Command } from '../../src/core/commands/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { CommandQueue, EventBuffer, Rng, replay, Simulation } from '../../src/index.js';
import {
  buildOrderModule,
  DEFAULT_BUILD_ORDER,
  populationModule,
  signpostCoverageModule,
  workforceModule,
} from '../../src/systems/ai-player/index.js';
import type { SystemContext } from '../../src/systems/index.js';
import { withinNodeRadius } from '../../src/systems/node-metric.js';
import { aiContent } from '../fixtures/ai-content.js';
import { grassNodeMap } from '../fixtures/terrain.js';

/**
 * The strategic AI modules (user plan, 2026-07-17): the workforce allocator, the opening build
 * order, signpost coverage, and population planning. Module runs are pure — each test inspects the
 * returned command list against a hand-built world, then the integration suite proves the full
 * registry stays deterministic and replayable.
 */

const VIKING = 1;
const SEAT = 2;
const CIVILIST = 6;
const BUILDER = 7;
const COLLECTOR = 8;
const FARMER = 18;
const SCOUT = 27;
const WOMAN = 5;
const HQ_TYPE = 1;
const HOME_TYPE = 2;
const FARM_TYPE = 5;
const WOOD = 1;
const MUD = 2;
const STONE = 4;

const HQ_X = 30;
const HQ_Y = 16;

function aiSim(seed = 1): Simulation {
  return new Simulation({ seed, content: aiContent(), map: grassNodeMap(64, 32) });
}

function ctxOf(sim: Simulation, tick = 0): SystemContext {
  return {
    content: aiContent(),
    rng: new Rng(1),
    tick,
    events: new EventBuffer(),
    commands: new CommandQueue(),
    ...(sim.terrain !== undefined ? { terrain: sim.terrain } : {}),
  };
}

function placeHq(sim: Simulation): void {
  sim.enqueue({ kind: 'placeBuilding', buildingType: HQ_TYPE, x: HQ_X, y: HQ_Y, tribe: VIKING, owner: SEAT });
}

function spawnMen(sim: Simulation, count: number, jobType = CIVILIST): void {
  for (let i = 0; i < count; i++) {
    sim.enqueue({ kind: 'spawnSettler', jobType, x: 4 + 2 * i, y: 4, tribe: VIKING, owner: SEAT });
  }
}

function entityOfBuilding(sim: Simulation, buildingType: number): Entity {
  for (const e of sim.world.query(Building)) {
    if (sim.world.get(e, Building).buildingType === buildingType) return e;
  }
  throw new Error(`setup: building ${buildingType} missing`);
}

describe('workforce module (collectResources)', () => {
  it('hires the HQ gatherer trio, one scout, and turns the remaining civilians into builders', () => {
    const sim = aiSim();
    placeHq(sim);
    spawnMen(sim, 6);
    sim.step();

    const commands = [...workforceModule.run(sim.world, ctxOf(sim), SEAT)];
    const assigns = commands.filter((c) => c.kind === 'assignWorker');
    const selections = commands.filter((c) => c.kind === 'setGatherGood');
    const jobs = commands.filter((c) => c.kind === 'setJob');
    // 3 collectors into the HQ's harvest slot (never the carrier slot)...
    expect(assigns).toHaveLength(3);
    for (const a of assigns) expect(a.jobPriority).toEqual([COLLECTOR]);
    // ...each pinned to its own good, in the plan's clay → stone → wood order,
    expect(selections.map((s) => s.goodType)).toEqual([MUD, STONE, WOOD]);
    // ...one scout, and the two leftover civilians become builders.
    expect(jobs.map((j) => j.jobType)).toEqual([SCOUT, BUILDER, BUILDER]);
    // Distinct settlers throughout — the allocator never claims one person twice.
    const claimed = [...assigns, ...jobs].map((c) => c.entity);
    expect(new Set(claimed).size).toBe(claimed.length);

    // Applying the decision settles the seat: the next decision has nothing left to do.
    for (const c of commands) sim.enqueue(c);
    sim.step();
    expect([...workforceModule.run(sim.world, ctxOf(sim), SEAT)]).toEqual([]);
    const hq = entityOfBuilding(sim, HQ_TYPE);
    const bound = [...sim.world.query(Settler, JobAssignment)].filter(
      (e) => sim.world.get(e, JobAssignment).workplace === hq,
    );
    expect(bound).toHaveLength(3);
    expect(bound.map((e) => sim.world.get(e, GatherSelection).goodType).sort((a, b) => a - b)).toEqual(
      [WOOD, MUD, STONE].sort((a, b) => a - b),
    );
  });

  it('staffs a built workplace with one worker per operator trade, thinning the builder pool', () => {
    const sim = aiSim();
    placeHq(sim);
    sim.enqueue({ kind: 'placeBuilding', buildingType: FARM_TYPE, x: 40, y: 16, tribe: VIKING, owner: SEAT });
    // Six builders: the gatherer trio and the scout claim four, staffing draws from the rest.
    spawnMen(sim, 6, BUILDER);
    sim.step();

    const commands = [...workforceModule.run(sim.world, ctxOf(sim), SEAT)];
    const farm = entityOfBuilding(sim, FARM_TYPE);
    const staffing = commands.filter((c) => c.kind === 'assignWorker' && c.building === farm);
    // One farmer despite 4 farmer slots (WORKERS_PER_TRADE), and never the farm's carrier slot.
    expect(staffing.map((c) => c.jobPriority)).toEqual([[FARMER]]);
  });

  it('idles a seat without a built headquarters (user rule: no HQ → no AI)', () => {
    const sim = aiSim();
    spawnMen(sim, 3);
    sim.step();
    expect([...workforceModule.run(sim.world, ctxOf(sim), SEAT)]).toEqual([]);
  });
});

describe('build-order module (houseBuild)', () => {
  const module = buildOrderModule(DEFAULT_BUILD_ORDER);

  function nextPlacement(sim: Simulation): Command | undefined {
    return [...module.run(sim.world, ctxOf(sim), SEAT)][0];
  }

  it('executes the opening list in order near the HQ, capped at two open sites', () => {
    const sim = aiSim();
    placeHq(sim);
    sim.step();

    // Farm first — on a free node close to the HQ, as a construction site owned by the seat.
    const first = nextPlacement(sim);
    expect(first?.kind).toBe('placeBuilding');
    if (first?.kind !== 'placeBuilding') return;
    expect(first.buildingType).toBe(FARM_TYPE);
    expect(first.underConstruction).toBe(true);
    expect(first.owner).toBe(SEAT);
    const dist = Math.abs(first.x - HQ_X) + Math.abs(first.y - HQ_Y);
    expect(dist).toBeGreaterThan(0); // never on the HQ's own node
    expect(dist).toBeLessThanOrEqual(4); // the closest free ring, not a far scatter
    sim.enqueue(first);
    sim.step();

    // The open farm site already counts toward its entry — the second placement is a home.
    const second = nextPlacement(sim);
    if (second?.kind !== 'placeBuilding') throw new Error('expected a second placement');
    expect(second.buildingType).toBe(HOME_TYPE);
    sim.enqueue(second);
    sim.step();

    // Two open sites — the executor stalls until one finishes.
    expect(nextPlacement(sim)).toBeUndefined();
    for (const e of [...sim.world.query(UnderConstruction)]) {
      sim.enqueue({ kind: 'debugCompleteConstruction', target: e });
    }
    sim.step();

    // Homes fill to their count of three, then the entries absent from this content are skipped
    // and the module goes quiet.
    for (const expected of [HOME_TYPE, HOME_TYPE]) {
      const next = nextPlacement(sim);
      if (next?.kind !== 'placeBuilding') throw new Error('expected a home placement');
      expect(next.buildingType).toBe(expected);
      sim.enqueue(next);
      sim.step();
      for (const e of [...sim.world.query(UnderConstruction)]) {
        sim.enqueue({ kind: 'debugCompleteConstruction', target: e });
      }
      sim.step();
    }
    expect(nextPlacement(sim)).toBeUndefined();
  });

  it('re-places a destroyed building (the count repairs itself)', () => {
    const sim = aiSim();
    placeHq(sim);
    sim.step();
    const first = nextPlacement(sim);
    if (first?.kind !== 'placeBuilding') throw new Error('expected the farm placement');
    sim.enqueue(first);
    sim.step();
    const farm = entityOfBuilding(sim, FARM_TYPE);
    sim.enqueue({ kind: 'debugCompleteConstruction', target: farm });
    sim.step();
    sim.enqueue({ kind: 'demolish', building: farm });
    sim.step();
    const again = nextPlacement(sim);
    if (again?.kind !== 'placeBuilding') throw new Error('expected a repair placement');
    expect(again.buildingType).toBe(FARM_TYPE);
  });
});

describe('signpost-coverage module (guideBuild)', () => {
  it('sends the scout to cover the first uncovered building, and rests when all are covered', () => {
    const sim = aiSim();
    placeHq(sim);
    sim.enqueue({ kind: 'spawnSettler', jobType: SCOUT, x: 10, y: 10, tribe: VIKING, owner: SEAT });
    sim.step();

    const commands = [...signpostCoverageModule.run(sim.world, ctxOf(sim), SEAT)];
    expect(commands).toHaveLength(1);
    const order = commands[0];
    if (order?.kind !== 'placeSignpost') throw new Error('expected a placeSignpost order');
    // The chosen spot still covers the HQ from its nav circle.
    expect(withinNodeRadius(order.x, order.y, HQ_X, HQ_Y, SIGNPOST_NAV_RADIUS_NODES)).toBe(true);

    // With a post standing over the HQ the module rests.
    const post = sim.world.create();
    sim.world.add(post, Position, sim.world.get(entityOfBuilding(sim, HQ_TYPE), Position));
    sim.world.add(post, Owner, { player: SEAT });
    sim.world.add(post, Signpost, {
      navRadius: SIGNPOST_NAV_RADIUS_NODES,
      spacingRadius: SIGNPOST_SPACING_RADIUS_NODES,
    });
    expect([...signpostCoverageModule.run(sim.world, ctxOf(sim), SEAT)]).toEqual([]);
  });

  it('does nothing without a scout', () => {
    const sim = aiSim();
    placeHq(sim);
    sim.step();
    expect([...signpostCoverageModule.run(sim.world, ctxOf(sim), SEAT)]).toEqual([]);
  });
});

describe('population module (homeExpansion)', () => {
  function populationSim(): Simulation {
    const sim = aiSim();
    placeHq(sim);
    for (let i = 0; i < 2; i++) {
      sim.enqueue({ kind: 'spawnSettler', jobType: WOMAN, x: 6 + 2 * i, y: 8, tribe: VIKING, owner: SEAT });
    }
    spawnMen(sim, 2);
    sim.step();
    return sim;
  }

  function womenOf(sim: Simulation): Entity[] {
    return [...sim.world.query(Settler)]
      .filter((e) => sim.world.get(e, Settler).jobType === WOMAN)
      .sort((a, b) => a - b);
  }

  it('marries every single woman while single men exist', () => {
    const sim = populationSim();
    const commands = [...populationModule.run(sim.world, ctxOf(sim), SEAT)];
    const weddings = commands.filter((c) => c.kind === 'marry');
    expect(weddings.map((c) => c.entity)).toEqual(womenOf(sim));
  });

  it('houses married women and orders daughters up to the family slots, then sons', () => {
    const sim = populationSim();
    sim.enqueue({ kind: 'placeBuilding', buildingType: HOME_TYPE, x: 36, y: 16, tribe: VIKING, owner: SEAT });
    for (const woman of womenOf(sim)) sim.enqueue({ kind: 'marry', entity: woman });
    // Let the couples walk together and kiss — both marriages must stand before the module houses them.
    for (let i = 0; i < 3000 && womenOf(sim).some((w) => !sim.world.has(w, Marriage)); i++) sim.step();
    expect(womenOf(sim).every((w) => sim.world.has(w, Marriage))).toBe(true);

    const houseCommands = [...populationModule.run(sim.world, ctxOf(sim), SEAT)];
    const home = entityOfBuilding(sim, HOME_TYPE);
    expect(houseCommands.filter((c) => c.kind === 'assignHouse').map((c) => c.house)).toEqual([home, home]);
    for (const c of houseCommands) sim.enqueue(c);
    sim.step();

    // 2 women against 2 family slots: the count is met, so both standing orders are sons. A second
    // home (2 more slots) flips the next orders to daughters.
    const orders = [...populationModule.run(sim.world, ctxOf(sim), SEAT)];
    expect(orders.filter((c) => c.kind === 'makeChild').map((c) => c.child)).toEqual(['male', 'male']);
    sim.enqueue({ kind: 'placeBuilding', buildingType: HOME_TYPE, x: 24, y: 16, tribe: VIKING, owner: SEAT });
    sim.step();
    const withRoom = [...populationModule.run(sim.world, ctxOf(sim), SEAT)];
    expect(withRoom.filter((c) => c.kind === 'makeChild').map((c) => c.child)).toEqual(['female', 'female']);
  });
});

describe('the full strategic registry — determinism and replay', () => {
  const TICKS = 120;

  function liveRun(): Simulation {
    const sim = aiSim(11);
    placeHq(sim);
    spawnMen(sim, 5);
    sim.enqueue({ kind: 'spawnSettler', jobType: WOMAN, x: 20, y: 8, tribe: VIKING, owner: SEAT });
    sim.enqueue({ kind: 'setPlayerAi', player: SEAT, enabled: true });
    sim.run(TICKS);
    return sim;
  }

  it('acts through the command seam: the log carries the AI-issued orders', () => {
    const live = liveRun();
    const kinds = new Set(live.commands.log.map((c) => c.command.kind));
    expect(kinds.has('placeBuilding')).toBe(true); // the opening farm went through the queue
    expect(kinds.has('setJob')).toBe(true); // and so did the workforce decisions
  });

  it('carries the opening list to completion unattended (stocked HQ + eight men is enough)', () => {
    const sim = aiSim(21);
    sim.enqueue({
      kind: 'placeBuilding',
      buildingType: HQ_TYPE,
      x: HQ_X,
      y: HQ_Y,
      tribe: VIKING,
      owner: SEAT,
      fillStock: true,
    });
    // Eight men: the gatherer trio and the scout claim four, four builders remain to raise the list.
    // Fewer than five would starve the builder pool — the allocation priority is the user's plan.
    spawnMen(sim, 8);
    sim.enqueue({ kind: 'setPlayerAi', player: SEAT, enabled: true });
    sim.run(3000);
    const built = [...sim.world.query(Building)].filter(
      (e) => !sim.world.has(e, UnderConstruction) && sim.world.get(e, Building).buildingType !== HQ_TYPE,
    );
    // The farm and all three homes stand finished (the fixture's whole placeable list).
    expect(built.map((e) => sim.world.get(e, Building).buildingType).sort((a, b) => a - b)).toEqual(
      [HOME_TYPE, HOME_TYPE, HOME_TYPE, FARM_TYPE].sort((a, b) => a - b),
    );
    // The farm got its farmer from the builder pool.
    const farm = entityOfBuilding(sim, FARM_TYPE);
    const staffed = [...sim.world.query(Settler, JobAssignment)].some(
      (e) =>
        sim.world.get(e, JobAssignment).workplace === farm && sim.world.get(e, Settler).jobType === FARMER,
    );
    expect(staffed).toBe(true);
  });

  it('same seed twice → byte-identical state; replaying the log reproduces it', () => {
    const a = liveRun();
    const b = liveRun();
    expect(a.hashState()).toBe(b.hashState());
    const replayed = replay({
      content: aiContent(),
      seed: 11,
      map: grassNodeMap(64, 32),
      log: a.commands.log,
      untilTick: TICKS,
    });
    expect(replayed.hashState()).toBe(a.hashState());
  });
});
