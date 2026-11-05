import { parseContentSet } from '@open-northland/data';
import { describe, expect, it, vi } from 'vitest';
import { aiControlEntity, ComputerStrategy, StalledPlacements } from '../../../../src/components/index.js';
import type { Simulation } from '../../../../src/index.js';
import { ownedBuildings } from '../../../../src/systems/ai-shared/seat-roster.js';
import { MATERIAL_TIERS_DUE } from '../../../../src/systems/computer-player/build-order/default-order.js';
import {
  type BuildOrder,
  type BuildOrderEntry,
  stepKey,
} from '../../../../src/systems/computer-player/build-order/entries.js';
import { stepHeld } from '../../../../src/systems/computer-player/build-order/holds.js';
import { decisionMemo } from '../../../../src/systems/computer-player/build-order/memo.js';
import {
  collectorGoodsWanted,
  entryStatuses,
  lineStatuses,
} from '../../../../src/systems/computer-player/build-order/status.js';
import {
  ASSUMED_PEACE_TICKS,
  TOWER_LEAD_TICKS,
} from '../../../../src/systems/computer-player/military/deadline.js';
import * as seaRoute from '../../../../src/systems/computer-player/sea-route.js';
import { aiContent } from '../../../fixtures/ai-content.js';
import {
  aiSim,
  BAKERY_TOP_TYPE,
  BAKERY_TYPE,
  BARRACKS_TYPE,
  ctxOf,
  entityOfBuilding,
  HQ_TYPE,
  HQ_X,
  HQ_Y,
  IRON,
  makeAiSeat,
  placeResources,
  RESOURCE_SPOTS,
  SEAT,
  spawnMen,
  VIKING,
} from '../support.js';

function seat(ironStock = 0, ironOnMap = true): Simulation {
  const sim = aiSim();
  sim.enqueueSetup({ kind: 'setPlayerPlacementTribes', player: SEAT, tribes: [VIKING] });
  sim.enqueueSetup({
    kind: 'placeBuilding',
    buildingType: HQ_TYPE,
    x: HQ_X,
    y: HQ_Y,
    tribe: VIKING,
    owner: SEAT,
    initialGoods: [{ good: IRON, amount: ironStock }],
  });
  if (ironOnMap) placeResources(sim, [RESOURCE_SPOTS.iron]);
  makeAiSeat(sim, SEAT, { houseBuild: false });
  sim.step();
  return sim;
}

function towersDue(leadTicks: number): BuildOrderEntry {
  return { kind: 'towerCoverage', building: 'tower_01', holdUntil: { kind: 'deadline', leadTicks } };
}

function held(sim: Simulation, entry: BuildOrderEntry, order: BuildOrder = oneStep(entry)): boolean {
  const ctx = ctxOf(sim);
  const owned = ownedBuildings(sim.world, SEAT);
  const memo = decisionMemo();
  const statuses = lineStatuses(sim.world, ctx, SEAT, owned, order, memo);
  return stepHeld(sim.world, ctx, SEAT, owned, order, statuses, entry, memo);
}

function oneStep(entry: BuildOrderEntry): BuildOrder {
  return { lines: [{ id: 'military', steps: [entry] }], priority: [] };
}

