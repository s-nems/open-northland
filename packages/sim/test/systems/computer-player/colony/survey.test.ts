import { describe, expect, it } from 'vitest';
import { FOG_MODE, type MapBriefView, mapBriefOf } from '../../../../src/components/index.js';
import { halfCellMapFromCells, Simulation } from '../../../../src/index.js';
import { hexDistance } from '../../../../src/nav/halfcell.js';
import {
  COLONY_RANGE_NODES,
  colonySiteCandidates,
  colonySiteClear,
  type SiteTally,
  siteOffers,
  siteScore,
  surveyColonySite,
} from '../../../../src/systems/computer-player/colony/survey.js';
import { aiContent } from '../../../fixtures/ai-content.js';
import { ctxOf } from '../../../fixtures/context.js';
import {
  makeAiSeat,
  placeHq,
  SEAT,
  STOCK_TYPE,
  STONE,
  STONE_HARVEST,
  VIKING,
  WOOD,
  WOOD_HARVEST,
} from '../support.js';

const FOE = 3;
const FOE_START = 8 * 32;
const HOME_LAND = 1;
const NEAR_LAND = 2;
const LAKE_LAND = 3;
const SEA = 10;
const LAKE = 11;
const ZONE_NODES = 32;
const ZONES_WIDE = 8;
const ZONES_HIGH = 3;
/** The middle row: a site's block reaches a row each way. */
const ROW = 1;
const AMPLE = { free: 200, wood: 200, stone: 100 };

interface ZoneFill {
  readonly column: number;
  readonly land: number;
  readonly free?: number;
  readonly wood?: number;
  readonly stone?: number;
  readonly fish?: number;
}

/** A brief with one start at the west end and the given zones filled on the middle row. */
function briefOf(zones: readonly ZoneFill[]): MapBriefView {
  const count = ZONES_WIDE * ZONES_HIGH;
  const goods = ['wood', 'stone'];
  const dominantLand = new Array<number>(count).fill(-1);
  const free = new Array<number>(count).fill(0);
  const fish = new Array<number>(count).fill(0);
  const deposits = new Array<number>(count * goods.length).fill(0);
  for (const zone of zones) {
    const at = ROW * ZONES_WIDE + zone.column;
    dominantLand[at] = zone.land;
    free[at] = zone.free ?? AMPLE.free;
    fish[at] = zone.fish ?? 0;
    deposits[at * goods.length] = zone.wood ?? AMPLE.wood;
    deposits[at * goods.length + 1] = zone.stone ?? AMPLE.stone;
  }
  return {
    scanned: true,
    width: ZONES_WIDE * ZONE_NODES,
    height: ZONES_HIGH * ZONE_NODES,
    zoneNodes: ZONE_NODES,
    zonesWide: ZONES_WIDE,
    zonesHigh: ZONES_HIGH,
    land: [],
    water: [],
    free,
    clearable: [],
    blocked: [],
    plantable: [],
    dominantLand,
    goods,
    deposits,
    fish,
    landComponents: [
      { component: HOME_LAND, nodes: 2000, waters: [SEA] },
      { component: NEAR_LAND, nodes: 2000, waters: [SEA] },
      { component: LAKE_LAND, nodes: 2000, waters: [LAKE] },
    ],
    seats: [{ player: SEAT, hx: 0, hy: 48, component: HOME_LAND, buildings: [] }],
    livestock: [],
    entityCeiling: 0,
  };
}

/** Two zones side by side, so a block holds twice {@link AMPLE}. */
const pair = (column: number, land: number, extra: Partial<ZoneFill> = {}): ZoneFill[] => [
  { column, land, ...extra },
  { column: column + 1, land, ...extra },
];

const TALLY: SiteTally = { room: 900, goods: 2, grass: 0, fish: 0, coast: true, distance: 120 };

