import { describe, expect, it } from 'vitest';
import { Building, mapBriefOf, Settler } from '../../../../src/components/index.js';
import { Simulation } from '../../../../src/index.js';
import { hexDistanceBetween } from '../../../../src/nav/halfcell.js';
import { withinNodeRadius } from '../../../../src/nav/node-circle.js';
import type { EnemyFire } from '../../../../src/systems/ai-shared/military/defence/index.js';
import { ownedBuildings } from '../../../../src/systems/ai-shared/seat-roster.js';
import {
  FRONT_LINE_DEPTH_NODES,
  scheduledTowers,
  TOWER_UPGRADE_QUIET_TICKS,
  towerUpgradeWaits,
} from '../../../../src/systems/computer-player/build-order/front.js';
import {
  defenceAt,
  defenceCircleOf,
  defenceGain,
  seatDefenceCircles,
  TOWER_UPGRADE_FIRST_FROM_TICKS,
  towerPlan,
  towerSpot,
  towerToUpgrade,
} from '../../../../src/systems/computer-player/build-order/tower-defence.js';
import { LATE_GAME_FROM_TICKS, minutesToTicks } from '../../../../src/systems/computer-player/game-phase.js';
import {
  BUILD_SEARCH_MAX_RADIUS_NODES,
  buildOrderModule,
} from '../../../../src/systems/computer-player/index.js';
import { seatTerritoryOf } from '../../../../src/systems/computer-player/knowledge/map-intent/index.js';
import {
  ASSUMED_PEACE_TICKS,
  TOWER_LEAD_TICKS,
} from '../../../../src/systems/computer-player/military/deadline.js';
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
  PAST_HQ_DEFENCE_DX,
  placeHq,
  SAND,
  SEAT,
  SPEARMAN,
  STOCK_TOP_TYPE,
  TOWER_TYPE,
  VIKING,
  WALL_TYPE,
} from '../support.js';

/** No enemy shooter anywhere. */
const NO_FIRE: EnemyFire = { reaches: () => false, around: () => NO_FIRE };