describe('build order progress', () => {
  it("counts a building rising to a placement step's tier, so no copy goes up beside the upgrade", () => {
    const entry: BuildOrderEntry = { kind: 'place', building: 'work_bakery_01', count: 1 };
    const sim = seat();
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: BAKERY_TYPE,
      x: HQ_X + 8,
      y: HQ_Y,
      tribe: VIKING,
      owner: SEAT,
    });
    sim.step();
    expect(entryStatuses(sim.world, ctxOf(sim), SEAT, [entry])).toEqual(['unmet']);
    const bakery = entityOfBuilding(sim, BAKERY_TYPE);
    sim.enqueueSetup({ kind: 'upgradeBuilding', building: bakery, target: BAKERY_TOP_TYPE });
    sim.step();
    expect(entryStatuses(sim.world, ctxOf(sim), SEAT, [entry])).toEqual(['satisfied']);
  });

  it('holds a military step until its lead before the deadline, or until the defence comes first', () => {
    const sim = seat();
    expect(held(sim, towersDue(TOWER_LEAD_TICKS))).toBe(true);
    // A seat outside a lobby peace plans for the assumed one, so a lead that long has come.
    expect(held(sim, towersDue(ASSUMED_PEACE_TICKS))).toBe(false);

    const ended = seat();
    ended.enqueueSetup({ kind: 'setPeaceTime', untilTick: ended.tick, players: [SEAT] });
    ended.step();
    expect(held(ended, towersDue(TOWER_LEAD_TICKS))).toBe(false);

    const carrier = aiControlEntity(sim.world, SEAT);
    if (carrier === null) throw new Error('setup: no AI seat');
    const strategy = sim.world.mut(carrier, ComputerStrategy);
    strategy.military = { ...strategy.military, posture: 'defend', evidence: ['underAttack'] };
    expect(held(sim, towersDue(TOWER_LEAD_TICKS))).toBe(false);
  });

  it('holds a step on the ship path only while the seat sails and its defence does not come first', () => {
    const entry: BuildOrderEntry = {
      kind: 'place',
      building: 'barracks',
      count: 1,
      holdUntil: { kind: 'shipPath' },
    };
    const landed = seat();
    expect(held(landed, entry)).toBe(false);

    const sailing = seat();
    vi.spyOn(seaRoute, 'seatNeedsShips').mockReturnValue(true);
    expect(held(sailing, entry)).toBe(true);
    const carrier = aiControlEntity(sailing.world, SEAT);
    if (carrier === null) throw new Error('setup: no AI seat');
    const strategy = sailing.world.mut(carrier, ComputerStrategy);
    strategy.military = { ...strategy.military, posture: 'defend', evidence: ['underAttack'] };
    expect(held(sailing, entry)).toBe(false);
    vi.restoreAllMocks();
  });

  it('holds the tower ring until the barracks is placed, unless the defence comes first', () => {
    const barracks: BuildOrderEntry = { kind: 'place', building: 'barracks', count: 1 };
    const ring: BuildOrderEntry = {
      kind: 'towerCoverage',
      building: 'tower_01',
      lane: true,
      holdUntil: { kind: 'placedUnlessDefending', building: 'barracks' },
    };
    const order: BuildOrder = { lines: [{ id: 'military', steps: [ring, barracks] }], priority: [] };
    const sim = seat();
    expect(held(sim, ring, order)).toBe(true);

    const defending = seat();
    const carrier = aiControlEntity(defending.world, SEAT);
    if (carrier === null) throw new Error('setup: no AI seat');
    const strategy = defending.world.mut(carrier, ComputerStrategy);
    strategy.military = { ...strategy.military, posture: 'defend', evidence: ['underAttack'] };
    expect(held(defending, ring, order)).toBe(false);

    // A barracks site is enough: the towers follow while it rises.
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: BARRACKS_TYPE,
      x: HQ_X + 12,
      y: HQ_Y,
      tribe: VIKING,
      owner: SEAT,
      underConstruction: true,
      force: true,
    });
    sim.step();
    expect(held(sim, ring, order)).toBe(false);
  });

  it('lets a step held on a building act once the order can never raise that building', () => {
    const brewery: BuildOrderEntry = {
      kind: 'place',
      building: 'work_brewery',
      count: 1,
      needsResources: ['iron'],
    };
    const after: BuildOrderEntry = {
      kind: 'place',
      building: 'work_well_00',
      count: 1,
      holdUntil: { kind: 'built', building: 'work_brewery' },
    };
    const order: BuildOrder = {
      lines: [
        { id: 'brewery', steps: [brewery] },
        { id: 'coins', steps: [after] },
      ],
      priority: [],
    };
    // With iron on the map the brewery may still come; with none its only step is skipped for good.
    expect(held(seat(), after, order)).toBe(true);
    expect(held(seat(0, false), after, order)).toBe(false);
  });

  it('holds a step until the seat counts the settlers its hold names', () => {
    const SETTLERS = 3;
    const brewery: BuildOrderEntry = {
      kind: 'place',
      building: 'work_brewery',
      count: 1,
      holdUntil: { kind: 'settlers', count: SETTLERS },
    };
    const sim = seat();
    spawnMen(sim, SETTLERS - 1);
    sim.step();
    expect(held(sim, brewery)).toBe(true);
    spawnMen(sim, 1);
    sim.step();
    expect(held(sim, brewery)).toBe(false);
  });

  it('passes a collector over while its good lies stocked, hiring again under half of it', () => {
    const STOCKED = 10;
    const gatherer: BuildOrderEntry = { kind: 'collector', good: 'iron', stockedAt: STOCKED };
    const status = (stock: number) => {
      const sim = seat(stock);
      return entryStatuses(sim.world, ctxOf(sim), SEAT, [gatherer])[0];
    };
    expect(status(STOCKED)).toBe('skip');
    expect(status(STOCKED / 2)).toBe('skip');
    expect(status(STOCKED / 2 - 1)).toBe('unmet');
  });

  it('holds a gatherer until every building of an all-hold stands, dropping one the order never raises', () => {
    const waitsOn = (building: string): BuildOrderEntry => ({
      kind: 'collector',
      good: 'iron',
      holdUntil: {
        kind: 'all',
        holds: [
          { kind: 'built', building: 'work_bakery_00' },
          { kind: 'built', building },
        ],
      },
    });
    const wanted = (sim: Simulation, gatherer: BuildOrderEntry, brewery = false): boolean => {
      const order: BuildOrder = {
        lines: [
          { id: 'bread', steps: [{ kind: 'place', building: 'work_bakery_00', count: 1 }] },
          { id: 'brewery', steps: brewery ? [{ kind: 'place', building: 'work_brewery', count: 1 }] : [] },
          { id: 'weapons', steps: [gatherer] },
        ],
        priority: [],
      };
      const statuses = lineStatuses(sim.world, ctxOf(sim), SEAT, ownedBuildings(sim.world, SEAT), order);
      return collectorGoodsWanted(order, statuses, sim.tick).has('iron');
    };
    const sim = seat();
    // Nothing raises the second building, so only the bakery holds the gatherer back.
    const gatherer = waitsOn('no_such_building');
    expect(wanted(sim, gatherer)).toBe(false);
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: BAKERY_TYPE,
      x: HQ_X + 8,
      y: HQ_Y,
      tribe: VIKING,
      owner: SEAT,
    });
    sim.step();
    expect(wanted(sim, gatherer)).toBe(true);
    // A brewery no step raises drops out too; one the order may still raise holds.
    expect(wanted(sim, waitsOn('work_brewery'))).toBe(true);
    expect(wanted(sim, waitsOn('work_brewery'), true)).toBe(false);
  });

  it('places a copy ahead of crews only when its step says so', () => {
    const sim = seat();
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: BAKERY_TYPE,
      x: HQ_X + 8,
      y: HQ_Y,
      tribe: VIKING,
      owner: SEAT,
      underConstruction: true,
    });
    sim.step();
    const copy: BuildOrderEntry = { kind: 'place', building: 'work_bakery_00', count: 2 };
    expect(held(sim, copy)).toBe(true);
    expect(held(sim, { ...copy, aheadOfCrews: true })).toBe(false);
  });

  describe('the tile and marble tiers hold', () => {
    const TILE = 20;
    const ORNAMENT = 21;
    const base = aiContent();
    // The tiers' goods, and a brewery whose bill takes tiles.
    const content = parseContentSet({
      ...base,
      goods: [...base.goods, { typeId: TILE, id: 'tile' }, { typeId: ORNAMENT, id: 'ornament' }],
      buildings: base.buildings.map((b) =>
        b.id === 'work_brewery' ? { ...b, construction: [{ goodType: TILE, amount: 1 }] } : b,
      ),
    });
    const upgrade: BuildOrderEntry = {
      kind: 'upgrade',
      building: 'work_bakery_01',
      count: 1,
      holdUntil: MATERIAL_TIERS_DUE,
    };
    const mill: BuildOrderEntry = { kind: 'place', building: 'work_mill_00', count: 1 };
    const order = (...lines: BuildOrder['lines']): BuildOrder => ({
      lines: [{ id: 'materials', steps: [upgrade] }, ...lines],
      priority: [],
    });
    const tierSeat = (): Simulation => {
      const sim = aiSim(1, content);
      sim.enqueueSetup({
        kind: 'placeBuilding',
        buildingType: HQ_TYPE,
        x: HQ_X,
        y: HQ_Y,
        tribe: VIKING,
        owner: SEAT,
      });
      makeAiSeat(sim, SEAT, { houseBuild: false });
      sim.step();
      return sim;
    };
    const heldBy = (sim: Simulation, held: BuildOrder): boolean => {
      const ctx = { ...ctxOf(sim), content };
      const owned = ownedBuildings(sim.world, SEAT);
      const memo = decisionMemo();
      const statuses = lineStatuses(sim.world, ctx, SEAT, owned, held, memo);
      return stepHeld(sim.world, ctx, SEAT, owned, held, statuses, upgrade, memo);
    };

    it('holds while a core placement heads its line, ready to place', () => {
      expect(heldBy(tierSeat(), order({ id: 'bread', steps: [mill] }))).toBe(true);
    });

    it('lets go for an unmet housing lane, which never counts as due', () => {
      const homes = order({ id: 'homes', steps: [{ kind: 'housing', building: 'home_level_00', count: 3 }] });
      const sim = tierSeat();
      const ctx = { ...ctxOf(sim), content };
      expect(lineStatuses(sim.world, ctx, SEAT, ownedBuildings(sim.world, SEAT), homes).get('homes')).toEqual(
        ['unmet'],
      );
      expect(heldBy(sim, homes)).toBe(false);
    });

    it('lets go while the core placement waits out a failed spot search', () => {
      const sim = tierSeat();
      const carrier = aiControlEntity(sim.world, SEAT);
      if (carrier === null) throw new Error('setup: no AI seat');
      sim.world.add(carrier, StalledPlacements, {
        retryTicks: new Map([[stepKey('bread', 0), sim.tick + 1]]),
        holding: new Map(),
      });
      expect(heldBy(sim, order({ id: 'bread', steps: [mill] }))).toBe(false);
    });

    it('lets go once a step heading another line wants tiles', () => {
      const brewery: BuildOrderEntry = { kind: 'place', building: 'work_brewery', count: 1 };
      const sim = tierSeat();
      expect(heldBy(sim, order({ id: 'bread', steps: [mill] }, { id: 'brewery', steps: [brewery] }))).toBe(
        false,
      );
    });
  });
});
