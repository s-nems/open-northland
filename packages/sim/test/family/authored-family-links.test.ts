import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { Building, Marriage, Position, Residence, Settler, Wedding } from '../../src/components/index.js';
import type { Command } from '../../src/core/commands/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { Simulation } from '../../src/index.js';
import { nodeOfPosition } from '../../src/nav/halfcell.js';
import { TEST_MANIFEST } from '../fixtures/content.js';
import { grassNodeMap } from '../fixtures/terrain.js';

/**
 * A decoded map's `marry` and `childOfWoman` lines, applied after the placements: each names two humans by
 * the half-cells their `sethuman` placed them on.
 */

const VIKING = 1;
const BABY_FEMALE = 1;
const WOMAN = 5;
const SMITH = 6;
const HOME = 2;
const SMITHY = 3;
const MAP_NODES = 40;
const ROW = 10;

/** A home whose anchor and east neighbour are walls, so a settler placed on the anchor is pushed off. */
const HOME_FOOTPRINT = {
  blocked: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
  ],
  door: { dx: -1, dy: 0 },
};

function familyContent(): ContentSet {
  return parseContentSet({
    manifest: TEST_MANIFEST,
    goods: [{ typeId: 0, id: 'none' }],
    jobs: [
      { typeId: 0, id: 'idle' },
      { typeId: BABY_FEMALE, id: 'baby_female' },
      { typeId: WOMAN, id: 'woman' },
      { typeId: SMITH, id: 'smith' },
    ],
    buildings: [
      { typeId: HOME, id: 'home', kind: 'home', homeSize: 1, footprint: HOME_FOOTPRINT },
      { typeId: SMITHY, id: 'smithy', kind: 'workplace', workers: [{ jobType: SMITH, count: 1 }] },
    ],
    landscape: [{ typeId: 0, id: 'grass', walkable: true, buildable: true }],
  });
}

type Setup = Extract<
  Command,
  { kind: 'placeBuilding' | 'spawnSettler' | 'marryPlaced' | 'parentPlacedChild' }
>;

const node = (x: number) => ({ x, y: ROW });

const building = (buildingType: number, x: number): Setup => ({
  kind: 'placeBuilding',
  buildingType,
  ...node(x),
  tribe: VIKING,
  owner: 0,
  force: true,
});

const human = (jobType: number, x: number, extra: { home?: number; workplace?: number } = {}): Setup => ({
  kind: 'spawnSettler',
  jobType,
  ...node(x),
  tribe: VIKING,
  owner: 0,
  ...(extra.home !== undefined ? { home: node(extra.home) } : {}),
  ...(extra.workplace !== undefined ? { workplace: node(extra.workplace) } : {}),
});

const marry = (woman: number, man: number): Setup => ({
  kind: 'marryPlaced',
  woman: node(woman),
  man: node(man),
});

function world(...setup: Setup[]): Simulation {
  const sim = new Simulation({ seed: 1, content: familyContent(), map: grassNodeMap(MAP_NODES, MAP_NODES) });
  for (const command of setup) sim.enqueueSetup(command);
  sim.step();
  return sim;
}

/** The settler `spawnSettler` placed on column `x`, by job; throws when absent so a dropped spawn fails. */
function placed(sim: Simulation, jobType: number, nth = 0): Entity {
  const found = [...sim.world.query(Settler)].filter((e) => sim.world.get(e, Settler).jobType === jobType);
  const e = found[nth];
  if (e === undefined) throw new Error(`no settler of job ${jobType}`);
  return e;
}

/** The building anchored on column `x`. */
function buildingAt(sim: Simulation, x: number): Entity {
  for (const b of sim.world.query(Building)) {
    const p = sim.world.get(b, Position);
    if (nodeOfPosition(p.x, p.y).hx === x) return b;
  }
  throw new Error(`no building at ${x}`);
}

const homeOf = (sim: Simulation, e: Entity): Entity | undefined => sim.world.tryGet(e, Residence)?.home;

