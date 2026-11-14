import type { ContentSet } from '@open-northland/data';
import { DeliveryFlag, Position } from '../../../../components/index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { BlockOverlay } from '../../../../nav/block-overlay.js';
import type { NodeId, TerrainGraph } from '../../../../nav/terrain/index.js';
import { countsMatchCells } from '../../geometry.js';
import { type BlockerJournal, startBlockerJournal } from '../blocker-journal.js';
import { type BlockedCells, blockedCellsOf, markerNode, rederiveBlockedCells } from './blocker-cells.js';
import { workFlagMoveCount } from './flag-moves.js';

// The incrementally-maintained work-flag blocked set - the refcounted per-world cache behind
// ../work-flag's placement queries, over the shared replay of ../blocker-journal.ts, with its marker
// layer, rebuild and coherence verifier.

/** Per node, its standing contribution count; `blocked` answers a positive count and its size is the
 *  number of such nodes. Counts rather than flags so withdrawing one blocker leaves an overlapping
 *  one's contribution standing. */
interface BlockedRefcounts {
  readonly counts: Uint16Array;
  readonly blocked: PositiveCountOverlay;
}

/** The {@link BlockOverlay} over a count array: a node is blocked while its count is positive. */
class PositiveCountOverlay implements BlockOverlay {
  size = 0;
  constructor(private readonly counts: Uint16Array) {}
  has(node: NodeId): boolean {
    return (this.counts[node] ?? 0) > 0;
  }
}

/**
 * The per-world incremental blocked-set state: the journal-replayed blocker stores plus the marker layer,
 * which no journal covers. It feeds command gates and sim decisions, so the registered `verifyCaches`
 * verifier proves the held set byte-identical to a full {@link rederiveBlockedCells}.
 */
interface IncrementalBlocks extends BlockedRefcounts {
  readonly content: ContentSet;
  readonly terrain: TerrainGraph;
  readonly journal: BlockerJournal;
  /** The marker layer's inputs; a bump re-diffs the whole DeliveryFlag store - O(flags), tiny. */
  flagGen: number;
  flagMoves: number;
  /** Each placed flag's blocked node; a flag off the map holds none. */
  readonly flagNodes: Map<Entity, NodeId>;
  /** Per node, how many of `counts` are flag markers. */
  readonly markerCounts: Uint16Array;
  /** Full rebuilds paid, for the test seam below. */
  readonly rebuilds: number;
}
const blocksMemo = new WeakMap<World, IncrementalBlocks>();

function addCells(refs: BlockedRefcounts, cells: BlockedCells): void {
  for (const node of cells) addNode(refs, node);
}

function addNode(refs: BlockedRefcounts, node: number): void {
  const next = (refs.counts[node] ?? 0) + 1;
  refs.counts[node] = next;
  if (next === 1) refs.blocked.size++;
}

function removeCells(refs: BlockedRefcounts, cells: BlockedCells): void {
  for (const node of cells) removeNode(refs, node);
}

function removeNode(refs: BlockedRefcounts, node: number): void {
  const held = refs.counts[node] ?? 0;
  if (held === 0) return;
  refs.counts[node] = held - 1;
  if (held === 1) refs.blocked.size--;
}

function removeMarker(state: IncrementalBlocks, node: NodeId): void {
  removeNode(state, node);
  const held = state.markerCounts[node] ?? 0;
  if (held > 0) state.markerCounts[node] = held - 1;
}

/** Re-diff the marker layer against the DeliveryFlag store - flags are the one blocker that MOVES (an
 *  in-place Position write the journals cannot see), so any flag change re-reads every flag in O(flags),
 *  and only a flag whose node changed touches the refcounts. */
function refreshMarkerLayer(world: World, state: IncrementalBlocks): void {
  const { flagNodes } = state;
  flagNodes.forEach((node, e) => {
    if (world.has(e, DeliveryFlag) && world.has(e, Position)) return;
    removeMarker(state, node);
    flagNodes.delete(e);
  });
  for (const e of world.query(DeliveryFlag, Position)) {
    const node = markerNode(world, state.terrain, e);
    const held = flagNodes.get(e);
    if (node === (held ?? null)) continue;
    if (held !== undefined) removeMarker(state, held);
    if (node === null) {
      flagNodes.delete(e);
    } else {
      addNode(state, node);
      state.markerCounts[node] = (state.markerCounts[node] ?? 0) + 1;
      flagNodes.set(e, node);
    }
  }
}

function rebuildState(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  rebuilds: number,
): IncrementalBlocks {
  // The refcounts the journal stamps into are the ones the state below hands out.
  const counts = new Uint16Array(terrain.nodeCount);
  const refs: BlockedRefcounts = { counts, blocked: new PositiveCountOverlay(counts) };
  const journal = startBlockerJournal(world, {
    capture: (w, store, e) => blockedCellsOf(w, content, terrain, store, e),
    apply: (cells) => addCells(refs, cells),
    withdraw: (cells) => removeCells(refs, cells),
  });
  const state: IncrementalBlocks = {
    content,
    terrain,
    ...refs,
    journal,
    flagGen: world.componentGeneration(DeliveryFlag),
    flagMoves: workFlagMoveCount(world),
    flagNodes: new Map(),
    markerCounts: new Uint16Array(terrain.nodeCount),
    rebuilds,
  };
  refreshMarkerLayer(world, state);
  return state;
}

