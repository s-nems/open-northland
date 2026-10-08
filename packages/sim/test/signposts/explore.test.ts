import { parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  addPerson,
  Building,
  CurrentAtomic,
  EquipOrder,
  ExploreOrder,
  FOG_MODE,
  Health,
  MoveGoal,
  NeedOrder,
  OrderQueue,
  Owner,
  PlayerOrder,
  Position,
  Resource,
  Stance,
  Stockpile,
  TrainingOrder,
} from '../../src/components/index.js';
import { type Fixed, fx, ONE } from '../../src/core/fixed.js';
import type { Entity } from '../../src/ecs/world.js';
import {
  exportSaveGame,
  parseSaveGame,
  restoreSimulation,
  Simulation,
  serializeSaveGame,
} from '../../src/index.js';
import { nodeOfPosition, positionOfNode } from '../../src/nav/halfcell.js';
import type { NodeId } from '../../src/nav/terrain/index.js';
import { stampResourceFootprintData } from '../../src/systems/index.js';
import { MILITARY_MODE } from '../../src/systems/readviews/index.js';
import { FOG_STATE } from '../../src/systems/vision/index.js';
import { testContent } from '../fixtures/content.js';
import { grassCellMap as grassMap, waterColumnMap } from '../fixtures/terrain.js';

/**
 * The scout's "Explore" order: it sweeps the unexplored ground of its landmass, one leg at a time, and
 * retires with an `explorationFinished` event once nothing walkable there is hidden any more.
 */

const VIKING = 1;
const SCOUT_JOB = 27;
const WOODCUTTER = 1;
const P0 = 0;
const SHOES = 8; // fixture boots-class wearable
const CARRIER_JOB = 24;
/** Out of the 10..19 band the shared fixture reserves for suites' own buildings. */
const BARRACKS = 91;
const WALK_INTO_LEG_TICKS = 30;
/** Enough for a scout to sweep the water fixture's own bank several times over. */
const SWEEP_TICKS = 3000;
/** A landmass several sight ranges across, which takes the sweep many legs. */
const WIDE_W = 48;
const WIDE_H = 24;
const WIDE_SWEEP_TICKS = 20000;
/** A wide island swept from its middle, and the rings around the start that must be seen before either
 *  side's far edge is. */
const SPIRAL_W = 80;
const SPIRAL_H = 50;
const NEAR_RING = 20;
/** How deep in the fog, in fog cells, an unseen scrap a finished sweep leaves may reach. */
const SCRAP_DEPTH = 3;
/** An unseen strip along the map edge too thin to walk to, and a band wide enough to. */
const THIN_STRIP_ROWS = 1;
const WIDE_BAND_ROWS = 6;
/** Trees on every third node of every other node row east of this node column. */
const FOREST_EDGE = 24;
const FOREST_NODE_STEP = 3;
const FOREST_ROW_STEP = 2;
const WOOD = 1;
const TREE_HARVEST_ATOMIC = 24;
/** A scout boxed in by a square of trunks this many nodes out, in the middle of the wide map. */
const WALLED_AT = { x: 24, y: 12 } as const;
const WALL_RADIUS = 2;
/** A trunk that blocks its own node, as a real tree's landscape record does. */
const TRUNK = { walk: [{ dx: 0, dy: 0 }], build: [{ dx: 0, dy: 0 }], work: [{ dx: 0, dy: 0 }] };
/** Long enough for the needs ladder to lay a tired scout down, and for one sleep to run out. */
const REST_TICKS = 200;
const P1 = 1;
/** Where an enemy in a fighting stance stands, close enough for the battle alert to hold a tired scout
 *  in a fighting stance on its feet, too far for either to pick a fight in the test's few ticks. */
const ALERT_ENEMY_AT = { x: 4, y: 4 } as const;
const ALERT_TICKS = 20;
/** Ticks a save is run on for both the restored and the original sim. */
const AFTER_RESTORE_TICKS = 300;
/** How far east of a walled scout, inside its wall, a walk queued behind the sweep goes, in nodes. */
const QUEUED_STEP_NODES = 1;

