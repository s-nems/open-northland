import { describe, expect, it } from 'vitest';
import { Palisade, Position, SiteAssignment, UnderConstruction } from '../../src/components/index.js';
import { adminCommand, type Entity, fx, ONE, type ScriptLandscapeType, Simulation } from '../../src/index.js';
import { buildingBlockedCells, placementBlockerVersion } from '../../src/systems/footprint/index.js';
import { standingWallCells } from '../../src/systems/footprint/wall-joints.js';
import { claimPalisade, releasePalisadeReservation } from '../../src/systems/palisades/reservation.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassNodeMap } from '../fixtures/terrain.js';

const WALL: ScriptLandscapeType = {
  typeId: 691,
  walk: [{ dx: 0, dy: 0 }],
  build: [{ dx: 0, dy: 0 }],
  groups: [],
  wall: {
    logicType: 82,
    maxHitpoints: 100,
    repairPerStrike: 3,
    construction: [{ goodType: 5, amount: 1 }],
  },
};

const OWNER = 0;
const TRIBE = 0;

/** A standing wall at (4,4) and a wall site at (8,8). */
function wallAndSite(): { sim: Simulation; site: Entity } {
  const base = grassNodeMap(16, 16);
  const sim = new Simulation({
    seed: 1,
    content: testContent(),
    map: { ...base, landscapes: { types: [WALL], placements: [] } },
  });
  sim.enqueueSetup({ kind: 'placePalisade', gfxIndex: WALL.typeId, x: 4, y: 4, tribe: TRIBE, owner: OWNER });
  sim.enqueueSetup({
    kind: 'placePalisade',
    gfxIndex: WALL.typeId,
    x: 8,
    y: 8,
    tribe: TRIBE,
    owner: OWNER,
    underConstruction: true,
  });
  sim.step();
  const site = [...sim.world.query(Palisade, UnderConstruction, Position)][0];
  if (site === undefined) throw new Error('expected the wall site');
  return { sim, site };
}

function forceFinish(sim: Simulation, site: Entity): void {
  sim.enqueue(adminCommand({ kind: 'debugCompleteConstruction', target: site }));
  sim.step();
}

describe('wall caches', () => {
  it('keep the walk block and the placement version through a claim, its release and build progress', () => {
    const { sim, site } = wallAndSite();
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('expected a mapped simulation');
    const blocked = buildingBlockedCells(sim.world, ctxOf(sim), terrain);
    const version = placementBlockerVersion(sim.world);

    const builder = sim.world.create();
    sim.world.add(builder, SiteAssignment, { site, pinned: false });
    expect(claimPalisade(sim.world, site, builder)).toBe(true);
    sim.world.mut(site, Palisade).built = fx.div(ONE, fx.fromInt(2));
    releasePalisadeReservation(sim.world, builder);

    expect(buildingBlockedCells(sim.world, ctxOf(sim), terrain)).toBe(blocked);
    expect(placementBlockerVersion(sim.world)).toBe(version);
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('writes nothing when a builder that holds no claim lets go', () => {
    const { sim, site } = wallAndSite();
    const bystander = sim.world.create();
    sim.world.add(bystander, SiteAssignment, { site, pinned: false });
    const generation = sim.world.componentValueGeneration(Palisade);
    releasePalisadeReservation(sim.world, bystander);
    expect(sim.world.componentValueGeneration(Palisade)).toBe(generation);
  });

  it('follow walls that stand, fall and swap gates without a rebuild drifting from the stores', () => {
    const { sim, site } = wallAndSite();
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('expected a mapped simulation');
    const before = [...standingWallCells(sim.world, terrain).walls];
    expect(before).toEqual([terrain.nodeAt(4, 4)]);

    forceFinish(sim, site);
    expect(standingWallCells(sim.world, terrain).walls.has(terrain.nodeAt(8, 8))).toBe(true);
    const [first] = [...sim.world.query(Palisade, Position)].sort((a, b) => a - b);
    if (first === undefined) throw new Error('expected the first wall');
    sim.world.destroy(first);
    expect([...standingWallCells(sim.world, terrain).walls]).toEqual([terrain.nodeAt(8, 8)]);
    expect(sim.world.verifyCaches()).toEqual([]);
  });
});
