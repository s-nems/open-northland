import type { ContentSet } from '@open-northland/data';
import { Building, Position } from '../../../components/index.js';
import { landscapeEditState } from '../../../components/landscape.js';
import type { Component, Entity, World } from '../../../ecs/world.js';
import type { TerrainGraph } from '../../../nav/terrain/index.js';
import { type LandscapeBlocks, landscapeBlocks } from '../../landscape/view.js';
import {
  BLOCKER_STORES,
  type BlockerStore,
  type BlockerVisit,
  BUILDING_STORE,
  BUILDING_ZONE,
  EXCLUSION,
  eachBlockerCell,
  OBSTACLE,
} from './blockers.js';

// The incrementally-maintained building-placement grid - the per-world count grid ./building.ts probes,
// with its journal replay, rebuild and coherence verifier.

/**
 * The dense blocker representation: one CONTRIBUTION COUNT per half-cell node, row-major `y*width+x` like
 * the index `TerrainGraph.nodeAt` mints, positive where that node blocks a reserved zone (OBSTACLE,
 * BUILDING_ZONE) or a body (EXCLUSION). Counts rather than flags so withdrawing one blocker leaves an
 * overlapping blocker's contribution standing. Off-map blocker cells are never stamped: their `y*width+x`
 * would alias onto a real tile a row over, and the bounds check rejects an off-map candidate first.
 * Terrain buildability stays a live `isBuildable()` call.
 *
 * `Uint16` holds a count: it counts the blockers overlapping ONE node, not a map-sized population, and a
 * decoded map's whole blocker population is in the tens of thousands - stacking every one of them on a
 * single node would still stay inside the range.
 */
export interface PlacementGrid {
  readonly terrain: TerrainGraph;
  readonly obstacle: Uint16Array;
  readonly exclusion: Uint16Array;
}

/** One entity's stamped slots per channel (duplicates kept, so a stamp and its withdrawal cancel exactly).
 *  Captured when stamped - the entity may be destroyed before the withdrawal replays. */
interface StampedSlots {
  readonly obstacle: readonly number[];
  readonly exclusion: readonly number[];
}

/** The scripted landscape layer the grid currently holds: the blocks object it was stamped from (a script
 *  topology edit mints a new one), plus the forbidden nodes, whose Map is edited in place and so is
 *  captured against its own revision. */
interface LandscapeLayer {
  readonly blocks: LandscapeBlocks;
  readonly forbidden: readonly number[];
  readonly forbiddenRevision: number;
}

const STAMP = 1;
const WITHDRAW = -1;

/**
 * The per-world incremental grid. The counts are maintained against the blocker stores' membership
 * journals, so a late-game map where a resource appears or is gathered away every few ticks costs
 * O(that footprint) per change instead of the O(all blockers) re-stamp a version-keyed memo pays on the
 * next placement query. It gates placement commands and AI build decisions, so the registered
 * `verifyCaches` verifier proves the held counts identical to a full {@link stampBlockerGrid}.
 */
interface IncrementalGrid {
  readonly content: ContentSet;
  readonly terrain: TerrainGraph;
  readonly grid: PlacementGrid;
  /** Held membership generations of the journal-replayed stores ({@link BLOCKER_STORES}). */
  readonly gens: Map<Component<unknown>, number>;
  /** Guard for the one input no journal covers: the in-place tier swap (a `World.mut` value bump)
   *  changes captured cells with no membership bump. The bump itself is ambiguous - construction
   *  progress moves it every active-site tick - so {@link buildingTypes} narrows it to the buildings
   *  whose type actually changed. */
  buildingValueGen: number;
  /** The `buildingType` each held Building capture used - the only Building value the capture reads,
   *  so a value bump resyncs exactly the mismatches instead of demanding a full rebuild. */
  readonly buildingTypes: Map<Entity, number>;
  readonly records: Map<BlockerStore, Map<Entity, StampedSlots>>;
  landscape: LandscapeLayer;
  /** Full rebuilds paid, for the test seam below. */
  rebuilds: number;
  /** The verifier's reference buffers, reused across checked ticks since a real map is about 1M nodes. */
  scratch: PlacementGrid | undefined;
}
const gridMemo = new WeakMap<World, IncrementalGrid>();

function emptyGrid(terrain: TerrainGraph): PlacementGrid {
  const size = terrain.width * terrain.height;
  return { terrain, obstacle: new Uint16Array(size), exclusion: new Uint16Array(size) };
}

/** `delta` onto every listed slot. Slots are captured in bounds, so the `?? 0` fallback that
 *  `noUncheckedIndexedAccess` demands is unreachable. */
function addCounts(counts: Uint16Array, slots: Iterable<number>, delta: number): void {
  for (const slot of slots) counts[slot] = (counts[slot] ?? 0) + delta;
}

