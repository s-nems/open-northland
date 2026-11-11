import {
  type FogGhost,
  type RememberedMarkers,
  terrainWorldBounds,
  tileToScreen,
} from '@open-northland/render';
import { type DiplomacyState, FOG_MODE, FOG_STATE, type FogView, fx } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import {
  ANIMAL_DOT_COLOUR,
  type MinimapDotContext,
  MinimapDotPlot,
  ROAD_SITE_DOT_COLOUR,
} from '../../../src/hud/minimap/dots.js';
import {
  DEFAULT_MINIMAP_FILTERS,
  type MinimapFilters,
  type MinimapLayer,
  withAllMinimapLayers,
} from '../../../src/hud/minimap/filters.js';
import {
  MINIMAP_PLAYER_COLOURS,
  STANCE_COLOURS,
  STANCE_SELF_COLOUR,
} from '../../../src/hud/minimap/palette.js';
import type { MinimapMark } from '../../../src/hud/minimap/stamps.js';
import { forEachMinimapDot } from '../../support/minimap-plot.js';
import { type Ent, idLookupVisits, snapshotOf, visitCountingSnapshot } from '../../support/snapshot.js';

/** Every layer on, so a plot test sees each kind; the shipped default hides the clutter layers. */
const ALL_LAYERS = withAllMinimapLayers(DEFAULT_MINIMAP_FILTERS, true);

const MAP_CELLS = 8;
const BOUNDS = terrainWorldBounds(MAP_CELLS, MAP_CELLS);
const SCALE = 0.5;
const SOLDIER_JOB = 31;
const HERO_JOB = 50;
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
  forEachMinimapDot(snapshotOf(entities), contextWith(overrides), (bx, by, mark, colour, part) => {
    if (part === 'fills') out.push({ bx, by, mark, colour });
  });
  return out;
}

/** Every sink call as `mark:part`, in order. */
function partsOf(entities: readonly Ent[], overrides: Partial<MinimapDotContext> = {}): string[] {
  const out: string[] = [];
  forEachMinimapDot(snapshotOf(entities), contextWith(overrides), (_bx, _by, mark, _colour, part) =>
    out.push(`${mark}:${part}`),
  );
  return out;
}

function contextWith(overrides: Partial<MinimapDotContext>): MinimapDotContext {
  return {
    fog: null,
    bounds: BOUNDS,
    scale: SCALE,
    filters: ALL_LAYERS,
    isFighterJob: (jobType) => jobType === SOLDIER_JOB || jobType === HERO_JOB,
    isHeroJob: (jobType) => jobType === HERO_JOB,
    viewer: VIEWER,
    stanceToward: (owner) => STANCES[owner] ?? 'neutral',
    ...overrides,
  };
}