describe('authored family links', () => {
  it('weds the placed woman and man at once and moves a homeless husband into her home', () => {
    const sim = world(building(HOME, 4), human(WOMAN, 10, { home: 4 }), human(SMITH, 20), marry(10, 20));
    const wife = placed(sim, WOMAN);
    const husband = placed(sim, SMITH);
    expect(sim.world.get(wife, Marriage)).toEqual({ spouse: husband, child: null });
    expect(sim.world.get(husband, Marriage)).toEqual({ spouse: wife, child: null });
    expect(sim.world.has(wife, Wedding)).toBe(false);
    expect(homeOf(sim, husband)).toBe(buildingAt(sim, 4));
  });

  it('reads the woman from the first position only', () => {
    const sim = world(human(WOMAN, 10), human(SMITH, 20), marry(20, 10));
    expect(sim.world.has(placed(sim, WOMAN), Marriage)).toBe(false);
    expect(sim.world.has(placed(sim, SMITH), Marriage)).toBe(false);
  });

  it('marries each woman once, so a repeated line changes nothing', () => {
    const sim = world(human(WOMAN, 10), human(SMITH, 20), human(SMITH, 22), marry(10, 20), marry(10, 22));
    expect(sim.world.get(placed(sim, WOMAN), Marriage).spouse).toBe(placed(sim, SMITH, 0));
    expect(sim.world.has(placed(sim, SMITH, 1), Marriage)).toBe(false);
  });

  it('finds a woman placed on a house wall where her spawn pushed her', () => {
    const sim = world(building(HOME, 4), human(WOMAN, 4), human(SMITH, 20), marry(4, 20));
    const wife = placed(sim, WOMAN);
    const p = sim.world.get(wife, Position);
    expect(nodeOfPosition(p.x, p.y)).not.toEqual({ hx: 4, hy: ROW });
    expect(sim.world.get(wife, Marriage).spouse).toBe(placed(sim, SMITH));
  });

  it('keeps the home nearer the husband’s workplace, his own on a tie', () => {
    // Her home is far from the smithy, his beside it: she moves to him.
    const apart = world(
      building(HOME, 4),
      building(HOME, 30),
      building(SMITHY, 34),
      human(WOMAN, 10, { home: 4 }),
      human(SMITH, 20, { home: 30, workplace: 34 }),
      marry(10, 20),
    );
    expect(homeOf(apart, placed(apart, WOMAN))).toBe(buildingAt(apart, 30));
    expect(homeOf(apart, placed(apart, SMITH))).toBe(buildingAt(apart, 30));
    // Hers is the nearer one: he moves to her.
    const near = world(
      building(HOME, 4),
      building(HOME, 30),
      building(SMITHY, 8),
      human(WOMAN, 10, { home: 4 }),
      human(SMITH, 20, { home: 30, workplace: 8 }),
      marry(10, 20),
    );
    expect(homeOf(near, placed(near, SMITH))).toBe(buildingAt(near, 4));
    expect(homeOf(near, placed(near, WOMAN))).toBe(buildingAt(near, 4));
  });

  it('leaves a homeless wife where she is and her husband in his own home', () => {
    const sim = world(building(HOME, 30), human(WOMAN, 10), human(SMITH, 20, { home: 30 }), marry(10, 20));
    expect(homeOf(sim, placed(sim, WOMAN))).toBeUndefined();
    expect(homeOf(sim, placed(sim, SMITH))).toBe(buildingAt(sim, 30));
  });

  it('gives a placed baby to the married woman and her husband, in their home', () => {
    const sim = world(
      building(HOME, 4),
      human(WOMAN, 10, { home: 4 }),
      human(SMITH, 20),
      human(BABY_FEMALE, 12),
      marry(10, 20),
      { kind: 'parentPlacedChild', child: node(12), woman: node(10) },
    );
    const baby = placed(sim, BABY_FEMALE);
    expect(sim.world.get(placed(sim, WOMAN), Marriage).child).toBe(baby);
    expect(sim.world.get(placed(sim, SMITH), Marriage).child).toBe(baby);
    expect(homeOf(sim, baby)).toBe(buildingAt(sim, 4));
  });
});
