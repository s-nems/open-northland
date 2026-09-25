import type { ContentSet } from '@open-northland/data';
import { landscapeEditState } from '../../../components/landscape.js';
import type { World } from '../../../ecs/world.js';
import type { TerrainGraph } from '../../../nav/terrain/index.js';
import { type LandscapeBlocks, landscapeBlocks } from '../../landscape/view.js';
import { type BlockerJournal, startBlockerJournal } from './blocker-journal.js';
import {
  type BlockerVisit,
  BUILDING_ZONE,
  EXCLUSION,
  eachBlockerCell,
  OBSTACLE,
  PALISADE_BODY,
  PALISADE_ZONE,
} from './blockers.js';

// The incrementally-maintained building-placement grid - the per-world count grid ./building.ts probes,
// over the shared replay of ./blocker-journal.ts, with its landscape layer, rebuild and coherence verifier.

/**
 * The dense blocker representation: one CONTRIBUTION COUNT per half-cell node, row-major `y*width+x` like
 * the index `TerrainGraph.nodeAt` mints, positive where that node blocks a reserved zone (OBSTACLE,
 * BUILDING_ZONE) or a body (EXCLUSION). Counts rather than flags so withdrawing one blocker leaves an
 * overlapping blocker's contribution standing. Off-map blocker cells are never stamped: their `y*width+x`
 * would alias onto a real tile a row over, and the bounds check rejects an off-map candidate first.
 * Terrain buildability stays a live `isBuildable()` call.
 *
 * `Uint16` counts the blockers overlapping ONE node, not a map-sized population: a decoded map's whole
 * blocker population is in the tens of thousands, so stacking every one of them on a single node would
 * still stay in range. An unbalanced withdraw would wrap to 65535 and pin the node blocked for good, which
 * the verifier below catches.
 */
export interface PlacementGrid {
  readonly terrain: TerrainGraph;
  readonly obstacle: Uint16Array;
  readonly exclusion: Uint16Array;
  readonly palisadeBody: Uint16Array;
  readonly palisadeZone: Uint16Array;
}

/** One entity's stamped slots per channel. */
interface StampedSlots {
  readonly obstacle: readonly number[];
  readonly exclusion: readonly number[];
  readonly palisadeBody: readonly number[];
  readonly palisadeZone: readonly number[];
}

/** The scripted landscape layer the grid currently holds: the blocks view it last applied (a read
 *  after script edits mints the next one, naming the cells they changed), plus the forbidden nodes,
 *  whose Map is edited in place and so is captured against its own revision. */
interface LandscapeLayer {
  readonly blocks: LandscapeBlocks;
  readonly forbidden: readonly number[];
  readonly forbiddenRevision: number;
}

const STAMP = 1;
const WITHDRAW = -1;

/**
 * The per-world incremental grid: the journal-replayed blocker stores plus the landscape layer, replayed
 * from the change each landscape view records. The grid gates placement commands and AI build decisions,
 * so the registered `verifyCaches` verifier proves the held counts identical to a full
 * {@link stampBlockerGrid}.
 */
interface IncrementalGrid {
  readonly content: ContentSet;
  readonly terrain: TerrainGraph;
  readonly grid: PlacementGrid;
  readonly journal: BlockerJournal;
  landscape: LandscapeLayer;
  /** Full rebuilds paid, for the test seam below. */
  rebuilds: number;
  /** The verifier's reference buffers, reused across checked ticks since a real map is about 1M nodes. */
  scratch: PlacementGrid | undefined;
}
const gridMemo = new WeakMap<World, IncrementalGrid>();

function emptyGrid(terrain: TerrainGraph): PlacementGrid {
  const size = terrain.width * terrain.height;
  return {
    terrain,
    obstacle: new Uint16Array(size),
    exclusion: new Uint16Array(size),
    palisadeBody: new Uint16Array(size),
    palisadeZone: new Uint16Array(size),
  };
}

/** `delta` onto every listed slot. Slots are captured in bounds, so the `?? 0` fallback that
 *  `noUncheckedIndexedAccess` demands is unreachable. */
function addCounts(counts: Uint16Array, slots: Iterable<number>, delta: number): void {
  for (const slot of slots) counts[slot] = (counts[slot] ?? 0) + delta;
}

function applySlots(grid: PlacementGrid, slots: StampedSlots, delta: number): void {
  addCounts(grid.obstacle, slots.obstacle, delta);
  addCounts(grid.exclusion, slots.exclusion, delta);
  addCounts(grid.palisadeBody, slots.palisadeBody, delta);
  addCounts(grid.palisadeZone, slots.palisadeZone, delta);
}

function applyLandscapeLayer(grid: PlacementGrid, layer: LandscapeLayer, delta: number): void {
  addCounts(grid.obstacle, layer.blocks.walk, delta);
  addCounts(grid.exclusion, layer.blocks.build, delta);
  addCounts(grid.obstacle, layer.forbidden, delta);
}

