import { describe, expect, it } from 'vitest';
import { mapBriefOf, Settler } from '../../../../src/components/index.js';
import type { Entity } from '../../../../src/ecs/world.js';
import { Simulation } from '../../../../src/index.js';
import { withinNodeRadius } from '../../../../src/nav/node-circle.js';
import { anchorNodeOf } from '../../../../src/systems/ai-shared/node-geometry.js';
import { ownedBuildings } from '../../../../src/systems/ai-shared/seat-roster.js';
import { firstUncovered } from '../../../../src/systems/computer-player/build-order/tower-coverage.js';
import { LATE_GAME_FROM_TICKS } from '../../../../src/systems/computer-player/game-phase.js';
import {
  BUILD_SEARCH_MAX_RADIUS_NODES,
  buildOrderModule,
  TOWER_DEFENCE_RADIUS_NODES,
} from '../../../../src/systems/computer-player/index.js';
import { seatTerritoryOf } from '../../../../src/systems/computer-player/knowledge/map-intent/index.js';
import { ASSUMED_PEACE_TICKS } from '../../../../src/systems/computer-player/military/deadline.js';
import { SUCCESSFUL_IF } from '../../../../src/systems/missions/index.js';
import { aiContent } from '../../../fixtures/ai-content.js';
import { grassNodeMap } from '../../../fixtures/terrain.js';
import {
  aiSim,
  BAKERY_TYPE,
  COLLECTOR,
  completeSites,
  ctxOf,
  HOME_TYPE,
  HQ_X,
  HQ_Y,
  makeAiSeat,
  oneLine,
  placeHq,
  SAND,
  SEAT,
  SPEARMAN,
  STOCK_TOP_TYPE,
  TOWER_TYPE,
  VIKING,
  WALL_TYPE,
} from '../support.js';

