import { terrainWorldBounds, tileToScreen } from '@open-northland/render';
import { type DiplomacyState, FOG_MODE, FOG_STATE, type FogView, fx } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { PLAYER_SWATCH_COLORS } from '../src/catalog/roster.js';
import {
  ANIMAL_DOT_COLOUR,
  forEachMinimapDot,
  type MinimapDotContext,
  ROAD_SITE_DOT_COLOUR,
} from '../src/hud/minimap/dots.js';
import {
  DEFAULT_MINIMAP_FILTERS,
  type MinimapFilters,
  type MinimapLayer,
  withAllMinimapLayers,
} from '../src/hud/minimap/filters.js';
import type { MinimapMark } from '../src/hud/minimap/stamps.js';
import { countingSnapshot, type Ent, snapshotOf } from './support/snapshot.js';

/** Every layer on, so a plot test sees each kind; the shipped default hides the clutter layers. */
const ALL_LAYERS = withAllMinimapLayers(DEFAULT_MINIMAP_FILTERS, true);

const MAP_CELLS = 8;
const BOUNDS = terrainWorldBounds(MAP_CELLS, MAP_CELLS);
const SCALE = 0.5;
const SOLDIER_JOB = 31;
const CIVILIAN_JOB = 7;
const VIEWER = 0;
const FRIEND = 1;
const FOE = 2;
const STANCES: Readonly<Record<number, DiplomacyState>> = { [FRIEND]: 'friend', [FOE]: 'enemy' };

interface Dot {
  bx: number;
  by: number;
  mark: MinimapMark;
  colour: number;
}

function dotsOf(entities: readonly Ent[], overrides: Partial<MinimapDotContext> = {}): Dot[] {
  const out: Dot[] = [];
  forEachMinimapDot(snapshotOf(entities), contextWith(overrides), (bx, by, mark, colour) =>
    out.push({ bx, by, mark, colour }),
  );
  return out;
}

function contextWith(overrides: Partial<MinimapDotContext>): MinimapDotContext {
  return {
    fog: null,
    bounds: BOUNDS,
    scale: SCALE,
    filters: ALL_LAYERS,
    isFighterJob: (jobType) => jobType === SOLDIER_JOB,
    viewer: VIEWER,
    stanceToward: (owner) => STANCES[owner] ?? 'neutral',
    ...overrides,
  };
}

function only(layer: MinimapLayer, scope: MinimapFilters['scope'] = 'everyone'): MinimapFilters {
  const none = withAllMinimapLayers(DEFAULT_MINIMAP_FILTERS, false);
  return { scope, layers: { ...none.layers, [layer]: true } };
}

/** Where the raster stamps a thing standing on tile `(x, y)` - the projection the dots must reproduce. */
function pxAt(x: number, y: number): { bx: number; by: number } {
  const s = tileToScreen(x, y);
  return { bx: (s.x - BOUNDS.minX) * SCALE, by: (s.y - BOUNDS.minY) * SCALE };
}

const at = (x: number, y: number) => ({ Position: { x: fx.fromInt(x), y: fx.fromInt(y) } });

function person(id: number, player: number, x: number, y: number, jobType = CIVILIAN_JOB): Ent {
  return {
    id,
    components: { Settler: { jobType }, Person: { person: true }, Owner: { player }, ...at(x, y) },
  };
}

function building(id: number, player: number, x: number, y: number): Ent {
  return { id, components: { Building: {}, Owner: { player }, ...at(x, y) } };
}

function animal(id: number, x: number, y: number, player?: number): Ent {
  return {
    id,
    components: {
      Settler: { jobType: 0 },
      ...(player === undefined ? {} : { Owner: { player }, Livestock: {} }),
      ...at(x, y),
    },
  };
}

function vehicle(id: number, player: number, x: number, y: number, carrier: number | null = null): Ent {
  return { id, components: { Vehicle: { carrier }, Owner: { player }, ...at(x, y) } };
}