/** Replay the landscape views minted after `held` up to `current`, cell by cell, so a script edit costs
 *  its footprint. False when the chain no longer reaches `current`: the layer was re-keyed or the
 *  views between were let go, and only a full re-read can tell what changed. */
function applyLandscapeChanges(
  grid: PlacementGrid,
  held: LandscapeBlocks,
  current: LandscapeBlocks,
): boolean {
  let view = held.next;
  while (view !== undefined) {
    for (const change of view.changes) {
      const counts = change.channel === 'walk' ? grid.obstacle : grid.exclusion;
      addCounts(counts, [change.node], change.entered ? STAMP : WITHDRAW);
    }
    if (view === current) return true;
    view = view.next;
  }
  return false;
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
  const palisadeBody: number[] = [];
  const palisadeZone: number[] = [];
  run((x, y, channel) => {
    if (
      channel !== OBSTACLE &&
      channel !== EXCLUSION &&
      channel !== BUILDING_ZONE &&
      channel !== PALISADE_BODY &&
      channel !== PALISADE_ZONE
    )
      return;
    if (x < 0 || y < 0 || x >= w || y >= h) return; // off-map cells are never stamped (see PlacementGrid)
    const target =
      channel === EXCLUSION
        ? exclusion
        : channel === PALISADE_BODY
          ? palisadeBody
          : channel === PALISADE_ZONE
            ? palisadeZone
            : obstacle;
    target.push(y * w + x);
  });
  return { obstacle, exclusion, palisadeBody, palisadeZone };
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
  grid.palisadeBody.fill(0);
  grid.palisadeZone.fill(0);
  const landscape = liveLandscapeLayer(world, terrain);
  applyLandscapeLayer(grid, landscape, STAMP);
  return {
    content,
    terrain,
    grid,
    journal: startBlockerJournal(world, {
      capture: (w, store, e) => captureSlots(grid, (visit) => store.cells(w, content, e, visit)),
      apply: (slots) => applySlots(grid, slots, STAMP),
      withdraw: (slots) => applySlots(grid, slots, WITHDRAW),
    }),
    landscape,
    rebuilds: (reuse?.rebuilds ?? 0) + 1,
    scratch: reuse?.scratch,
  };
}

/** Catch `state` up to the live world: the journaled blocker stores, then the landscape layer; false
 *  demands a full rebuild (a journal gap). */
function catchUp(world: World, state: IncrementalGrid): boolean {
  if (!state.journal.catchUp()) return false;
  if (landscapeLayerFresh(world, state)) return true;
  const held = state.landscape;
  const blocks = landscapeBlocks(world, state.terrain);
  if (blocks !== held.blocks && !applyLandscapeChanges(state.grid, held.blocks, blocks)) return false;
  const edits = landscapeEditState(world);
  let forbidden = held.forbidden;
  if (edits.forbiddenRevision !== held.forbiddenRevision) {
    addCounts(state.grid.obstacle, held.forbidden, WITHDRAW);
    forbidden = [...edits.forbidden.keys()];
    addCounts(state.grid.obstacle, forbidden, STAMP);
  }
  state.landscape = { blocks, forbidden, forbiddenRevision: edits.forbiddenRevision };
  return true;
}

/** Whether the landscape layer's two inputs still hold: `landscapeBlocks` mints a new view per script
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
    if (
      channel !== OBSTACLE &&
      channel !== EXCLUSION &&
      channel !== BUILDING_ZONE &&
      channel !== PALISADE_BODY &&
      channel !== PALISADE_ZONE
    )
      return;
    if (x < 0 || y < 0 || x >= w || y >= h) return; // off-map cells are never stamped (see PlacementGrid)
    const counts =
      channel === EXCLUSION
        ? grid.exclusion
        : channel === PALISADE_BODY
          ? grid.palisadeBody
          : channel === PALISADE_ZONE
            ? grid.palisadeZone
            : grid.obstacle;
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
  fresh.palisadeBody.fill(0);
  fresh.palisadeZone.fill(0);
  stampBlockerGrid(world, content, fresh);
  for (let i = 0; i < fresh.obstacle.length; i++) {
    if (
      state.grid.obstacle[i] === fresh.obstacle[i] &&
      state.grid.exclusion[i] === fresh.exclusion[i] &&
      state.grid.palisadeBody[i] === fresh.palisadeBody[i] &&
      state.grid.palisadeZone[i] === fresh.palisadeZone[i]
    ) {
      continue;
    }
    return [
      'placementBlockerGrid diverges from a fresh stamp - an incremental delta missed a blocker change',
    ];
  }
  return [];
}

function isFresh(world: World, state: IncrementalGrid): boolean {
  return state.journal.fresh() && landscapeLayerFresh(world, state);
}