function contentWithBarracks() {
  const base = testContent();
  // A LEARN house that employs haulers is what reads as a barracks.
  const barracks = {
    typeId: BARRACKS,
    id: 'barracks',
    kind: 'training' as const,
    workers: [{ jobType: CARRIER_JOB, count: 1 }],
  };
  return parseContentSet({ ...base, buildings: [...base.buildings, barracks] });
}

/** The default small grass map a sweep runs on, in cells. */
const SMALL_W = 24;
const SMALL_H = 8;

function simWithFog(w = SMALL_W, h = SMALL_H, map = grassMap(w, h)): Simulation {
  const sim = new Simulation({ seed: 7, content: contentWithBarracks(), map });
  sim.enqueueSetup({ kind: 'setFogMode', mode: FOG_MODE.CLASSIC });
  return sim;
}

function scoutAt(
  sim: Simulation,
  x: number,
  y: number,
  jobType: number = SCOUT_JOB,
  fatigue: Fixed = fx.fromInt(0),
): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  addPerson(sim.world, e, {
    tribe: VIKING,
    jobType,
    hunger: fx.fromInt(0),
    fatigue,
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
  });
  sim.world.add(e, Health, { hitpoints: 2000, max: 2000 });
  sim.world.add(e, Owner, { player: P0 });
  sim.world.add(e, Stance, { mode: MILITARY_MODE.IGNORE, anchorCell: null });
  return e;
}

/** How many cells of the map `P0` has never seen. */
function unexploredCells(sim: Simulation): number {
  const fog = sim.fog;
  if (fog === undefined) throw new Error('mapless sim');
  let count = 0;
  for (let r = 0; r < fog.cellsHigh; r++) {
    for (let c = 0; c < fog.cellsWide; c++) {
      if (fog.stateAt(P0, c, r) === FOG_STATE.UNEXPLORED) count++;
    }
  }
  return count;
}

/** A tree whose trunk blocks node (hx, hy). */
function trunkAt(sim: Simulation, hx: number, hy: number): void {
  const tree = sim.world.create();
  sim.world.add(tree, Position, positionOfNode(hx, hy));
  sim.world.add(tree, Resource, { goodType: WOOD, remaining: 5, harvestAtomic: TREE_HARVEST_ATOMIC });
  stampResourceFootprintData(sim.world, tree, TRUNK);
}

/** A scout in the middle of the wide map, boxed in by a square of trunks; with the node it stands on. */
function walledScout(sim: Simulation): { readonly scout: Entity; readonly at: { hx: number; hy: number } } {
  const scout = scoutAt(sim, WALLED_AT.x, WALLED_AT.y);
  const p = sim.world.get(scout, Position);
  const at = nodeOfPosition(p.x, p.y);
  for (let dy = -WALL_RADIUS; dy <= WALL_RADIUS; dy++) {
    for (let dx = -WALL_RADIUS; dx <= WALL_RADIUS; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) === WALL_RADIUS) trunkAt(sim, at.hx + dx, at.hy + dy);
    }
  }
  return { scout, at };
}

/** How deep in the fog the unseen cell of `area` farthest from seen ground lies, in fog cells (square
 *  rings): what a finished sweep leaves should be thin scraps. */
function deepestUnseen(sim: Simulation, area: (col: number, row: number) => boolean): number {
  const fog = sim.fog;
  if (fog === undefined) throw new Error('mapless sim');
  const seen = (c: number, r: number): boolean =>
    c >= 0 &&
    r >= 0 &&
    c < fog.cellsWide &&
    r < fog.cellsHigh &&
    fog.stateAt(P0, c, r) !== FOG_STATE.UNEXPLORED;
  let deepest = 0;
  for (let row = 0; row < fog.cellsHigh; row++) {
    for (let col = 0; col < fog.cellsWide; col++) {
      if (!area(col, row) || seen(col, row)) continue;
      let depth = 1;
      const nearSeen = (d: number): boolean => {
        for (let dy = -d; dy <= d; dy++)
          for (let dx = -d; dx <= d; dx++) if (seen(col + dx, row + dy)) return true;
        return false;
      };
      while (!nearSeen(depth) && depth <= Math.max(fog.cellsWide, fog.cellsHigh)) depth++;
      deepest = Math.max(deepest, depth);
    }
  }
  return deepest;
}

/** Send the scout exploring and step until its sweep retires or `limit` ticks pass; whether an
 *  `explorationFinished` event named it. */