function applySlots(grid: PlacementGrid, slots: StampedSlots, delta: number): void {
  addCounts(grid.obstacle, slots.obstacle, delta);
  addCounts(grid.exclusion, slots.exclusion, delta);
}

function applyLandscapeLayer(grid: PlacementGrid, layer: LandscapeLayer, delta: number): void {
  addCounts(grid.obstacle, layer.blocks.walk, delta);
  addCounts(grid.exclusion, layer.blocks.build, delta);
  addCounts(grid.obstacle, layer.forbidden, delta);
}

function liveLandscapeLayer(world: World, terrain: TerrainGraph): LandscapeLayer {
  const edits = landscapeEditState(world);
  return {
    blocks: landscapeBlocks(world, terrain),
    forbidden: [...edits.forbidden.keys()],
    forbiddenRevision: edits.forbiddenRevision,
  };
}

/** The slots `run`'s (cell, channel) pairs occupy - the shared channel routing and bounds filter of every
 *  capture. RESOURCE_ANCHOR and MARKER block no building, so they stamp nothing. */
function captureSlots(grid: PlacementGrid, run: (visit: BlockerVisit) => void): StampedSlots {
  const w = grid.terrain.width;
  const h = grid.terrain.height;
  const obstacle: number[] = [];
  const exclusion: number[] = [];
  run((x, y, channel) => {
    if (channel !== OBSTACLE && channel !== EXCLUSION && channel !== BUILDING_ZONE) return;
    if (x < 0 || y < 0 || x >= w || y >= h) return; // off-map cells are never stamped (see PlacementGrid)
    (channel === EXCLUSION ? exclusion : obstacle).push(y * w + x);
  });
  return { obstacle, exclusion };
}

function recordsOf(state: IncrementalGrid, store: BlockerStore): Map<Entity, StampedSlots> {
  let held = state.records.get(store);
  if (held === undefined) {
    held = new Map();
    state.records.set(store, held);
  }
  return held;
}

/** Replay one journal entry: withdraw the held slots, then re-stamp from live state. Idempotent, so a
 *  same-entity op sequence (add + destroy, remove + re-add) converges on the final membership. */
function resyncEntity(world: World, state: IncrementalGrid, store: BlockerStore, e: Entity): void {
  const map = recordsOf(state, store);
  const held = map.get(e);
  if (held !== undefined) {
    applySlots(state.grid, held, WITHDRAW);
    map.delete(e);
  }
  if (store === BUILDING_STORE) recordBuildingType(world, state, e);
  if (!world.has(e, store.component)) return;
  const slots = captureSlots(state.grid, (visit) => store.cells(world, state.content, e, visit));
  map.set(e, slots);
  applySlots(state.grid, slots, STAMP);
}

/** Record the type the held slots were derived from (cleared on removal), synchronously with the
 *  resync so record and slots cannot drift. */
function recordBuildingType(world: World, state: IncrementalGrid, e: Entity): void {
  const b = world.tryGet(e, Building);
  if (b === undefined) state.buildingTypes.delete(e);
  else state.buildingTypes.set(e, b.buildingType);
}

/** The Building value-bump response: resync only buildings whose live type differs from the held
 *  record - O(buildings) compares, zero captures when only construction progress (`built`) moved. */
function resyncChangedBuildingTypes(world: World, state: IncrementalGrid): void {
  for (const e of world.query(Building, Position)) {
    if (state.buildingTypes.get(e) === world.get(e, Building).buildingType) continue;
    resyncEntity(world, state, BUILDING_STORE, e);
  }
}

function rebuildGrid(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  reuse: IncrementalGrid | undefined,
): IncrementalGrid {
  const grid = reuse?.grid ?? emptyGrid(terrain);
  grid.obstacle.fill(0);
  grid.exclusion.fill(0);
  const gens = new Map<Component<unknown>, number>();
  for (const store of BLOCKER_STORES) {
    world.journalMembership(store.component);
    gens.set(store.component, world.componentGeneration(store.component));
  }
  const state: IncrementalGrid = {
    content,
    terrain,
    grid,
    gens,
    buildingValueGen: world.componentValueGeneration(Building),
    buildingTypes: new Map(),
    records: new Map(),
    landscape: liveLandscapeLayer(world, terrain),
    rebuilds: (reuse?.rebuilds ?? 0) + 1,
    scratch: reuse?.scratch,
  };
  for (const store of BLOCKER_STORES) {
    for (const e of world.query(store.component, Position)) resyncEntity(world, state, store, e);
  }
  applyLandscapeLayer(grid, state.landscape, STAMP);
  return state;
}

/** Catch `state` up to the live world via the membership journals; false demands a full rebuild
 *  (a journal gap). */
