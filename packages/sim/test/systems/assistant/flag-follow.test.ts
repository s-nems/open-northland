import { describe, expect, it } from 'vitest';
import {
  Building,
  DEFAULT_WORK_FLAG_RADIUS,
  HaulFlag,
  IdleStand,
  JobAssignment,
  Owner,
  PlayerOrder,
  Position,
  ReplantMisses,
  Resource,
  Stockpile,
  WorkFlag,
  writeProductionGoods,
} from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { fx, nodeOfPosition, ONE, Simulation } from '../../../src/index.js';
import {
  FLAG_FOLLOW_CHECK_PERIOD_TICKS,
  FOLLOW_FLAG_BAND,
  HOPELESS_REPLANT_RETRY_EVERY_CHECKS,
  REPLANT_MISSES_BEFORE_SLOW_RETRY,
  REPLANT_RETRY_EVERY_CHECKS,
  workReachOf,
} from '../../../src/systems/assistant/flag-follow.js';
import { anchorOnlyFootprint, stampResourceFootprintData } from '../../../src/systems/index.js';
import { testContent } from '../../fixtures/content.js';
import {
  bindToFlag,
  grassMap,
  makeWoodcutter,
  placeFellableTree,
  runTicks,
  VIKING,
  WOOD,
  WOODCUTTER,
} from '../settlers/drives/gatherer-flag/support.js';

const PLAYER = 0;
/** Tiles on row 0 sit at node 2x, so a tree at tile 25 stands 40 nodes from a flag at tile 5: past the
 *  default circle, inside one walk range. */
const FLAG_TILE = 5;
const FAR_TREE_TILE = 25;
/** Long enough for every gatherer's check to come round once. */
const CHECK_ROUND_TICKS = FLAG_FOLLOW_CHECK_PERIOD_TICKS + 1;
/** Long enough for a fed gatherer's retry phase, the only check that may move his flag closer. */
const FED_ROUND_TICKS = FLAG_FOLLOW_CHECK_PERIOD_TICKS * REPLANT_RETRY_EVERY_CHECKS + 1;

/** The fixture woodcutter's trade also granted the stone harvest, so with no counters he collects both. */
const STONE = 4;
const STONE_HARVEST_ATOMIC = 25;
function bothGoodsContent(): ReturnType<typeof testContent> {
  const base = testContent();
  return {
    ...base,
    jobs: base.jobs.map((job) =>
      job.typeId === WOODCUTTER
        ? { ...job, allowedAtomics: [...job.allowedAtomics, STONE_HARVEST_ATOMIC] }
        : job,
    ),
  };
}
/** The fixture's home, placed as the owner's only building. */
const HOME = 2;
/** The fixture's headquarters, which stocks wood but no stone. */
const HEADQUARTERS = 1;
const POST_TILE = 90;
const OTHER_PLAYER = 1;

function setup(
  moveFlags: boolean,
  content = testContent(),
): { sim: Simulation; gatherer: Entity; flag: Entity; tree: Entity } {
  const sim = new Simulation({ seed: 1, content, map: grassMap(96, 8) });
  const gatherer = makeWoodcutter(sim, FLAG_TILE, 0);
  sim.world.add(gatherer, Owner, { player: PLAYER });
  const flag = bindToFlag(sim, gatherer, FLAG_TILE, 0, DEFAULT_WORK_FLAG_RADIUS);
  const tree = placeFellableTree(sim, FAR_TREE_TILE, 0);
  if (moveFlags) sim.enqueueSetup({ kind: 'setAssistantMoveFlags', player: PLAYER, enabled: true });
  return { sim, gatherer, flag, tree };
}

function nodeOf(sim: Simulation, e: Entity): { hx: number; hy: number } {
  const p = sim.world.get(e, Position);
  return nodeOfPosition(p.x, p.y);
}

function nodeDistance(a: { hx: number; hy: number }, b: { hx: number; hy: number }): number {
  return Math.abs(a.hx - b.hx) + Math.abs(a.hy - b.hy);
}

