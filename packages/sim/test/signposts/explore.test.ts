import { parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  addPerson,
  Building,
  EquipOrder,
  EXPLORE_RADIUS_NODES,
  ExploreOrder,
  FOG_MODE,
  Health,
  MoveGoal,
  NeedOrder,
  Owner,
  Position,
  Stance,
  Stockpile,
  TrainingOrder,
} from '../../src/components/index.js';
import { fx, ONE } from '../../src/core/fixed.js';
import type { Entity } from '../../src/ecs/world.js';
import { cellAnchorNode, Simulation } from '../../src/index.js';
import { MILITARY_MODE } from '../../src/systems/readviews/index.js';
import { FOG_STATE } from '../../src/systems/vision/index.js';
import { testContent } from '../fixtures/content.js';
import { grassCellMap as grassMap, waterColumnMap } from '../fixtures/terrain.js';

/**
 * The scout's "Explore" order: it sweeps the unexplored ground around a chosen centre, one leg at a
 * time, and retires once nothing inside the circle is hidden any more.
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

function simWithFog(w = 24, h = 8, map = grassMap(w, h)): Simulation {
  const base = testContent();
  // A LEARN house that employs haulers is what reads as a barracks.
  const barracks = {
    typeId: BARRACKS,
    id: 'barracks',
    kind: 'training' as const,
    workers: [{ jobType: CARRIER_JOB, count: 1 }],
  };
  const content = parseContentSet({ ...base, buildings: [...base.buildings, barracks] });
  const sim = new Simulation({ seed: 7, content, map });
  sim.enqueueSetup({ kind: 'setFogMode', mode: FOG_MODE.CLASSIC });
  return sim;
}

function scoutAt(sim: Simulation, x: number, y: number, jobType: number = SCOUT_JOB): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  addPerson(sim.world, e, {
    tribe: VIKING,
    jobType,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
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

describe('exploreArea - the scout sweep', () => {
  it('walks the scout at unexplored ground and reveals it', () => {
    const sim = simWithFog();
    const scout = scoutAt(sim, 1, 1);
    sim.step();
    const before = unexploredCells(sim);

    sim.enqueueSetup({ kind: 'exploreArea', entity: scout, x: 30, y: 6 });
    sim.step();
    expect(sim.world.has(scout, ExploreOrder)).toBe(true);
    expect(sim.world.has(scout, MoveGoal)).toBe(true);

    for (let i = 0; i < 400 && sim.world.has(scout, ExploreOrder); i++) sim.step();
    expect(unexploredCells(sim)).toBeLessThan(before);
  });

  it('retires the order once the circle holds nothing unseen', () => {
    const sim = simWithFog(16, 4);
    const scout = scoutAt(sim, 1, 1);
    sim.step(); // the first tick is what switches the fog on, and an unlit map hides nothing
    expect(unexploredCells(sim)).toBeGreaterThan(0);

    // The circle around the map's middle covers the whole strip.
    sim.enqueueSetup({ kind: 'exploreArea', entity: scout, x: 16, y: 4 });
    sim.step();
    expect(sim.world.has(scout, ExploreOrder)).toBe(true);
    for (let i = 0; i < SWEEP_TICKS && sim.world.has(scout, ExploreOrder); i++) sim.step();

    expect(sim.world.has(scout, ExploreOrder)).toBe(false);
    expect(unexploredCells(sim)).toBe(0);
  });

  it('sweeps the ground it can reach before giving up on ground across water', () => {
    const [W, H, WATER_COLUMN] = [30, 24, 12];
    const sim = simWithFog(W, H, waterColumnMap(W, H, WATER_COLUMN));
    const scout = scoutAt(sim, 10, 2);
    sim.step();
    const centre = { hx: 20, hy: 24 };
    sim.enqueueSetup({ kind: 'exploreArea', entity: scout, x: centre.hx, y: centre.hy });
    sim.step();
    for (let i = 0; i < SWEEP_TICKS && sim.world.has(scout, ExploreOrder); i++) sim.step();
    expect(sim.world.has(scout, ExploreOrder)).toBe(false);

    const fog = sim.fog;
    if (fog === undefined) throw new Error('mapless sim');
    const hiddenOnOwnBank: string[] = [];
    for (let row = 0; row < H; row++) {
      for (let col = 0; col < WATER_COLUMN; col++) {
        const node = cellAnchorNode(col, row);
        const inCircle = (node.hx - centre.hx) ** 2 + (node.hy - centre.hy) ** 2 <= EXPLORE_RADIUS_NODES ** 2;
        if (inCircle && fog.stateAt(P0, col, row) === FOG_STATE.UNEXPLORED)
          hiddenOnOwnBank.push(`${col},${row}`);
      }
    }
    expect(hiddenOnOwnBank).toEqual([]);
  });

  it('refuses a trade that is not a scout, and a walk order calls the sweep off', () => {
    const sim = simWithFog();
    const digger = scoutAt(sim, 1, 1, WOODCUTTER);
    sim.step();
    sim.enqueueSetup({ kind: 'exploreArea', entity: digger, x: 20, y: 6 });
    sim.step();
    expect(sim.world.has(digger, ExploreOrder)).toBe(false);

    const scout = scoutAt(sim, 1, 1);
    sim.enqueueSetup({ kind: 'exploreArea', entity: scout, x: 20, y: 6 });
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
      sim.enqueueSetup({ kind: 'exploreArea', entity: scout, x: 30, y: 6 });
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
    sim.enqueueSetup({ kind: 'exploreArea', entity: scout, x: 30, y: 6 });
    sim.run(WALK_INTO_LEG_TICKS);
    const leg = sim.world.get(scout, MoveGoal).cell;
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('missing terrain');
    const c = terrain.coordsOf(leg);

    sim.enqueueSetup({ kind: 'moveUnit', entity: scout, x: c.x, y: c.y });
    sim.step();
    expect(sim.world.has(scout, ExploreOrder)).toBe(false);
  });
});