describe('build-order tower and store coverage', () => {
  const coverage = buildOrderModule(oneLine([{ kind: 'towerCoverage', building: 'tower_01' }]));

  it('rests while every building sits in the HQ circle, then covers an outlying one', () => {
    const sim = aiSim();
    placeHq(sim);
    sim.step();
    expect([...coverage.run(sim.world, ctxOf(sim), SEAT)]).toEqual([]);

    // A home 31 columns east leaves the 29-node circle: the next decision places a covering tower.
    const FAR = { x: HQ_X + 31, y: HQ_Y };
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: HOME_TYPE,
      x: FAR.x,
      y: FAR.y,
      tribe: VIKING,
      owner: SEAT,
    });
    sim.step();
    const order = [...coverage.run(sim.world, ctxOf(sim), SEAT)][0];
    if (order?.kind !== 'placeBuilding') throw new Error('expected a tower placement');
    expect(order.buildingType).toBe(TOWER_TYPE);
    expect(order.underConstruction).toBe(true);
    // The spot actually covers the target (world-metric circle) and stays within building reach.
    expect(withinNodeRadius(order.x, order.y, FAR.x, FAR.y, TOWER_DEFENCE_RADIUS_NODES)).toBe(true);
    const nearest = Math.min(
      Math.abs(order.x - HQ_X) + Math.abs(order.y - HQ_Y),
      Math.abs(order.x - FAR.x) + Math.abs(order.y - FAR.y),
    );
    expect(nearest).toBeLessThanOrEqual(BUILD_SEARCH_MAX_RADIUS_NODES);

    // The tower SITE already counts as coverage; a finished tower keeps the entry satisfied - and
    // the entry is perpetual: another far building re-arms it.
    sim.enqueueSetup(order);
    sim.step();
    expect([...coverage.run(sim.world, ctxOf(sim), SEAT)]).toEqual([]);
    completeSites(sim);
    expect([...coverage.run(sim.world, ctxOf(sim), SEAT)]).toEqual([]);
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: HOME_TYPE,
      x: HQ_X - 30,
      y: HQ_Y,
      tribe: VIKING,
      owner: SEAT,
    });
    sim.step();
    expect([...coverage.run(sim.world, ctxOf(sim), SEAT)]).toHaveLength(1);
  });

  it('keeps a covering tower off the grass on a seat short of it', () => {
    // Grass round the HQ and round an outlying home, far under the scarcity line together; sand elsewhere.
    const FAR = { x: HQ_X + 31, y: HQ_Y };
    const HQ_PATCH = 8;
    const FAR_PATCH = 12;
    const onGrass = (x: number, y: number) =>
      Math.abs(x - HQ_X) + Math.abs(y - HQ_Y) <= HQ_PATCH ||
      Math.abs(x - FAR.x) + Math.abs(y - FAR.y) <= FAR_PATCH;
    const typeIds = new Array<number>(64 * 32);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) typeIds[y * 64 + x] = onGrass(x, y) ? 0 : SAND;
    const sim = new Simulation({
      seed: 1,
      content: aiContent(),
      map: { resolution: 'half-cell', width: 64, height: 32, typeIds },
    });
    placeHq(sim);
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: HOME_TYPE,
      x: FAR.x,
      y: FAR.y,
      tribe: VIKING,
      owner: SEAT,
    });
    sim.step();
    // A well still to place keeps the reservation on.
    const reserving = buildOrderModule(
      oneLine([
        { kind: 'towerCoverage', building: 'tower_01' },
        { kind: 'place', building: 'work_well_00', count: 1 },
      ]),
    );
    const order = [...reserving.run(sim.world, ctxOf(sim), SEAT)][0];
    if (order?.kind !== 'placeBuilding') throw new Error('expected a tower placement');
    expect(onGrass(order.x, order.y)).toBe(false);
    expect(withinNodeRadius(order.x, order.y, FAR.x, FAR.y, TOWER_DEFENCE_RADIUS_NODES)).toBe(true);
  });

  it('faces a forecast attack: offers only the buildings on its side, the nearest the base first', () => {
    const sim = aiSim();
    placeHq(sim);
    const EAST = { x: HQ_X + 12, y: HQ_Y };
    const WEST = { x: HQ_X - 12, y: HQ_Y };
    for (const at of [WEST, EAST]) {
      sim.enqueueSetup({ kind: 'placeBuilding', buildingType: HOME_TYPE, ...at, tribe: VIKING, owner: SEAT });
    }
    makeAiSeat(sim, SEAT);
    sim.step();
    const anchor = seatTerritoryOf(mapBriefOf(sim.world), SEAT)?.anchor;
    if (anchor === undefined) throw new Error('setup: the seat has no start in the map brief');
    // Raiders spawn at the map's east edge and walk to the seat.
    const RAIDER = 6;
    const ctx = {
      ...ctxOf(sim),
      missions: {
        missions: [
          {
            successfullIf: SUCCESSFUL_IF.all,
            active: true,
            visible: false,
            goals: [],
            results: [
              {
                opcode: 'SetHumanX' as const,
                player: RAIDER,
                tribe: VIKING,
                job: SPEARMAN,
                point: { hx: 63, hy: HQ_Y },
                humanId: 1,
                behaviour: 0,
                amount: 6,
              },
              { opcode: 'SendHuman' as const, humanId: 1, point: anchor },
            ],
          },
        ],
      },
    };
    const owned = ownedBuildings(sim.world, SEAT);
    const offered: { hx: number; hy: number }[] = [];
    const offer = (target: { hx: number; hy: number }): null => {
      offered.push(target);
      return null;
    };
    const nodeOf = (e: Entity | undefined) => (e === undefined ? null : anchorNodeOf(sim.world, e));
    const homes = owned.filter((e) => nodeOf(e)?.hx !== nodeOf(owned[0])?.hx);
    const [west, east] = homes.map(nodeOf);
    firstUncovered(sim.world, ctx, SEAT, owned, { by: 'tower', radius: 1, baseCovers: false }, offer);
    // The base, then the east home; the west one lies behind the settlement.
    expect(offered).toEqual([nodeOf(owned[0]), east]);
    expect(offered).not.toContainEqual(west);
    offered.length = 0;
    // An even ring (the base covering) offers every building by id.
    firstUncovered(sim.world, ctx, SEAT, owned, { by: 'tower', radius: 1, baseCovers: true }, offer);
    expect(offered).toContainEqual(west);

    // One tower whose circle reaches every building: the even ring rests, the facing one still wants a
    // second circle over each building on the attack side.
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: TOWER_TYPE,
      ...EAST,
      tribe: VIKING,
      owner: SEAT,
    });
    sim.step();
    const towered = ownedBuildings(sim.world, SEAT);
    expect(towered).toHaveLength(owned.length + 1);
    const WIDE = 40;
    offered.length = 0;
    firstUncovered(sim.world, ctx, SEAT, towered, { by: 'tower', radius: WIDE, baseCovers: true }, offer);
    expect(offered).toEqual([]);
    firstUncovered(sim.world, ctx, SEAT, towered, { by: 'tower', radius: WIDE, baseCovers: false }, offer);
    expect(offered).toContainEqual(east);
  });

  it('holds a ring lane until its deadline lead, then keeps two tower sites open at once', () => {
    const LEAD = 0;
    const ring = buildOrderModule(
      oneLine([
        {
          kind: 'towerCoverage',
          building: 'tower_01',
          lane: true,
          holdUntil: { kind: 'deadline', leadTicks: LEAD },
        },
      ]),
    );
    const sim = new Simulation({ seed: 1, content: aiContent(), map: grassNodeMap(240, 32) });
    sim.enqueueSetup({ kind: 'setPlayerPlacementTribes', player: SEAT, tribes: [VIKING] });
    placeHq(sim);
    // Three homes out east, far apart: no one tower covers two of them.
    for (const dx of [31, 90, 150]) {
      sim.enqueueSetup({
        kind: 'placeBuilding',
        buildingType: HOME_TYPE,
        x: HQ_X + dx,
        y: HQ_Y,
        tribe: VIKING,
        owner: SEAT,
      });
    }
    sim.step();
    const act = (tick: number) => {
      const commands = [...ring.run(sim.world, ctxOf(sim, tick), SEAT)];
      for (const c of commands) sim.enqueueSetup(c);
      sim.step();
      return commands[0];
    };
    // A seat outside a lobby peace plans for the assumed one; before it the ring waits.
    expect(act(0)).toBeUndefined();
    const due = Math.max(ASSUMED_PEACE_TICKS, LATE_GAME_FROM_TICKS);
    expect(act(due)).toMatchObject({ kind: 'placeBuilding', buildingType: TOWER_TYPE });
    expect(act(due)).toMatchObject({ kind: 'placeBuilding', buildingType: TOWER_TYPE });
    // A third home still lies uncovered, but the ring keeps to its two sites until one stands.
    expect(act(due)).toBeUndefined();
    completeSites(sim);
    expect(act(due)).toMatchObject({ kind: 'placeBuilding', buildingType: TOWER_TYPE });
  });

  it('never counts the defence wall (shared kind, different id) as a covering tower', () => {
    const sim = aiSim();
    placeHq(sim);
    const FAR = { x: HQ_X + 31, y: HQ_Y };
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: HOME_TYPE,
      x: FAR.x,
      y: FAR.y,
      tribe: VIKING,
      owner: SEAT,
    });
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: WALL_TYPE,
      x: FAR.x - 2,
      y: FAR.y,
      tribe: VIKING,
      owner: SEAT,
    });
    sim.step();
    // The wall shares kind 'tower' but is not in the tower id allowlist - the home stays uncovered.
    const order = [...coverage.run(sim.world, ctxOf(sim), SEAT)][0];
    if (order?.kind !== 'placeBuilding') throw new Error('expected a tower placement despite the wall');
    expect(order.buildingType).toBe(TOWER_TYPE);
  });

  describe('store coverage', () => {
    /** A store circle small enough for the fixture map to hold ground outside it. */
    const radius = 19;
    const stores = buildOrderModule(oneLine([{ kind: 'storeCoverage', building: 'stock_02', radius }]));
    const place = (sim: Simulation, buildingType: number, x: number, y: number): void =>
      sim.enqueueSetup({ kind: 'placeBuilding', buildingType, x, y, tribe: VIKING, owner: SEAT });
    const next = (sim: Simulation) => [...stores.run(sim.world, ctxOf(sim), SEAT)][0];
    const flagAt = (sim: Simulation, at: { x: number; y: number }): void => {
      const before = new Set(sim.world.query(Settler));
      sim.enqueueSetup({
        kind: 'spawnSettler',
        jobType: COLLECTOR,
        x: at.x + 2,
        y: at.y,
        tribe: VIKING,
        owner: SEAT,
      });
      sim.step();
      const gatherer = [...sim.world.query(Settler)].find((e) => !before.has(e));
      if (gatherer === undefined) throw new Error('setup: no gatherer');
      sim.enqueueSetup({ kind: 'setWorkFlag', entity: gatherer, x: at.x, y: at.y });
      sim.step();
    };

    it('covers an outlying workshop with a warehouse clear of every store, and no home or tower', () => {
      const sim = aiSim();
      placeHq(sim);
      // A home and a tower out at the edge need no warehouse beside them.
      place(sim, HOME_TYPE, HQ_X + 31, HQ_Y);
      place(sim, TOWER_TYPE, HQ_X - 31, HQ_Y);
      sim.step();
      expect(next(sim)).toBeUndefined();

      const FAR = { x: HQ_X + 29, y: HQ_Y };
      place(sim, BAKERY_TYPE, FAR.x, FAR.y);
      sim.step();
      const order = next(sim);
      if (order?.kind !== 'placeBuilding') throw new Error('expected a warehouse placement');
      expect(order.buildingType).toBe(STOCK_TOP_TYPE);
      expect(withinNodeRadius(order.x, order.y, FAR.x, FAR.y, radius)).toBe(true);
      // Not beside the HQ, itself a store: the new circle starts where the HQ's ends.
      expect(withinNodeRadius(HQ_X, HQ_Y, order.x, order.y, radius)).toBe(false);

      sim.enqueueSetup(order);
      sim.step();
      expect(next(sim)).toBeUndefined();
    });

    it("covers a gatherer's work flag, where the mined goods pile up", () => {
      const sim = aiSim();
      placeHq(sim);
      const FLAG = { x: HQ_X - 28, y: HQ_Y + 6 };
      flagAt(sim, FLAG);
      const order = next(sim);
      if (order?.kind !== 'placeBuilding') throw new Error('expected a warehouse placement at the flag');
      expect(withinNodeRadius(order.x, order.y, FLAG.x, FLAG.y, radius)).toBe(true);
      sim.enqueueSetup(order);
      sim.step();
      expect(next(sim)).toBeUndefined();
    });

    it('passes a flag beyond the build reach over and covers the next target', () => {
      // A long map: the first gatherer's flag lies far past any spot the seat may build on.
      const sim = new Simulation({ seed: 1, content: aiContent(), map: grassNodeMap(240, 32) });
      placeHq(sim);
      const FAR = { x: HQ_X + 190, y: HQ_Y };
      const NEAR = { x: HQ_X + 28, y: HQ_Y };
      flagAt(sim, FAR);
      flagAt(sim, NEAR);
      const order = next(sim);
      if (order?.kind !== 'placeBuilding') throw new Error('expected a warehouse placement at the near flag');
      expect(withinNodeRadius(order.x, order.y, NEAR.x, NEAR.y, radius)).toBe(true);
      sim.enqueueSetup(order);
      sim.step();
      // The far flag stays uncovered, and the entry rests rather than stalling on it.
      expect(next(sim)).toBeUndefined();
    });
  });
});