function roadSite(id: number, player: number, x: number, y: number): Ent {
  return { id, components: { RoadSite: {}, Owner: { player }, ...at(x, y) } };
}

const colour = (player: number): number => PLAYER_SWATCH_COLORS[player] ?? 0;

/** A FogView whose state is decided per cell (missing cells read as EXPLORED). */
function fogWhere(state: (cellX: number, cellY: number) => number): FogView {
  return {
    player: VIEWER,
    mode: FOG_MODE.RECON_FOG_OF_WAR,
    cellsWide: MAP_CELLS,
    cellsHigh: MAP_CELLS,
    generation: 1,
    stateAt: state,
  };
}

describe('forEachMinimapDot', () => {
  it('marks each kind with its own shape in its owner colour, animals in the fauna tint', () => {
    const dots = dotsOf([
      person(1, 0, 2, 3),
      person(2, 1, 3, 3, SOLDIER_JOB),
      building(3, 1, 4, 5),
      vehicle(4, 0, 5, 5),
      animal(5, 6, 6),
    ]);
    expect(dots).toEqual([
      { ...pxAt(4, 5), mark: 'building', colour: colour(1) },
      { ...pxAt(2, 3), mark: 'civilian', colour: colour(0) },
      { ...pxAt(3, 3), mark: 'soldier', colour: colour(1) },
      { ...pxAt(6, 6), mark: 'animal', colour: ANIMAL_DOT_COLOUR },
      { ...pxAt(5, 5), mark: 'vehicle', colour: colour(0) },
    ]);
  });

  it('stacks the layers bottom to top: road sites, signposts, buildings, people, vehicles', () => {
    const marks = dotsOf([
      vehicle(1, 0, 1, 1),
      person(2, 0, 1, 1),
      building(3, 0, 1, 1),
      { id: 4, components: { Signpost: {}, Owner: { player: 0 }, ...at(1, 1) } },
      roadSite(5, 0, 1, 1),
    ]).map((dot) => dot.mark);
    expect(marks).toEqual(['roadSite', 'signpost', 'building', 'civilian', 'vehicle']);
  });

  it('skips unowned people and buildings, positionless entities and vehicles a ship carries', () => {
    const dots = dotsOf([
      { id: 1, components: { Building: {}, ...at(1, 1) } },
      { id: 2, components: { Settler: {}, Person: { person: true }, ...at(1, 1) } },
      { id: 3, components: { Settler: {}, Person: { person: true }, Owner: { player: 0 } } },
      vehicle(4, 0, 2, 2, 9),
      person(5, 0, 6, 6),
    ]);
    expect(dots).toEqual([{ ...pxAt(6, 6), mark: 'civilian', colour: colour(0) }]);
  });

  it('plots road sites like owned entities, on visible ground under the scope, and no laid road', () => {
    const roads: Ent[] = [
      { id: 1, components: { RoadShard: { block: 0, nodes: [4], revision: 1 } } },
      roadSite(2, 0, 2, 6),
      roadSite(3, FOE, 6, 6),
    ];
    const fog = fogWhere((cellX) => (cellX < 4 ? FOG_STATE.VISIBLE : FOG_STATE.EXPLORED));
    const site = { ...pxAt(2, 6), mark: 'roadSite', colour: ROAD_SITE_DOT_COLOUR };
    expect(dotsOf(roads, { fog, filters: only('roads') })).toEqual([site]);
    expect(dotsOf(roads, { filters: only('roads', 'mine') })).toEqual([site]);
  });

  it("plots signposts and a gatherer's work flag in the gatherer's colour", () => {
    const dots = dotsOf(
      [
        { id: 1, components: { Signpost: {}, Owner: { player: 1 }, ...at(2, 2) } },
        { id: 2, components: { DeliveryFlag: {}, ...at(5, 5) } },
        { id: 3, components: { ...person(3, 0, 1, 1).components, WorkFlag: { flag: 2, radius: 24 } } },
      ],
      { filters: only('signposts') },
    );
    expect(dots).toEqual([
      { ...pxAt(2, 2), mark: 'signpost', colour: colour(1) },
      { ...pxAt(5, 5), mark: 'signpost', colour: colour(0) },
    ]);
  });

  it('hides each layer on its own switch', () => {
    const world = [
      person(1, 0, 1, 1),
      person(2, 0, 2, 2, SOLDIER_JOB),
      building(3, 0, 3, 3),
      vehicle(4, 0, 4, 4),
      animal(5, 5, 5),
      roadSite(6, 0, 5, 6),
      { id: 7, components: { Signpost: {}, Owner: { player: 0 }, ...at(6, 6) } },
    ];
    const markOf: Readonly<Record<MinimapLayer, MinimapMark>> = {
      civilians: 'civilian',
      soldiers: 'soldier',
      buildings: 'building',
      vehicles: 'vehicle',
      animals: 'animal',
      roads: 'roadSite',
      signposts: 'signpost',
    };
    for (const [layer, mark] of Object.entries(markOf) as [MinimapLayer, MinimapMark][]) {
      const without = {
        ...ALL_LAYERS,
        layers: { ...ALL_LAYERS.layers, [layer]: false },
      };
      const marks = dotsOf(world, { filters: without }).map((dot) => dot.mark);
      expect(marks).not.toContain(mark);
      expect(marks).toHaveLength(Object.keys(markOf).length - 1);
      expect(dotsOf(world, { filters: only(layer) }).map((dot) => dot.mark)).toEqual([mark]);
    }
    expect(dotsOf(world, { filters: withAllMinimapLayers(DEFAULT_MINIMAP_FILTERS, false) })).toEqual([]);
  });

  it('drops entities on merely explored ground and keeps the visible ones, whatever the filters', () => {
    const world = [person(1, 0, 2, 2), person(2, 1, 6, 6), building(3, 0, 2, 3), building(4, 1, 6, 5)];
    const fog = fogWhere((cellX) => (cellX < 4 ? FOG_STATE.VISIBLE : FOG_STATE.EXPLORED));
    expect(dotsOf(world, { fog })).toEqual([
      { ...pxAt(2, 3), mark: 'building', colour: colour(0) },
      { ...pxAt(2, 2), mark: 'civilian', colour: colour(0) },
    ]);
    expect(dotsOf(world, { fog, filters: only('buildings') })).toHaveLength(1);
    expect(dotsOf(world)).toHaveLength(4); // no fog view: everything shows
  });

  it('remaps the swatch through playerColourOf and wraps the raw player index modulo the table', () => {
    expect(dotsOf([person(1, 5, 0, 0)], { playerColourOf: () => 1 })[0]?.colour).toBe(colour(1));
    expect(dotsOf([person(1, PLAYER_SWATCH_COLORS.length, 0, 0)])[0]?.colour).toBe(colour(0));
  });

  it('walks only its layer indexes on a replot, never the entity lane again', () => {
    const scenery: Ent[] = Array.from({ length: 500 }, (_, i) => ({
      id: 100 + i,
      components: { Tree: {}, ...at(1, 1) },
    }));
    const counted = countingSnapshot(snapshotOf([...scenery, person(1, 0, 2, 2), building(2, 0, 3, 3)]));
    const plot = (): number => {
      let dots = 0;
      forEachMinimapDot(counted.snapshot, contextWith({}), () => dots++);
      return dots;
    };
    expect(plot()).toBe(2);
    const scansAfterFirst = counted.scans();
    expect(plot()).toBe(2);
    expect(counted.scans()).toBe(scansAfterFirst);
  });

  it('emits nothing for an empty world', () => {
    expect(dotsOf([])).toEqual([]);
  });
});