/** Catch `state` up to the live world: the journaled blocker stores, then the marker layer; false demands
 *  a full rebuild (a journal gap). */
function catchUp(world: World, state: IncrementalBlocks): boolean {
  if (!state.journal.catchUp()) return false;
  const flagGen = world.componentGeneration(DeliveryFlag);
  const moves = workFlagMoveCount(world);
  if (flagGen !== state.flagGen || moves !== state.flagMoves) {
    refreshMarkerLayer(world, state);
    state.flagGen = flagGen;
    state.flagMoves = moves;
  }
  return true;
}

/** The live incremental state for `world`, caught up or rebuilt as needed. */
function liveBlocks(world: World, content: ContentSet, terrain: TerrainGraph): IncrementalBlocks {
  const held = blocksMemo.get(world);
  if (held !== undefined && held.content === content && held.terrain === terrain && catchUp(world, held)) {
    return held;
  }
  const fresh = rebuildState(world, content, terrain, (held?.rebuilds ?? 0) + 1);
  blocksMemo.set(world, fresh);
  world.registerCacheVerifier('workFlagPlacementBlocks', () => verifyBlocksMemo(world, content, terrain));
  return fresh;
}

/** Test-only seam: the full rebuilds this world's blocked set has paid. */
export function workFlagBlockRebuilds(world: World): number {
  return blocksMemo.get(world)?.rebuilds ?? 0;
}

/** The nodes a work flag may NOT occupy - the {@link rederiveBlockedCells} rule, served off the incremental
 *  state so reads share one refcounted set a change costs O(own footprint) to update. The returned view
 *  reads that live state rather than a copy of it: read it fresh within a decision, never hold it across
 *  sim mutations. `ignoreFlag` withholds one flag's own contributions via the refcounts, for a flag
 *  re-placed over its own cell. */
export function workFlagPlacementBlocks(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  ignoreFlag?: Entity,
): BlockOverlay {
  const state = liveBlocks(world, content, terrain);
  if (ignoreFlag === undefined) return state.blocked;
  const held = state.flagNodes.get(ignoreFlag);
  if (held === undefined) return state.blocked;
  return blocksWithout(state, held);
}

/** How many standing contributions deny a work flag each node, and how many of them are flag markers:
 *  each resource anchored there and each flag standing there adds one, and so does every other blocker
 *  cell covering it. A live view, like {@link workFlagPlacementBlocks}. */
export interface WorkFlagBlockerCounts {
  total(node: NodeId): number;
  markers(node: NodeId): number;
}

export function workFlagBlockerCounts(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
): WorkFlagBlockerCounts {
  const { counts, markerCounts } = liveBlocks(world, content, terrain);
  return { total: (node) => counts[node] ?? 0, markers: (node) => markerCounts[node] ?? 0 };
}

/** The blocked set minus one flag's own contribution: the node that flag covers stays blocked only
 *  while another blocker also contributes to it, withheld through the refcounts instead of materializing
 *  the difference. */
function blocksWithout(state: IncrementalBlocks, ignored: NodeId): BlockOverlay {
  return {
    has: (node) => (state.counts[node] ?? 0) > (node === ignored ? 1 : 0),
    // Over-counts by the withheld node; `BlockOverlay` asks only that 0 mean empty, which holds
    // because `blocked` is exactly the positive-count keys.
    get size() {
      return state.blocked.size;
    },
  };
}

/** The {@link blocksMemo} coherence verifier: while the state claims freshness, a full re-derive must
 *  agree - the tripwire for a missed incremental delta or an input the guards fail to see (`verifyCaches`). */
function verifyBlocksMemo(world: World, content: ContentSet, terrain: TerrainGraph): string[] {
  const state = blocksMemo.get(world);
  if (state === undefined || state.content !== content || state.terrain !== terrain) return [];
  if (!isFresh(world, state)) return []; // a pending catch-up - the next read applies it
  const fresh = rederiveBlockedCells(world, content, terrain);
  // Matching counts and cells with the held size proves the hand-kept positive-node counter too.
  const markers = new Uint16Array(terrain.nodeCount);
  for (const e of world.query(DeliveryFlag, Position)) {
    const node = markerNode(world, terrain, e);
    if (node !== null) markers[node] = (markers[node] ?? 0) + 1;
  }
  if (!markers.every((n, node) => state.markerCounts[node] === n)) {
    return ['workFlagPlacementBlocks marker counts disagree with the standing flags'];
  }
  if (countsMatchCells(state.counts, fresh) && state.blocked.size === fresh.size) return [];
  return [
    `workFlagPlacementBlocks holds ${state.blocked.size} nodes but re-derived ${fresh.size} - an incremental delta missed a blocker change`,
  ];
}

function isFresh(world: World, state: IncrementalBlocks): boolean {
  return (
    state.journal.fresh() &&
    world.componentGeneration(DeliveryFlag) === state.flagGen &&
    workFlagMoveCount(world) === state.flagMoves
  );
}