describe('build-order tower and store coverage', () => {
  const coverage = buildOrderModule(oneLine([{ kind: 'towerCoverage', building: 'tower_01' }]));

  /** The defence circle a fixture tower throws from `(x, y)`. */
  const towerCircle = (x: number, y: number) => {
    const circle = defenceCircleOf(
      ctxOf(aiSim()),
      { buildingType: TOWER_TYPE, tribe: VIKING },
      { hx: x, hy: y },
    );
    if (circle === null) throw new Error('setup: the fixture tower has no defence circle');
    return circle;
  };

  it('rests while every building sits in the HQ circle, then covers an outlying one', () => {
    const sim = new Simulation({ seed: 1, content: aiContent(), map: grassNodeMap(160, 32) });
    sim.enqueueSetup({ kind: 'setPlayerPlacementTribes', player: SEAT, tribes: [VIKING] });
    placeHq(sim);
    sim.step();
    expect([...coverage.run(sim.world, ctxOf(sim), SEAT)]).toEqual([]);

    // A home just past the HQ's defence circle: the next decision places a tower whose circle holds it.
    const FAR = { x: HQ_X + PAST_HQ_DEFENCE_DX, y: HQ_Y };
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
    expect(hexDistanceBetween(order.x, order.y, FAR.x, FAR.y)).toBeLessThanOrEqual(
      towerCircle(order.x, order.y).radius,
    );
    const nearest = Math.min(
      Math.abs(order.x - HQ_X) + Math.abs(order.y - HQ_Y),
      Math.abs(order.x - FAR.x) + Math.abs(order.y - FAR.y),
    );
    expect(nearest).toBeLessThanOrEqual(BUILD_SEARCH_MAX_RADIUS_NODES);

    // The tower SITE already defends; a finished tower keeps the entry met - and the entry is perpetual:
    // a home past the tower's circle re-arms it.
    sim.enqueueSetup(order);
    sim.step();
    expect([...coverage.run(sim.world, ctxOf(sim), SEAT)]).toEqual([]);
    completeSites(sim);
    expect([...coverage.run(sim.world, ctxOf(sim), SEAT)]).toEqual([]);
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: HOME_TYPE,
      x: order.x + towerCircle(order.x, order.y).radius + 1,
      y: HQ_Y,
      tribe: VIKING,
      owner: SEAT,
    });
    sim.step();
    expect([...coverage.run(sim.world, ctxOf(sim), SEAT)]).toHaveLength(1);
  });

  it('keeps a covering tower off the grass on a seat short of it', () => {
    // Grass round the HQ and round an outlying home, far under the scarcity line together; sand elsewhere.
    const FAR = { x: HQ_X + PAST_HQ_DEFENCE_DX, y: HQ_Y };
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
    expect(hexDistanceBetween(order.x, order.y, FAR.x, FAR.y)).toBeLessThanOrEqual(
      towerCircle(order.x, order.y).radius,
    );
  });

  /** A seat raided at `tick` by spearmen spawned at the map's east edge, with the context that forecasts it. */
  const raidedFromEast = (sim: Simulation, tick = 0) => {
    const anchor = seatTerritoryOf(mapBriefOf(sim.world), SEAT)?.anchor;
    if (anchor === undefined) throw new Error('setup: the seat has no start in the map brief');
    const RAIDER = 6;
    const results = [
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
    ];
    const mission = { successfullIf: SUCCESSFUL_IF.all, active: true, visible: false, goals: [], results };
    return { ...ctxOf(sim, tick), missions: { missions: [mission] } };
  };

  it('scores each building and front slot by the defence circles over it, the lowest share first', () => {
    const sim = aiSim();
    placeHq(sim);
    const EAST = { x: HQ_X + 12, y: HQ_Y };
    const BEYOND = { x: HQ_X + FRONT_LINE_DEPTH_NODES + 4, y: HQ_Y + 2 };
    const WEST = { x: HQ_X - 12, y: HQ_Y };
    for (const at of [WEST, EAST]) {
      sim.enqueueSetup({ kind: 'placeBuilding', buildingType: HOME_TYPE, ...at, tribe: VIKING, owner: SEAT });
    }
    makeAiSeat(sim, SEAT);
    sim.step();
    // Raised after the start, so the line stays where the start buildings put it.
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: HOME_TYPE,
      ...BEYOND,
      tribe: VIKING,
      owner: SEAT,
    });
    sim.step();
    const ctx = raidedFromEast(sim);
    const owned = ownedBuildings(sim.world, SEAT);
    // The HQ's circle holds its garrison, from content, over every node its house bow reaches.
    const circles = seatDefenceCircles(sim.world, ctx, owned);
    expect(circles).toHaveLength(1);
    const hq = circles[0];
    if (hq === undefined) throw new Error('setup: no HQ circle');
    expect(hq.value).toBe(aiContent().buildings.find((b) => b.id === 'headquarters')?.shelterCapacity);
    expect(defenceAt(circles, BEYOND.x, BEYOND.y)).toBe(hq.value);
    expect(defenceAt(circles, hq.hx + hq.radius + 1, hq.hy)).toBe(0);

    const tower = { by: 'tower', building: 'tower_01' } as const;
    const planOf = (village: number, front: number) =>
      towerPlan(sim.world, ctx, SEAT, owned, { ...tower, wants: { village, front } })?.short ?? [];
    // Wants the HQ meets leave nothing short.
    expect(planOf(hq.value, hq.value)).toEqual([]);
    // A front want past it offers the slot straight ahead of the base toward the raid and the home beyond
    // the line; the homes behind it hold the village want.
    const front = planOf(hq.value, 2 * hq.value);
    expect(front.map((t) => t.node)).toEqual([
      { hx: HQ_X + FRONT_LINE_DEPTH_NODES, hy: HQ_Y },
      { hx: BEYOND.x, hy: BEYOND.y },
    ]);
    expect(front.every((t) => t.front && t.want === 2 * hq.value && t.has === hq.value)).toBe(true);
    // The lowest covered share goes first: the front's quarter before the village's half.
    const both = planOf(2 * hq.value, 4 * hq.value);
    expect(both.map((t) => t.front)).toEqual([true, true, false, false]);
    expect(both.map((t) => t.node)).toContainEqual({ hx: WEST.x, hy: WEST.y });
  });

  it('places no tower where the defence already meets its want, so towers never clump', () => {
    const sim = new Simulation({ seed: 1, content: aiContent(), map: grassNodeMap(160, 32) });
    sim.enqueueSetup({ kind: 'setPlayerPlacementTribes', player: SEAT, tribes: [VIKING] });
    placeHq(sim);
    const FAR = { x: HQ_X + PAST_HQ_DEFENCE_DX, y: HQ_Y };
    sim.enqueueSetup({ kind: 'placeBuilding', buildingType: HOME_TYPE, ...FAR, tribe: VIKING, owner: SEAT });
    sim.step();
    const ctx = ctxOf(sim);
    const tower = { by: 'tower', building: 'tower_01' } as const;
    const value = towerCircle(FAR.x, FAR.y).value;
    // Two towers' worth wanted over the home: the first tower halves its gap, the second closes it.
    const wants = { village: 2 * value, front: 2 * value };
    const shortOf = () =>
      towerPlan(sim.world, ctx, SEAT, ownedBuildings(sim.world, SEAT), { ...tower, wants })?.short ?? [];
    for (const has of [0, value]) {
      const short = shortOf();
      expect(short.map((t) => [t.node, t.has])).toEqual([[{ hx: FAR.x, hy: FAR.y }, has]]);
      const plan = towerPlan(sim.world, ctx, SEAT, ownedBuildings(sim.world, SEAT), { ...tower, wants });
      if (plan === null) throw new Error('setup: no plan');
      const terrain = sim.terrain;
      const type = aiContent().buildings.find((b) => b.typeId === TOWER_TYPE);
      if (terrain === undefined || type === undefined) throw new Error('setup: no terrain or tower type');
      const spot = towerSpot(sim.world, ctx, terrain, SEAT, plan, type, VIKING, NO_FIRE, false);
      if (spot === null) throw new Error('expected a tower spot');
      expect(defenceGain(plan, spot.hx, spot.hy, towerCircle(spot.hx, spot.hy).radius, value)).toBe(value);
      sim.enqueueSetup({
        kind: 'placeBuilding',
        buildingType: TOWER_TYPE,
        x: spot.hx,
        y: spot.hy,
        tribe: VIKING,
        owner: SEAT,
      });
      sim.step();
    }
    expect(shortOf()).toEqual([]);
  });

  it('upgrades a lower tower that lifts a short target ahead of a new tower, from the mid game on', () => {
    const base = aiContent();
    const upper = base.buildings.find((b) => b.typeId === TOWER_TYPE);
    if (upper === undefined) throw new Error('setup: no fixture tower');
    const LOWER_TYPE = 90;
    const lower = {
      ...upper,
      typeId: LOWER_TYPE,
      id: 'tower_00',
      shelterCapacity: upper.shelterCapacity / 2,
      upgradeTarget: TOWER_TYPE,
    };
    const content = { ...base, buildings: [...base.buildings, lower] };
    const sim = new Simulation({ seed: 1, content, map: grassNodeMap(160, 32) });
    sim.enqueueSetup({ kind: 'setPlayerPlacementTribes', player: SEAT, tribes: [VIKING] });
    placeHq(sim);
    const FAR = { x: HQ_X + PAST_HQ_DEFENCE_DX, y: HQ_Y };
    sim.enqueueSetup({ kind: 'placeBuilding', buildingType: HOME_TYPE, ...FAR, tribe: VIKING, owner: SEAT });
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: LOWER_TYPE,
      x: FAR.x + 2,
      y: FAR.y,
      tribe: VIKING,
      owner: SEAT,
    });
    sim.step();
    completeSites(sim);
    const owned = ownedBuildings(sim.world, SEAT);
    const pick = (tick: number) => {
      const ctx = { ...ctxOf(sim, tick), content };
      const wants = { village: upper.shelterCapacity, front: upper.shelterCapacity };
      const plan = towerPlan(sim.world, ctx, SEAT, owned, { by: 'tower', building: 'tower_01', wants });
      if (plan === null) throw new Error('setup: no plan');
      return towerToUpgrade(sim.world, ctx, owned, plan, upper);
    };
    const tower = owned.find((e) => sim.world.get(e, Building).buildingType === LOWER_TYPE);
    expect(pick(TOWER_UPGRADE_FIRST_FROM_TICKS - 1)).toBeNull();
    expect(pick(TOWER_UPGRADE_FIRST_FROM_TICKS)).toBe(tower);
  });

  it('raises the towers a forecast attack wants wave by wave, from the tower lead before each', () => {
    const sim = aiSim();
    placeHq(sim);
    makeAiSeat(sim, SEAT);
    sim.step();
    const RAID_MINUTES = 40;
    const SECONDS_PER_MINUTE = 60;
    const RAID_TICK = minutesToTicks(RAID_MINUTES);
    const at = (tick: number) => {
      const ctx = raidedFromEast(sim, tick);
      const mission = ctx.missions.missions[0];
      if (mission === undefined) throw new Error('setup: no raid');
      // The raid fires on a timer, so it is forecast at its tick.
      const timed = {
        ...mission,
        goals: [{ opcode: 'TimeGone' as const, seconds: RAID_MINUTES * SECONDS_PER_MINUTE }],
      };
      return scheduledTowers(sim.world, { ...ctx, missions: { missions: [timed] } }, SEAT);
    };
    expect(at(0)).toBe(0);
    expect(at(RAID_TICK - TOWER_LEAD_TICKS - 1)).toBe(0);
    expect(at(RAID_TICK - TOWER_LEAD_TICKS)).toBeGreaterThan(0);
    // The assumed peace end is the last deadline: past its lead nothing caps the ring.
    expect(at(ASSUMED_PEACE_TICKS - TOWER_LEAD_TICKS)).toBeNull();
  });

  it('opens no tower upgrade within the quiet window before a forecast attack', () => {
    const sim = aiSim();
    placeHq(sim);
    makeAiSeat(sim, SEAT);
    sim.step();
    const RAID_MINUTES = 40;
    const SECONDS_PER_MINUTE = 60;
    const RAID_TICK = minutesToTicks(RAID_MINUTES);
    const waits = (tick: number, target = 'tower_01') => {
      const ctx = raidedFromEast(sim, tick);
      const mission = ctx.missions.missions[0];
      if (mission === undefined) throw new Error('setup: no raid');
      const timed = {
        ...mission,
        goals: [{ opcode: 'TimeGone' as const, seconds: RAID_MINUTES * SECONDS_PER_MINUTE }],
      };
      return towerUpgradeWaits(sim.world, { ...ctx, missions: { missions: [timed] } }, SEAT, target);
    };
    expect(waits(RAID_TICK - TOWER_UPGRADE_QUIET_TICKS - 1)).toBe(false);
    expect(waits(RAID_TICK - TOWER_UPGRADE_QUIET_TICKS)).toBe(true);
    expect(waits(RAID_TICK)).toBe(true);
    // Once the wave has landed the towers may go up again, and only towers ever wait.
    expect(waits(RAID_TICK + 1)).toBe(false);
    expect(waits(RAID_TICK, 'work_bakery_01')).toBe(false);
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
    for (const dx of [PAST_HQ_DEFENCE_DX, 90, 150]) {
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
    const FAR = { x: HQ_X + PAST_HQ_DEFENCE_DX, y: HQ_Y };
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