describe('assistant flag follow', () => {
  it('leaves a worked-out flag where the player put it while the switch is off', () => {
    const { sim, flag } = setup(false);
    const before = nodeOf(sim, flag);
    runTicks(sim, CHECK_ROUND_TICKS);
    expect(nodeOf(sim, flag)).toEqual(before);
    expect(sim.assistantMovesFlags(PLAYER)).toBe(false);
  });

  it('moves a worked-out flag beside the nearest resource the gatherer can work, once switched on', () => {
    const { sim, flag, tree } = setup(true);
    const before = nodeOf(sim, flag);
    expect(runTicks(sim, CHECK_ROUND_TICKS)).toEqual([]);
    expect(sim.assistantMovesFlags(PLAYER)).toBe(true);
    const after = nodeOf(sim, flag);
    expect(after).not.toEqual(before);
    const distance = nodeDistance(after, nodeOf(sim, tree));
    expect(distance).toBeGreaterThanOrEqual(FOLLOW_FLAG_BAND.min);
    expect(distance).toBeLessThanOrEqual(FOLLOW_FLAG_BAND.max);
  });

  it('leaves a flag alone while a resource of his goods stands within the band', () => {
    const { sim, flag } = setup(true);
    placeFellableTree(sim, FLAG_TILE + 3, 0);
    const before = nodeOf(sim, flag);
    runTicks(sim, CHECK_ROUND_TICKS);
    expect(nodeOf(sim, flag)).toEqual(before);
  });

  it('keeps the flag of a gatherer whose counters stop every good', () => {
    const { sim, gatherer, flag } = setup(true);
    writeProductionGoods(sim.world, gatherer, [WOOD], new Set());
    const before = nodeOf(sim, flag);
    runTicks(sim, CHECK_ROUND_TICKS);
    expect(nodeOf(sim, flag)).toEqual(before);
  });

  it('counts a miss and keeps the flag when no resource of his goods is left', () => {
    const { sim, gatherer, flag, tree } = setup(true);
    sim.world.destroy(tree);
    const before = nodeOf(sim, flag);
    runTicks(sim, CHECK_ROUND_TICKS);
    expect(nodeOf(sim, flag)).toEqual(before);
    expect(sim.world.get(gatherer, ReplantMisses)).toEqual({ ...before, misses: 1 });
  });

  it('searches again less often once its searches keep missing', () => {
    const { sim, gatherer, tree } = setup(true);
    sim.world.destroy(tree);
    const misses = (): number => sim.world.tryGet(gatherer, ReplantMisses)?.misses ?? 0;
    while (misses() < REPLANT_MISSES_BEFORE_SLOW_RETRY) runTicks(sim, FLAG_FOLLOW_CHECK_PERIOD_TICKS);
    // One full slow phase: the earlier retry phase would have searched three times in it.
    runTicks(sim, FLAG_FOLLOW_CHECK_PERIOD_TICKS * HOPELESS_REPLANT_RETRY_EVERY_CHECKS);
    expect(misses()).toBe(REPLANT_MISSES_BEFORE_SLOW_RETRY + 1);
  });

  it('plants two worked-out flags after one resource on different nodes', () => {
    const { sim, flag } = setup(true);
    const second = makeWoodcutter(sim, FLAG_TILE, 2);
    sim.world.add(second, Owner, { player: PLAYER });
    const secondFlag = bindToFlag(sim, second, FLAG_TILE, 2, DEFAULT_WORK_FLAG_RADIUS);
    const before = [nodeOf(sim, flag), nodeOf(sim, secondFlag)];
    runTicks(sim, CHECK_ROUND_TICKS);
    const after = [nodeOf(sim, flag), nodeOf(sim, secondFlag)];
    expect(after[0]).not.toEqual(before[0]);
    expect(after[1]).not.toEqual(before[1]);
    expect(after[0]).not.toEqual(after[1]);
  });

  it("moves the flag a gatherer's post took, after the goods his post stocks", () => {
    const { sim, gatherer, flag, tree } = setup(true, bothGoodsContent());
    const post = sim.world.create();
    sim.world.add(post, Position, { x: fx.fromInt(POST_TILE), y: fx.fromInt(0) });
    sim.world.add(post, Building, { buildingType: HEADQUARTERS, tribe: VIKING, built: ONE, level: 0 });
    sim.world.add(post, Stockpile, { amounts: new Map() });
    sim.world.add(post, Owner, { player: PLAYER });
    sim.world.add(gatherer, JobAssignment, { workplace: post });
    sim.world.remove(gatherer, WorkFlag);
    sim.world.add(gatherer, HaulFlag, { flag, radius: DEFAULT_WORK_FLAG_RADIUS });
    // Stone inside his circle, which his post does not stock: his patch is worked out all the same.
    const stone = sim.world.create();
    sim.world.add(stone, Position, { x: fx.fromInt(FLAG_TILE + 10), y: fx.fromInt(0) });
    sim.world.add(stone, Resource, { goodType: STONE, remaining: 2, harvestAtomic: STONE_HARVEST_ATOMIC });
    stampResourceFootprintData(sim.world, stone, anchorOnlyFootprint());

    runTicks(sim, CHECK_ROUND_TICKS);
    expect(nodeDistance(nodeOf(sim, flag), nodeOf(sim, tree))).toBeLessThanOrEqual(FOLLOW_FLAG_BAND.max);
    expect(sim.world.get(gatherer, HaulFlag).flag).toBe(flag);
    expect(sim.world.has(gatherer, WorkFlag)).toBe(false);
  });

  it('keeps the flag within the band of the nearest resource while the circle still holds it', () => {
    const { sim, flag } = setup(true);
    // 24 nodes out: inside the circle, past the band.
    const near = placeFellableTree(sim, FLAG_TILE + 12, 0);
    runTicks(sim, FED_ROUND_TICKS);
    const distance = nodeDistance(nodeOf(sim, flag), nodeOf(sim, near));
    expect(distance).toBeGreaterThanOrEqual(FOLLOW_FLAG_BAND.min);
    expect(distance).toBeLessThanOrEqual(FOLLOW_FLAG_BAND.max);
  });

  it("plants the moved flag on the side of the owner's building", () => {
    const { sim, flag, tree } = setup(true);
    // The owner's only building stands east of the far tree, the old flag west of it.
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: HOME,
      x: 84,
      y: 4,
      tribe: VIKING,
      owner: PLAYER,
      force: true,
    });
    runTicks(sim, CHECK_ROUND_TICKS);
    expect(nodeOf(sim, flag).hx).toBeGreaterThan(nodeOf(sim, tree).hx);
  });

  it('follows whichever good is nearest for a gatherer collecting everything', () => {
    const { sim, flag } = setup(true, bothGoodsContent());
    const stone = sim.world.create();
    sim.world.add(stone, Position, { x: fx.fromInt(FLAG_TILE + 10), y: fx.fromInt(0) });
    sim.world.add(stone, Resource, { goodType: STONE, remaining: 2, harvestAtomic: STONE_HARVEST_ATOMIC });
    stampResourceFootprintData(sim.world, stone, anchorOnlyFootprint());
    runTicks(sim, FED_ROUND_TICKS);
    const at = nodeOf(sim, flag);
    expect(nodeDistance(at, nodeOf(sim, stone))).toBeLessThanOrEqual(FOLLOW_FLAG_BAND.max);
    // On the stone's near side: a flag sent after the farther tree would stand past the stone.
    expect(at.hx).toBeLessThan(nodeOf(sim, stone).hx);
  });

  it("leaves another player's flags alone while his own switch is off", () => {
    const { sim, flag } = setup(true);
    const neighbour = makeWoodcutter(sim, FLAG_TILE, 2);
    sim.world.add(neighbour, Owner, { player: OTHER_PLAYER });
    const neighbourFlag = bindToFlag(sim, neighbour, FLAG_TILE, 2, DEFAULT_WORK_FLAG_RADIUS);
    const before = [nodeOf(sim, flag), nodeOf(sim, neighbourFlag)];
    runTicks(sim, CHECK_ROUND_TICKS);
    expect(nodeOf(sim, flag)).not.toEqual(before[0]);
    expect(nodeOf(sim, neighbourFlag)).toEqual(before[1]);
  });

  it("never cuts a walk another system owns, such as the player's move order", () => {
    const { sim, gatherer, flag } = setup(true);
    sim.enqueueSetup({ kind: 'moveUnit', entity: gatherer, x: 90, y: 4 });
    const before = nodeOf(sim, flag);
    runTicks(sim, CHECK_ROUND_TICKS);
    expect(sim.world.has(gatherer, PlayerOrder)).toBe(true);
    expect(nodeOf(sim, flag)).toEqual(before);
  });

  it('wakes an idle gatherer on the tick his flag moves', () => {
    const { sim, gatherer, flag } = setup(true);
    const before = nodeOf(sim, flag);
    for (let t = 0; t < CHECK_ROUND_TICKS; t++) {
      runTicks(sim, 1);
      if (nodeDistance(nodeOf(sim, flag), before) === 0) continue;
      expect(sim.world.has(gatherer, IdleStand)).toBe(false);
      return;
    }
    throw new Error('the flag never moved');
  });

  it('switches back off', () => {
    const { sim } = setup(true);
    runTicks(sim, 1);
    sim.enqueueSetup({ kind: 'setAssistantMoveFlags', player: PLAYER, enabled: false });
    runTicks(sim, 1);
    expect(sim.assistantMovesFlags(PLAYER)).toBe(false);
  });
});

describe('flag follow work reach', () => {
  it('shifts an odd-row work cell half a node to +x, so each anchor row parity keeps its own reach', () => {
    const EVEN_ANCHOR_ROW = 4;
    const ODD_ANCHOR_ROW = 5;
    // An odd dy lands on the other row parity: from an odd anchor row its x offset grows by one.
    const east = { walk: [], build: [], work: [{ dx: 2, dy: 1 }] };
    const west = { walk: [], build: [], work: [{ dx: -2, dy: 1 }] };
    expect(workReachOf(east, ODD_ANCHOR_ROW)).toBe(4);
    expect(workReachOf(east, EVEN_ANCHOR_ROW)).toBe(3);
    expect(workReachOf(west, EVEN_ANCHOR_ROW)).toBe(3);
    expect(workReachOf(west, ODD_ANCHOR_ROW)).toBe(2);
  });
});
