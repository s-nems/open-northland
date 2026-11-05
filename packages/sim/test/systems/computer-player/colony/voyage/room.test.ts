import { parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import type { Simulation } from '../../../../../src/index.js';
import { homesFitNear } from '../../../../../src/systems/computer-player/colony/voyage/room.js';
import { colonyContent, colonyWorld } from '../../../../fixtures/colony-islands.js';
import { ctxOf } from '../../../../fixtures/context.js';
import { SEAT, STOCK_TOP_TYPE, VIKING } from '../../support.js';

/** The east island's west shore, and a spot on the west island. */
const EAST_SHORE = { hx: 142, hy: 60 };
const WEST_LAND = { hx: 20, hy: 60 };
const REACH_NODES = 24;
const NO_CAP = 1000;
const SMALL_CAP = 2;
const HOME_TYPE = 2;
/** A 3x3 body on the even lattice, as the fixture's headquarters has, and its reserved zone a ring wider. */
const square = (offsets: readonly number[]) => offsets.flatMap((dy) => offsets.map((dx) => ({ dx, dy })));
const HOME_BODY = square([-2, 0, 2]);
const HOME_RESERVED = square([-4, -2, 0, 2, 4]);

function roomWorld(): Simulation {
  const base = colonyContent();
  const content = parseContentSet({
    ...base,
    buildings: base.buildings.map((b) =>
      b.typeId === HOME_TYPE
        ? { ...b, footprint: { blocked: HOME_BODY, reserved: HOME_RESERVED, door: { dx: 0, dy: 4 } } }
        : b,
    ),
  });
  return colonyWorld(undefined, content);
}

function homesAt(sim: Simulation, at: { hx: number; hy: number }, cap = NO_CAP): number {
  const ctx = ctxOf(sim);
  const terrain = ctx.terrain;
  if (terrain === undefined) throw new Error('setup: no terrain');
  const land = terrain.componentOf(terrain.nodeAt(EAST_SHORE.hx, EAST_SHORE.hy));
  return homesFitNear(sim.world, ctx, terrain, VIKING, land, at, REACH_NODES, cap);
}

describe('the homes that fit near a spot', () => {
  it('packs several on open land, stops at the cap, and counts none off the land', () => {
    const sim = roomWorld();
    expect(homesAt(sim, EAST_SHORE)).toBeGreaterThan(SMALL_CAP);
    expect(homesAt(sim, EAST_SHORE, SMALL_CAP)).toBe(SMALL_CAP);
    expect(homesAt(sim, WEST_LAND)).toBe(0);
  });

  it('counts fewer where a building already takes the ground', () => {
    const sim = roomWorld();
    const open = homesAt(sim, EAST_SHORE);
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: STOCK_TOP_TYPE,
      x: EAST_SHORE.hx + REACH_NODES / 2,
      y: EAST_SHORE.hy,
      tribe: VIKING,
      owner: SEAT,
      force: true,
      underConstruction: false,
    });
    sim.step();
    expect(homesAt(sim, EAST_SHORE)).toBeLessThan(open);
  });
});