function catchUp(world: World, state: IncrementalGrid): boolean {
  for (const store of BLOCKER_STORES) {
    const gen = world.componentGeneration(store.component);
    const held = state.gens.get(store.component) ?? 0;
    if (gen === held) continue;
    const deltas = world.membershipDeltasSince(store.component, held);
    if (deltas === null) return false;
    for (const e of deltas) resyncEntity(world, state, store, e);
    state.gens.set(store.component, gen);
  }
  const buildingValueGen = world.componentValueGeneration(Building);
  if (buildingValueGen !== state.buildingValueGen) {
    resyncChangedBuildingTypes(world, state);
    state.buildingValueGen = buildingValueGen;
  }
  if (!landscapeLayerFresh(world, state)) {
    applyLandscapeLayer(state.grid, state.landscape, WITHDRAW);
    state.landscape = liveLandscapeLayer(world, state.terrain);
    applyLandscapeLayer(state.grid, state.landscape, STAMP);
  }
  return true;
}

/** Whether the landscape layer's two inputs still hold: `landscapeBlocks` mints a new object per script
 *  topology edit, and the forbidden nodes carry their own revision. */
function landscapeLayerFresh(world: World, state: IncrementalGrid): boolean {
  return (
    landscapeBlocks(world, state.terrain) === state.landscape.blocks &&
    landscapeEditState(world).forbiddenRevision === state.landscape.forbiddenRevision
  );
}

/**
 * The live placement grid for `world`, caught up or rebuilt as needed. The returned grid reads the live
 * counts rather than a copy of them: drain a probe's band before the world can change again, never hold
 * the grid across sim mutations.
 */
export function placementBlockerGrid(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
): PlacementGrid {
  const held = gridMemo.get(world);
  if (held !== undefined && held.content === content && held.terrain === terrain && catchUp(world, held)) {
    return held.grid;
  }
  const fresh = rebuildGrid(world, content, terrain, held?.terrain === terrain ? held : undefined);
  gridMemo.set(world, fresh);
  world.registerCacheVerifier('placementBlockerGrid', () => verifyGridMemo(world, content, terrain));
  return fresh.grid;
}

/** Test-only seam: the full rebuilds this world's grid has paid, so a test can prove a mutation replayed
 *  incrementally instead of re-stamping the map. */
export function placementGridRebuilds(world: World): number {
  return gridMemo.get(world)?.rebuilds ?? 0;
}

/** One full stamp of the blocker counts into an already-zeroed `grid`: an independent walk of every
 *  blocker store, so it proves the replayed records rather than repeating them. */
function stampBlockerGrid(world: World, content: ContentSet, grid: PlacementGrid): void {
  const w = grid.terrain.width;
  const h = grid.terrain.height;
  applyLandscapeLayer(grid, liveLandscapeLayer(world, grid.terrain), STAMP);
  eachBlockerCell(world, content, (x, y, channel) => {
    if (channel !== OBSTACLE && channel !== EXCLUSION && channel !== BUILDING_ZONE) return;
    if (x < 0 || y < 0 || x >= w || y >= h) return; // off-map cells are never stamped (see PlacementGrid)
    const counts = channel === EXCLUSION ? grid.exclusion : grid.obstacle;
    const slot = y * w + x;
    counts[slot] = (counts[slot] ?? 0) + STAMP;
  });
}

/** The {@link gridMemo} coherence verifier: while the state claims freshness, a full re-stamp must agree,
 *  count for count - the tripwire for a missed incremental delta or a blocker input the guards fail to see
 *  (`verifyCaches`). */
function verifyGridMemo(world: World, content: ContentSet, terrain: TerrainGraph): string[] {
  const state = gridMemo.get(world);
  if (state === undefined || state.content !== content || state.terrain !== terrain) return [];
  if (!isFresh(world, state)) return []; // a pending catch-up - the next read applies it
  const fresh = state.scratch ?? emptyGrid(terrain);
  state.scratch = fresh;
  fresh.obstacle.fill(0);
  fresh.exclusion.fill(0);
  stampBlockerGrid(world, content, fresh);
  for (let i = 0; i < fresh.obstacle.length; i++) {
    if (state.grid.obstacle[i] === fresh.obstacle[i] && state.grid.exclusion[i] === fresh.exclusion[i]) {
      continue;
    }
    return [
      'placementBlockerGrid diverges from a fresh stamp - an incremental delta missed a blocker change',
    ];
  }
  return [];
}

/** Whether every input generation matches the held state - the verifier's "claims freshness" gate. */
function isFresh(world: World, state: IncrementalGrid): boolean {
  return (
    world.componentValueGeneration(Building) === state.buildingValueGen &&
    BLOCKER_STORES.every(
      (s) => world.componentGeneration(s.component) === (state.gens.get(s.component) ?? 0),
    ) &&
    landscapeLayerFresh(world, state)
  );
}