describe('a site score', () => {
  it('takes open ground, varied goods and grass over a short voyage', () => {
    const near = siteScore({ ...TALLY, distance: 60 });
    expect(siteScore({ ...TALLY, room: 1800, distance: 300 })).toBeGreaterThan(near);
    expect(siteScore({ ...TALLY, goods: 3, distance: 300 })).toBeGreaterThan(near);
    expect(siteScore({ ...TALLY, grass: 200, distance: 300 })).toBeGreaterThan(near);
  });

  it('wants a shore and its fish, and lets distance only break what is left', () => {
    expect(siteScore(TALLY)).toBeGreaterThan(siteScore({ ...TALLY, coast: false }));
    expect(siteScore({ ...TALLY, fish: 200 })).toBeGreaterThan(siteScore(TALLY));
    expect(siteScore({ ...TALLY, distance: 60 })).toBeGreaterThan(siteScore(TALLY));
  });

  it('gains nothing past a full part', () => {
    expect(siteScore({ ...TALLY, room: 9000 })).toBe(siteScore({ ...TALLY, room: 2000 }));
    expect(siteScore({ ...TALLY, grass: 9000 })).toBe(siteScore({ ...TALLY, grass: 400 }));
  });
});

describe('the static colony candidates', () => {
  it('keeps blocks over the thresholds on a land sharing water with home', () => {
    const brief = briefOf([
      ...pair(0, HOME_LAND),
      ...pair(2, LAKE_LAND),
      ...pair(4, NEAR_LAND, { wood: 100 }),
      ...pair(6, NEAR_LAND),
    ]);
    const lands = colonySiteCandidates(brief, SEAT).map((site) => site.land);
    expect(lands.length).toBeGreaterThan(0);
    expect(new Set(lands)).toEqual(new Set([NEAR_LAND]));
    // A block reaches a zone each way, so the thin pair's columns count only from the rich pair's edge.
    expect(colonySiteCandidates(brief, SEAT).every((site) => site.centre.hx >= 5 * ZONE_NODES)).toBe(true);
  });

  it("offers a land good only where its block holds a gatherer's worth", () => {
    const brief = briefOf(pair(2, NEAR_LAND));
    const [site] = colonySiteCandidates(brief, SEAT);
    if (site === undefined) throw new Error('setup: no site');
    expect(siteOffers(brief, site, 'wood')).toBe(true);
    expect(siteOffers(brief, site, 'iron')).toBe(false);
  });

  it('gives a deposit no weight past its need, then the nearer block and the lowest zone lead', () => {
    const rich = { wood: 5000, stone: 5000 };
    const brief = briefOf([...pair(2, NEAR_LAND, rich), ...pair(5, NEAR_LAND, rich)]);
    const [best, next] = colonySiteCandidates(brief, SEAT);
    // Both blocks pass both caps, so the nearer one, and its lowest zone on the tie, leads.
    expect(best?.zone).toBe(ROW * ZONES_WIDE + 2);
    expect(next?.score).toBeLessThanOrEqual(best?.score ?? 0);
  });

  it("keeps a later seat off an earlier seat's pick, however good the block", () => {
    const brief = briefOf([...pair(2, NEAR_LAND, { free: 900 }), ...pair(6, NEAR_LAND)]);
    const twin = { player: SEAT + 1, hx: 0, hy: 48, component: HOME_LAND, buildings: [] };
    const both = { ...brief, seats: [...brief.seats, twin] };
    const [first] = colonySiteCandidates(both, SEAT);
    const [second] = colonySiteCandidates(both, SEAT + 1);
    if (first === undefined || second === undefined) throw new Error('expected sites');
    expect(hexDistance(first.centre, second.centre)).toBeGreaterThan(COLONY_RANGE_NODES);
  });

  it('looks last at a block another start lies nearer, whatever its score', () => {
    const open = { free: 900 };
    const brief = briefOf([...pair(2, NEAR_LAND), ...pair(6, NEAR_LAND, open)]);
    const shared = {
      ...brief,
      seats: [...brief.seats, { player: FOE, hx: FOE_START, hy: 48, component: HOME_LAND, buildings: [] }],
    };
    const sites = colonySiteCandidates(shared, SEAT);
    expect(sites[0]?.centre.hx).toBeLessThan(FOE_START / 2);
    expect(sites.at(-1)?.contested).toBe(true);
    expect(sites.at(-1)?.score).toBeGreaterThan(sites[0]?.score ?? 0);
  });
});