function sweepOut(sim: Simulation, scout: Entity, limit = SWEEP_TICKS): boolean {
  sim.enqueueSetup({ kind: 'explore', entity: scout });
  let reported = false;
  for (let i = 0; i < limit && (i === 0 || sim.world.has(scout, ExploreOrder)); i++) {
    sim.step();
    if (sim.events.current().some((ev) => ev.kind === 'explorationFinished' && ev.entity === scout)) {
      reported = true;
    }
  }
  return reported;
}

function isUnexploredNode(sim: Simulation, node: NodeId): boolean {
  const { terrain, fog } = sim;
  if (terrain === undefined || fog === undefined) throw new Error('mapless sim');
  const c = terrain.coordsOf(node);
  return fog.stateAt(P0, c.x >> 1, c.y >> 1) === FOG_STATE.UNEXPLORED;
}

describe('explore - the scout sweep', () => {
  it('walks the scout at unexplored ground and reveals it', () => {
    const sim = simWithFog();
    const scout = scoutAt(sim, 1, 1);
    sim.step();
    const before = unexploredCells(sim);

    sim.enqueueSetup({ kind: 'explore', entity: scout });
    sim.step();
    expect(sim.world.has(scout, ExploreOrder)).toBe(true);
    expect(sim.world.has(scout, MoveGoal)).toBe(true);

    for (let i = 0; i < 400 && sim.world.has(scout, ExploreOrder); i++) sim.step();
    expect(unexploredCells(sim)).toBeLessThan(before);
  });

  it('sweeps the landmass but its thin scraps, then retires the order and reports it', () => {
    const sim = simWithFog(WIDE_W, WIDE_H);
    const scout = scoutAt(sim, 1, 1);
    sim.step(); // the first tick is what switches the fog on, and an unlit map hides nothing
    expect(unexploredCells(sim)).toBeGreaterThan(0);

    const reported = sweepOut(sim, scout, WIDE_SWEEP_TICKS);

    expect(sim.world.has(scout, ExploreOrder)).toBe(false);
    expect(reported).toBe(true);
    expect(deepestUnseen(sim, () => true)).toBeLessThanOrEqual(SCRAP_DEPTH);
  });

  it('sweeps a forest without aiming at a tree or raising a lost note', () => {
    const sim = simWithFog(WIDE_W, WIDE_H);
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('missing terrain');
    const trees = new Set<NodeId>();
    for (let hy = 0; hy < terrain.height; hy += FOREST_ROW_STEP) {
      for (let hx = FOREST_EDGE; hx < terrain.width; hx += FOREST_NODE_STEP) {
        trunkAt(sim, hx, hy);
        trees.add(terrain.nodeAt(hx, hy));
      }
    }
    const scout = scoutAt(sim, 1, 1);
    sim.step();
    let lostNotes = 0;
    const treeGoals = new Set<NodeId>();
    sim.enqueueSetup({ kind: 'explore', entity: scout });
    for (let i = 0; i < WIDE_SWEEP_TICKS && (i === 0 || sim.world.has(scout, ExploreOrder)); i++) {
      sim.step();
      lostNotes += sim.events.current().filter((ev) => ev.kind === 'settlerLost').length;
      const goal = sim.world.tryGet(scout, ExploreOrder)?.leg?.to;
      if (goal !== undefined && trees.has(goal)) treeGoals.add(goal);
    }
    expect(sim.world.has(scout, ExploreOrder)).toBe(false);
    expect([...treeGoals]).toEqual([]);
    expect(lostNotes).toBe(0);
    expect(deepestUnseen(sim, () => true)).toBeLessThanOrEqual(SCRAP_DEPTH);
  });

  it('a scout walled in gives its legs up after a run of failures and reports, raising no lost note', () => {
    const sim = simWithFog(WIDE_W, WIDE_H);
    const { scout } = walledScout(sim);
    sim.step();
    let lostNotes = 0;
    let reported = false;
    sim.enqueueSetup({ kind: 'explore', entity: scout });
    for (let i = 0; i < SWEEP_TICKS && (i === 0 || sim.world.has(scout, ExploreOrder)); i++) {
      sim.step();
      for (const ev of sim.events.current()) {
        if (ev.kind === 'settlerLost') lostNotes++;
        if (ev.kind === 'explorationFinished') reported = true;
      }
    }
    expect(sim.world.has(scout, ExploreOrder)).toBe(false);
    expect(reported).toBe(true);
    expect(lostNotes).toBe(0);
    expect(unexploredCells(sim)).toBeGreaterThan(0);
  });

  it.each([
    { rows: THIN_STRIP_ROWS, walks: false },
    { rows: WIDE_BAND_ROWS, walks: true },
  ])('with $rows unseen rows left along the map edge, walks there: $walks', ({ rows, walks }) => {
    const sim = simWithFog(WIDE_W, WIDE_H);
    const scout = scoutAt(sim, WIDE_W / 2, WIDE_H / 2);
    sim.step();
    const fog = sim.fog;
    if (fog === undefined) throw new Error('mapless sim');
    for (let r = rows; r < WIDE_H; r++) for (let c = 0; c < WIDE_W; c++) fog.stampSight(P0, c, r, 0);
    sim.enqueueSetup({ kind: 'explore', entity: scout });
    sim.step();
    expect(sim.world.has(scout, MoveGoal)).toBe(walks);
    expect(sim.world.has(scout, ExploreOrder)).toBe(walks);
  });

  it('explores outward from where it was sent: the ground near its start is seen before the far ends', () => {
    const sim = simWithFog(SPIRAL_W, SPIRAL_H);
    const scout = scoutAt(sim, SPIRAL_W / 2, SPIRAL_H / 2);
    sim.step();
    const centre = { c: SPIRAL_W / 2, r: SPIRAL_H / 2 };
    const ringOf = (c: number, r: number): number => Math.max(Math.abs(c - centre.c), Math.abs(r - centre.r));
    const fog = sim.fog;
    if (fog === undefined) throw new Error('mapless sim');
    const hiddenWithin = (ring: number): number => {
      let hidden = 0;
      for (let r = 0; r < SPIRAL_H; r++) {
        for (let c = 0; c < SPIRAL_W; c++) {
          if (ringOf(c, r) <= ring && fog.stateAt(P0, c, r) === FOG_STATE.UNEXPLORED) hidden++;
        }
      }
      return hidden;
    };
    const edgeSeen = (): boolean =>
      fog.stateAt(P0, 0, centre.r) !== FOG_STATE.UNEXPLORED ||
      fog.stateAt(P0, SPIRAL_W - 1, centre.r) !== FOG_STATE.UNEXPLORED;
    sim.enqueueSetup({ kind: 'explore', entity: scout });
    for (let i = 0; i < WIDE_SWEEP_TICKS && !edgeSeen(); i++) sim.step();
    expect(edgeSeen()).toBe(true);
    expect(hiddenWithin(NEAR_RING)).toBe(0);
  });

  it('sweeps a recon map under fog of war, whose terrain shows from the start', () => {
    const sim = simWithFog(WIDE_W, WIDE_H);
    sim.enqueueSetup({ kind: 'setFogMode', mode: FOG_MODE.RECON_FOG_OF_WAR });
    const scout = scoutAt(sim, 1, 1);
    sim.step();
    expect(unexploredCells(sim)).toBeGreaterThan(0); // raw: no eye has been there, though the view shows it
    const reported = sweepOut(sim, scout, WIDE_SWEEP_TICKS);
    expect(reported).toBe(true);
    expect(deepestUnseen(sim, () => true)).toBeLessThanOrEqual(SCRAP_DEPTH);
  });

  it('re-aims a leg as soon as its goal comes into view', () => {
    const sim = simWithFog(WIDE_W, WIDE_H);
    const scout = scoutAt(sim, 1, 1);
    sim.step();
    sim.enqueueSetup({ kind: 'explore', entity: scout });
    sim.step();
    let revealedGoals = 0;
    for (let i = 0; i < WIDE_SWEEP_TICKS && sim.world.has(scout, ExploreOrder); i++) {
      sim.step();
      const leg = sim.world.tryGet(scout, ExploreOrder)?.leg;
      if (leg == null || !sim.world.has(scout, MoveGoal) || isUnexploredNode(sim, leg.to)) continue;
      // The goal came into view this tick: the next one walks on to fresh ground instead.
      revealedGoals++;
      sim.step();
      if (unexploredCells(sim) === 0) break; // the last leg has nothing left to turn to
      expect(sim.world.get(scout, ExploreOrder).leg?.to).not.toBe(leg.to);
    }
    expect(revealedGoals).toBeGreaterThan(0);
  });

  it('sweeps the ground it can reach and reports, leaving ground across water', () => {
    const [W, H, WATER_COLUMN] = [30, 24, 12];
    const sim = simWithFog(W, H, waterColumnMap(W, H, WATER_COLUMN));
    const scout = scoutAt(sim, 10, 2);
    sim.step();
    const reported = sweepOut(sim, scout);
    expect(sim.world.has(scout, ExploreOrder)).toBe(false);
    expect(reported).toBe(true);

    expect(deepestUnseen(sim, (col) => col < WATER_COLUMN)).toBeLessThanOrEqual(SCRAP_DEPTH);
    expect(unexploredCells(sim)).toBeGreaterThan(0); // the far bank's far side stays unseen
  });

  it('sleeps first when tired, then sets out', () => {
    const sim = simWithFog();
    const scout = scoutAt(sim, 1, 1, SCOUT_JOB, ONE);
    sim.step();
    sim.enqueueSetup({ kind: 'explore', entity: scout });
    let slept = false;
    for (let i = 0; i < REST_TICKS && !slept; i++) {
      sim.step();
      expect(sim.world.has(scout, PlayerOrder)).toBe(false); // no leg goes out before it has slept
      slept = sim.world.tryGet(scout, CurrentAtomic)?.effect.kind === 'sleep';
    }
    expect(slept).toBe(true);
    expect(sim.world.has(scout, ExploreOrder)).toBe(true);

    for (let i = 0; i < REST_TICKS * 4 && !sim.world.has(scout, MoveGoal); i++) sim.step();
    expect(sim.world.has(scout, MoveGoal)).toBe(true); // rested, it goes on with the sweep
    expect(sim.world.has(scout, ExploreOrder)).toBe(true);
  });

  it('refuses a trade that is not a scout, and a walk order calls the sweep off', () => {
    const sim = simWithFog();
    const digger = scoutAt(sim, 1, 1, WOODCUTTER);
    sim.step();
    sim.enqueueSetup({ kind: 'explore', entity: digger });
    sim.step();
    expect(sim.world.has(digger, ExploreOrder)).toBe(false);

    const scout = scoutAt(sim, 1, 1);
    sim.enqueueSetup({ kind: 'explore', entity: scout });
    sim.step();
    expect(sim.world.has(scout, ExploreOrder)).toBe(true);
    sim.enqueueSetup({ kind: 'moveUnit', entity: scout, x: 2, y: 2 });
    sim.step();
    expect(sim.world.has(scout, ExploreOrder)).toBe(false);
  });

  it.each(['orderNeed', 'trainSoldier', 'equipGood'] as const)(
    'an accepted %s order ends the sweep instead of being walked off by its next leg',
    (kind) => {
      const sim = simWithFog();
      const scout = scoutAt(sim, 1, 1);
      const pile = sim.world.create();
      sim.world.add(pile, Position, { x: fx.fromInt(4), y: fx.fromInt(1) });
      sim.world.add(pile, Stockpile, { amounts: new Map([[SHOES, 1]]) });
      const barracks = sim.world.create();
      sim.world.add(barracks, Position, { x: fx.fromInt(5), y: fx.fromInt(4) });
      sim.world.add(barracks, Building, { buildingType: BARRACKS, tribe: VIKING, built: ONE, level: 0 });
      sim.world.add(barracks, Owner, { player: P0 });
      sim.step();
      sim.enqueueSetup({ kind: 'explore', entity: scout });
      sim.run(WALK_INTO_LEG_TICKS); // off its start node, so the next leg is a new one
      expect(sim.world.has(scout, ExploreOrder)).toBe(true);

      if (kind === 'orderNeed') sim.enqueueSetup({ kind, entity: scout, need: 'hunger' });
      else if (kind === 'trainSoldier') sim.enqueueSetup({ kind, entity: scout, house: barracks });
      else sim.enqueueSetup({ kind, entity: scout, group: 'boots', slot: 0, goodType: SHOES });
      sim.step();

      const errandStands =
        kind === 'orderNeed'
          ? sim.world.has(scout, NeedOrder)
          : kind === 'trainSoldier'
            ? sim.world.has(scout, TrainingOrder)
            : sim.world.has(scout, EquipOrder);
      expect(errandStands).toBe(true);
      expect(sim.world.has(scout, ExploreOrder)).toBe(false);
    },
  );

  it('a walk order to the very node of the current leg still ends the sweep', () => {
    const sim = simWithFog();
    const scout = scoutAt(sim, 1, 1);
    sim.step();
    sim.enqueueSetup({ kind: 'explore', entity: scout });
    sim.run(WALK_INTO_LEG_TICKS);
    const leg = sim.world.get(scout, MoveGoal).cell;
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('missing terrain');
    const c = terrain.coordsOf(leg);

    sim.enqueueSetup({ kind: 'moveUnit', entity: scout, x: c.x, y: c.y });
    sim.step();
    expect(sim.world.has(scout, ExploreOrder)).toBe(false);
  });

  it('keeps a walk queued behind the sweep through its legs and walks it once the sweep ends', () => {
    // Walled in, every leg fails and the next goes out as a fresh walk order.
    const sim = simWithFog(WIDE_W, WIDE_H);
    const { scout, at } = walledScout(sim);
    const queuedTo = { x: at.hx + QUEUED_STEP_NODES, y: at.hy };
    sim.step();
    sim.enqueueSetup({ kind: 'explore', entity: scout });
    sim.step();
    sim.enqueueSetup({ kind: 'moveUnit', entity: scout, ...queuedTo, queued: true });
    sim.step();
    expect(sim.world.get(scout, OrderQueue).orders).toHaveLength(1);

    let finished = false;
    for (let i = 0; i < SWEEP_TICKS && !finished; i++) {
      sim.step();
      finished = sim.events.current().some((ev) => ev.kind === 'explorationFinished');
      if (!finished) expect(sim.world.has(scout, OrderQueue)).toBe(true);
    }
    expect(finished).toBe(true);
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('missing terrain');
    // The tick the sweep ends, the queue hands the scout its walk.
    expect(sim.world.get(scout, MoveGoal).cell).toBe(terrain.nodeAt(queuedTo.x, queuedTo.y));
  });

  it('carries a sweep through a save, and the restored sweep walks on exactly as the original', () => {
    const sim = simWithFog();
    const scout = scoutAt(sim, 1, 1);
    sim.step();
    sim.enqueueSetup({ kind: 'explore', entity: scout });
    sim.run(WALK_INTO_LEG_TICKS);
    const order = sim.world.get(scout, ExploreOrder);
    expect(order.leg).not.toBeNull();

    const bytes = serializeSaveGame(exportSaveGame(sim, {}));
    const restored = restoreSimulation(parseSaveGame(JSON.parse(bytes)), {
      content: contentWithBarracks(),
      map: grassMap(SMALL_W, SMALL_H),
    });
    expect(restored.world.get(scout, ExploreOrder)).toEqual(order);
    sim.run(AFTER_RESTORE_TICKS);
    restored.run(AFTER_RESTORE_TICKS);
    expect(serializeSaveGame(exportSaveGame(restored, {}))).toBe(serializeSaveGame(exportSaveGame(sim, {})));
  });

  it('a tired scout the battle alert keeps on its feet walks on instead of standing', () => {
    const sim = simWithFog();
    const scout = scoutAt(sim, 1, 1, SCOUT_JOB, ONE);
    sim.world.mut(scout, Stance).mode = MILITARY_MODE.DEFEND;
    const enemy = scoutAt(sim, ALERT_ENEMY_AT.x, ALERT_ENEMY_AT.y);
    sim.world.mut(enemy, Owner).player = P1;
    sim.world.mut(enemy, Stance).mode = MILITARY_MODE.DEFEND;
    sim.step();
    sim.enqueueSetup({ kind: 'explore', entity: scout });
    let walked = false;
    for (let i = 0; i < ALERT_TICKS && !walked; i++) {
      sim.step();
      walked = sim.world.has(scout, PlayerOrder);
    }
    expect(walked).toBe(true);
    expect(sim.world.tryGet(scout, CurrentAtomic)?.effect.kind).not.toBe('sleep');
  });
});