function only(layer: MinimapLayer, scope: MinimapFilters['scope'] = 'everyone'): MinimapFilters {
  const none = withAllMinimapLayers(DEFAULT_MINIMAP_FILTERS, false);
  return { ...none, scope, layers: { ...none.layers, [layer]: true } };
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

const colour = (player: number): number => MINIMAP_PLAYER_COLOURS[player] ?? 0;

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
  it('marks each kind with its own shape in its owner colour, animals in the fauna tint, soldiers last', () => {
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
      { ...pxAt(6, 6), mark: 'animal', colour: ANIMAL_DOT_COLOUR },
      { ...pxAt(3, 3), mark: 'soldier', colour: colour(1) },
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

  it('sends each layer as all its rims, then all its fills, so a later layer still parts from the one below', () => {
    const parts = partsOf([person(1, 0, 1, 1), person(2, 0, 2, 2), building(3, 0, 1, 1)]);
    expect(parts).toEqual([
      'building:rims',
      'building:fills',
      'civilian:rims',
      'civilian:rims',
      'civilian:fills',
      'civilian:fills',
    ]);
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

  it("plots signposts and a worker's own or post flag in the worker's colour", () => {
    const dots = dotsOf(
      [
        { id: 1, components: { Signpost: {}, Owner: { player: 1 }, ...at(2, 2) } },
        { id: 2, components: { DeliveryFlag: {}, ...at(5, 5) } },
        { id: 3, components: { ...person(3, 0, 1, 1).components, WorkFlag: { flag: 2, radius: 24 } } },
        { id: 4, components: { DeliveryFlag: {}, ...at(7, 3) } },
        { id: 5, components: { ...person(5, 1, 1, 2).components, HaulFlag: { flag: 4, radius: 32 } } },
      ],
      { filters: only('signposts') },
    );
    expect(dots).toEqual([
      { ...pxAt(2, 2), mark: 'signpost', colour: colour(1) },
      { ...pxAt(5, 5), mark: 'signpost', colour: colour(0) },
      { ...pxAt(7, 3), mark: 'signpost', colour: colour(1) },
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
      person(8, 0, 7, 7, HERO_JOB),
    ];
    // The selection layer only haloes markers the other layers plot.
    const markOf: Readonly<Record<Exclude<MinimapLayer, 'selection'>, MinimapMark>> = {
      civilians: 'civilian',
      soldiers: 'soldier',
      heroes: 'hero',
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

  it("plots the world view's remembered buildings and vehicles on explored ground, owner and layer filtered", () => {
    const remembered: FogGhost[] = [
      { ref: 5, kind: 'building', tileX: 6, tileY: 4, owner: FOE },
      { ref: 6, kind: 'vehicle', tileX: 5, tileY: 6, owner: FOE },
      { ref: 7, kind: 'palisade', tileX: 7, tileY: 2, owner: FOE },
      { ref: 8, kind: 'resource', tileX: 6, tileY: 2 },
    ];
    const memory: RememberedMarkers = {
      markers: (out) => {
        out.push(...remembered);
        return out;
      },
    };
    const fog = fogWhere((cellX) => (cellX < 4 ? FOG_STATE.VISIBLE : FOG_STATE.EXPLORED));
    expect(dotsOf([], { fog, memory })).toEqual([
      { ...pxAt(6, 4), mark: 'building', colour: colour(FOE) },
      { ...pxAt(5, 6), mark: 'vehicle', colour: colour(FOE) },
    ]);
    expect(dotsOf([], { fog, memory, filters: only('vehicles') }).map((dot) => dot.mark)).toEqual([
      'vehicle',
    ]);
    expect(dotsOf([], { fog, memory, filters: only('buildings', 'friendly') })).toEqual([]);
    expect(dotsOf([], { fog: null, memory })).toEqual([]); // fog off: no memory, the live world shows
  });

  it('remaps the swatch through playerColourOf and wraps the raw player index modulo the table', () => {
    expect(dotsOf([person(1, 5, 0, 0)], { playerColourOf: () => 1 })[0]?.colour).toBe(colour(1));
    expect(dotsOf([person(1, MINIMAP_PLAYER_COLOURS.length, 0, 0)])[0]?.colour).toBe(colour(0));
  });

  it('paints owners by stance on request: self white, friends teal, enemies red, the rest amber', () => {
    const NEUTRAL = 3;
    const world = [
      person(1, VIEWER, 1, 1),
      person(2, FRIEND, 2, 2),
      person(3, FOE, 3, 3),
      person(4, NEUTRAL, 4, 4),
    ];
    const stance = { ...ALL_LAYERS, colours: 'stance' as const };
    expect(dotsOf(world, { filters: stance }).map((dot) => dot.colour)).toEqual([
      STANCE_SELF_COLOUR,
      STANCE_COLOURS.friend,
      STANCE_COLOURS.neutral,
      STANCE_COLOURS.enemy,
    ]);
    // A whole-map view has no stance to paint and keeps the team colours.
    expect(dotsOf(world, { filters: stance, viewer: null }).map((dot) => dot.colour)).toEqual(
      [VIEWER, FRIEND, FOE, NEUTRAL].map(colour),
    );
  });

  it('stamps hostile owners after every layer of the viewer, soldiers after civilians', () => {
    const world = [
      building(1, FOE, 1, 1),
      building(2, VIEWER, 2, 2),
      person(3, FOE, 3, 3, SOLDIER_JOB),
      person(4, FOE, 3, 4),
      person(5, VIEWER, 4, 4, SOLDIER_JOB),
      person(6, FRIEND, 5, 5),
      vehicle(7, FOE, 6, 6),
      vehicle(8, VIEWER, 6, 7),
    ];
    const owners = dotsOf(world).map((dot) => `${dot.mark}:${dot.colour === colour(FOE) ? 'foe' : 'own'}`);
    expect(owners).toEqual([
      'building:own',
      'civilian:own',
      'soldier:own',
      'vehicle:own',
      'building:foe',
      'civilian:foe',
      'soldier:foe',
      'vehicle:foe',
    ]);
    // A whole-map view has no hostile side: only soldiers move above the civilians.
    expect(dotsOf(world, { viewer: null }).map((dot) => dot.mark)).toEqual([
      'building',
      'building',
      'civilian',
      'civilian',
      'soldier',
      'soldier',
      'vehicle',
      'vehicle',
    ]);
  });

  it('stamps every hero last, over hostile markers and vehicles, in its own disc', () => {
    const world = [
      person(1, VIEWER, 1, 1, HERO_JOB),
      person(2, FOE, 2, 2, HERO_JOB),
      person(3, FOE, 1, 1, SOLDIER_JOB),
      vehicle(4, VIEWER, 1, 1),
    ];
    expect(partsOf(world)).toEqual([
      'vehicle:rims',
      'vehicle:fills',
      'soldier:rims',
      'soldier:fills',
      'hero:rims',
      'hero:rims',
      'hero:fills',
      'hero:fills',
    ]);
    expect(dotsOf(world, { filters: only('heroes') })).toEqual([
      { ...pxAt(1, 1), mark: 'hero', colour: colour(VIEWER) },
      { ...pxAt(2, 2), mark: 'hero', colour: colour(FOE) },
    ]);
    // A hero is no soldier: the soldiers switch alone shows only the soldier.
    expect(dotsOf(world, { filters: only('soldiers') }).map((dot) => dot.mark)).toEqual(['soldier']);
  });

  it('haloes the selected settlers and vehicles above the hostiles and under the heroes', () => {
    const world = [
      person(1, VIEWER, 1, 1),
      person(2, VIEWER, 2, 2, SOLDIER_JOB),
      person(3, FOE, 3, 3),
      vehicle(4, VIEWER, 1, 2),
      person(5, VIEWER, 2, 1, HERO_JOB),
      building(6, VIEWER, 3, 1),
    ];
    expect(partsOf(world, { selected: new Set([1, 4, 5, 6]) })).toEqual([
      'building:rims',
      'building:fills',
      'soldier:rims',
      'soldier:fills',
      'civilian:rims',
      'civilian:fills',
      'civilian:halo',
      'hero:halo',
      'vehicle:halo',
      'civilian:rims',
      'vehicle:rims',
      'civilian:fills',
      'vehicle:fills',
      'hero:rims',
      'hero:fills',
    ]);
    // The halo layer off hands the plot no selection: the plain stacking stays.
    expect(partsOf(world)).not.toContain('civilian:halo');
  });

  it("rims a hostile marker over the viewer's fills, so an intruder in the crowd keeps its outline", () => {
    const parts = partsOf([person(1, VIEWER, 1, 1), person(2, FOE, 1, 1), person(3, VIEWER, 2, 2)]);
    expect(parts).toEqual([
      'civilian:rims',
      'civilian:rims',
      'civilian:fills',
      'civilian:fills',
      'civilian:rims',
      'civilian:fills',
    ]);
    // A friend or neutral owner stays in its layer.
    expect(partsOf([person(1, VIEWER, 1, 1), person(2, FRIEND, 1, 1)])).toEqual([
      'civilian:rims',
      'civilian:rims',
      'civilian:fills',
      'civilian:fills',
    ]);
  });

  it('looks up its layer ids on a replot, never walking the entity lane again', () => {
    const scenery: Ent[] = Array.from({ length: 500 }, (_, i) => ({
      id: 100 + i,
      components: { Tree: {}, ...at(1, 1) },
    }));
    const { snapshot, visits } = visitCountingSnapshot(
      snapshotOf([...scenery, person(1, 0, 2, 2), building(2, 0, 3, 3)]),
    );
    const plot = (): number => {
      let dots = 0;
      forEachMinimapDot(snapshot, contextWith({}), (_bx, _by, _mark, _colour, part) => {
        if (part === 'fills') dots++;
      });
      return dots;
    };
    expect(plot()).toBe(2);
    const visitsAfterFirst = visits();
    expect(plot()).toBe(2);
    expect(visits() - visitsAfterFirst).toBeLessThanOrEqual(idLookupVisits(2, scenery.length + 2));
  });
});

describe('forEachMinimapDot over a crowded synthetic world', () => {
  /** Owners 0..3 and the unowned, so every scope, stance and hostile group is exercised. */
  const OWNERS = 5;
  const KINDS = 7;
  const ENTITIES = 700;
  /** An id stride that leaves room for each gatherer's flag beside it. */
  const ID_STRIDE = 2;
  const PINNED_DIGEST = 2242898252;

  function crowd(): Ent[] {
    const out: Ent[] = [];
    for (let i = 0; i < ENTITIES; i++) {
      const id = 1 + i * ID_STRIDE;
      const x = (i * 3) % MAP_CELLS;
      const y = (i * 5) % MAP_CELLS;
      const owner = i % OWNERS;
      switch (i % KINDS) {
        case 0:
          out.push(
            person(id, owner, x, y, i % 3 === 0 ? SOLDIER_JOB : i % 11 === 0 ? HERO_JOB : CIVILIAN_JOB),
          );
          break;
        case 1:
          out.push(building(id, owner, x, y));
          break;
        case 2:
          out.push(animal(id, x, y, owner === OWNERS - 1 ? undefined : owner));
          break;
        case 3:
          out.push(vehicle(id, owner, x, y, i % 4 === 0 ? 1 : null));
          break;
        case 4:
          out.push(roadSite(id, owner, x, y));
          break;
        case 5:
          out.push({ id, components: { Signpost: {}, Owner: { player: owner }, ...at(x, y) } });
          break;
        default:
          out.push({ id, components: { ...person(id, owner, x, y).components, WorkFlag: { flag: id + 1 } } });
          out.push({ id: id + 1, components: at(y, x) });
      }
    }
    return out;
  }

  /** FNV-1a over every sink call, in order. */
  function digestOf(overrides: Partial<MinimapDotContext>): number {
    let h = 0x811c9dc5;
    const mix = (text: string): void => {
      for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
    };
    const snapshot = snapshotOf(crowd());
    forEachMinimapDot(snapshot, contextWith(overrides), (bx, by, mark, colour, part) =>
      mix(`${bx},${by},${mark},${colour},${part};`),
    );
    return h;
  }

  it('plots the same markers in the same order under every scope and colouring', () => {
    const scopes: readonly MinimapFilters['scope'][] = ['everyone', 'mine', 'friendly', 'hostile'];
    const digests = scopes.flatMap((scope) => [
      digestOf({ filters: { ...ALL_LAYERS, scope } }),
      digestOf({ filters: { ...ALL_LAYERS, scope, colours: 'stance' } }),
    ]);
    digests.push(digestOf({ viewer: null }));
    let h = 0;
    for (const d of digests) h = (Math.imul(h, 31) + d) >>> 0;
    expect(h).toBe(PINNED_DIGEST);
  });
});

describe('MinimapDotPlot', () => {
  /** Every owner, stance, kind and layer a plot sorts, several deadline strides of each. */
  function crowd(): Ent[] {
    const ents: Ent[] = [];
    let id = 1;
    const players = [VIEWER, FRIEND, FOE];
    for (let n = 0; n < 150; n++) {
      const player = players[n % players.length] ?? VIEWER;
      const x = n % MAP_CELLS;
      const y = (n * 3) % MAP_CELLS;
      ents.push(
        person(id++, player, x, y, n % 5 === 0 ? SOLDIER_JOB : n % 37 === 0 ? HERO_JOB : CIVILIAN_JOB),
      );
      if (n % 4 === 0) ents.push(building(id++, player, y, x));
      if (n % 9 === 0) ents.push(animal(id++, x, x));
      if (n % 11 === 0) ents.push(vehicle(id++, player, y, y));
      if (n % 13 === 0) ents.push(roadSite(id++, player, x, 1));
    }
    return ents;
  }
  const record =
    (out: string[]) => (bx: number, by: number, mark: MinimapMark, colour: number, part: string) =>
      out.push(`${bx},${by},${mark},${colour},${part}`);

  it('stamps over many deadline-cut steps exactly what one whole plot stamps', () => {
    const snapshot = snapshotOf(crowd());
    const ctx = contextWith({});
    const whole: string[] = [];
    forEachMinimapDot(snapshot, ctx, record(whole));

    const plot = new MinimapDotPlot();
    const stepped: string[] = [];
    plot.start(ctx);
    let steps = 0;
    // A deadline already passed stops each step after one stride of carriers.
    while (!plot.step(snapshot, record(stepped), Number.NEGATIVE_INFINITY)) steps++;

    expect(steps).toBeGreaterThan(1);
    expect(plot.pending()).toBe(false);
    expect(stepped).toEqual(whole);
  });

  it('drops a plot under way when started again', () => {
    const snapshot = snapshotOf(crowd());
    const plot = new MinimapDotPlot();
    plot.start(contextWith({}));
    expect(plot.step(snapshot, () => {}, Number.NEGATIVE_INFINITY)).toBe(false);

    const ctx = contextWith({ filters: only('buildings') });
    const whole: string[] = [];
    forEachMinimapDot(snapshot, ctx, record(whole));
    const restarted: string[] = [];
    plot.start(ctx);
    expect(plot.step(snapshot, record(restarted))).toBe(true);
    expect(restarted).toEqual(whole);
  });

  it('reads each carrier once, off the snapshot of the step that reaches it, when the world moves mid-plot', () => {
    // Settlers stand one to a column, so a stamp's place names its settler.
    const FIRST = 20;
    const LAST = 219;
    const ids = Array.from({ length: LAST - FIRST + 1 }, (_, n) => FIRST + n);
    const MOVED_ROW = 2;
    const before = snapshotOf(ids.map((id) => person(id, VIEWER, id, 0)));
    // The first step stops after one stride of carriers: past the low ids changed below, short of the high.
    const [movedLow, removedLow, movedHigh, removedHigh, addedLow, addedHigh] = [20, 23, 210, 215, 5, 1000];
    const after = snapshotOf(
      [
        ...ids
          .filter((id) => id !== removedLow && id !== removedHigh)
          .map((id) => person(id, VIEWER, id, id === movedLow || id === movedHigh ? MOVED_ROW : 0)),
        person(addedLow, VIEWER, addedLow, 0),
        person(addedHigh, VIEWER, addedHigh, 0),
      ].sort((a, b) => a.id - b.id),
    );
    const settlerAt = new Map<string, string>();
    for (const id of [...ids, addedLow, addedHigh]) {
      for (const row of [0, MOVED_ROW]) {
        const { bx, by } = pxAt(id, row);
        settlerAt.set(`${bx},${by}`, `${id}@${row}`);
      }
    }
    const stamped: string[] = [];
    const plot = new MinimapDotPlot();
    plot.start(contextWith({ filters: only('civilians') }));
    expect(plot.step(before, () => {}, Number.NEGATIVE_INFINITY)).toBe(false);
    expect(
      plot.step(after, (bx, by, _mark, _colour, part) => {
        if (part === 'fills') stamped.push(settlerAt.get(`${bx},${by}`) ?? `unknown ${bx},${by}`);
      }),
    ).toBe(true);

    const expected = [
      ...ids.filter((id) => id !== removedHigh).map((id) => `${id}@${id === movedHigh ? MOVED_ROW : 0}`),
      `${addedHigh}@0`,
    ];
    expect([...stamped].sort()).toEqual([...expected].sort());
    expect(new Set(stamped).size).toBe(stamped.length);
  });
});