/** Cells: the west island, the strait, the east island. */
const MAP_CELLS = { width: 70, height: 60 };
const STRAIT_FROM = 22;
const STRAIT_TO = 42;
const SEAT_HQ = { x: 16, y: 20 };
const EAST_MIDDLE = { x: 110, y: 60 };
const DEPOSIT = 400;

function islandMap() {
  const GRASS = 0;
  const WATER = 1;
  const { width, height } = MAP_CELLS;
  const typeIds = new Array<number>(width * height).fill(GRASS);
  for (let row = 0; row < height; row++)
    for (let col = STRAIT_FROM; col < STRAIT_TO; col++) typeIds[row * width + col] = WATER;
  return halfCellMapFromCells({ width, height, typeIds });
}

/** The seat on the west island with a stocked east island to settle, the fog off. */
function islandWorld(): Simulation {
  const sim = new Simulation({ seed: 1, content: aiContent(), map: islandMap() });
  sim.enqueueSetup({ kind: 'setFogMode', mode: FOG_MODE.OFF });
  makeAiSeat(sim, SEAT);
  placeHq(sim, SEAT_HQ.x, SEAT_HQ.y);
  const deposits = [
    { good: WOOD, harvestAtomic: WOOD_HARVEST, x: EAST_MIDDLE.x - 4 },
    { good: STONE, harvestAtomic: STONE_HARVEST, x: EAST_MIDDLE.x + 4 },
  ];
  for (const deposit of deposits)
    sim.enqueueSetup({ kind: 'placeResource', ...deposit, y: EAST_MIDDLE.y, remaining: DEPOSIT });
  sim.enqueueSetup({ kind: 'setPlayerPlacementTribes', player: FOE, tribes: [VIKING] });
  sim.step();
  if (mapBriefOf(sim.world) === null) throw new Error('setup: the map brief is not taken');
  return sim;
}

function foeStoreAtEastMiddle(sim: Simulation): void {
  sim.enqueueSetup({
    kind: 'placeBuilding',
    buildingType: STOCK_TYPE,
    ...EAST_MIDDLE,
    tribe: VIKING,
    owner: FOE,
    force: true,
  });
  sim.step();
}

describe('the live colony survey', () => {
  it('finds a block on the free island and skips a rejected one', () => {
    const sim = islandWorld();
    const ctx = ctxOf(sim);
    const site = surveyColonySite(sim.world, ctx, SEAT, []);
    if (site === null) throw new Error('no site on the free island');
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('setup: no terrain');
    expect(site.land).toBe(terrain.componentOf(terrain.nodeAt(EAST_MIDDLE.x, EAST_MIDDLE.y)));
    expect(surveyColonySite(sim.world, ctx, SEAT, [site.zone])?.zone).not.toBe(site.zone);
  });

  it('rejects a site in range of a building it believes, unless its owner is a friend', () => {
    const sim = islandWorld();
    const ctx = ctxOf(sim);
    const site = surveyColonySite(sim.world, ctx, SEAT, []);
    if (site === null) throw new Error('no site on the free island');
    foeStoreAtEastMiddle(sim);
    expect(colonySiteClear(sim.world, ctx, SEAT, site.centre)).toBe(false);
    expect(surveyColonySite(sim.world, ctx, SEAT, [])).toBeNull();
    sim.enqueueSetup({ kind: 'setDiplomacy', from: SEAT, to: FOE, state: 'friend' });
    sim.step();
    expect(colonySiteClear(sim.world, ctx, SEAT, site.centre)).toBe(true);
  });
});
