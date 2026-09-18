import type { ContentSet } from '@open-northland/data';
import { DeliveryFlag, Position } from '../../../../components/index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { BlockOverlay } from '../../../../nav/block-overlay.js';
import type { NodeId, TerrainGraph } from '../../../../nav/terrain/index.js';
import { sameCells } from '../../geometry.js';
import { type BlockerJournal, startBlockerJournal } from '../blocker-journal.js';
import { type BlockedCells, blockedCellsOf, markerCells, rederiveBlockedCells } from './blocker-cells.js';
import { workFlagMoveCount } from './flag-moves.js';

// The incrementally-maintained work-flag blocked set - the refcounted per-world cache behind
// ../work-flag's placement queries, over the shared replay of ../blocker-journal.ts, with its marker
// layer, rebuild and coherence verifier.

/** Node → standing contribution count; `blocked` holds exactly the keys with a positive count. */
interface BlockedRefcounts {
  readonly counts: Map<NodeId, number>;
  readonly blocked: Set<NodeId>;
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
  readonly flagCells: Map<Entity, BlockedCells>;
}
const blocksMemo = new WeakMap<World, IncrementalBlocks>();

function addCells(refs: BlockedRefcounts, cells: BlockedCells): void {
  for (const node of cells) {
    const next = (refs.counts.get(node) ?? 0) + 1;
    refs.counts.set(node, next);
    if (next === 1) refs.blocked.add(node);
  }
}

function removeCells(refs: BlockedRefcounts, cells: BlockedCells): void {
  for (const node of cells) {
    const next = (refs.counts.get(node) ?? 0) - 1;
    if (next <= 0) {
      refs.counts.delete(node);
      refs.blocked.delete(node);
    } else {
      refs.counts.set(node, next);
    }
  }
}

/** Re-derive the whole marker layer from the DeliveryFlag store - flags are the one blocker that MOVES
 *  (an in-place Position write the journals cannot see), and the store is small, so any flag change
 *  re-diffs it wholesale in O(flags). */
function refreshMarkerLayer(world: World, state: IncrementalBlocks): void {
  for (const cells of state.flagCells.values()) removeCells(state, cells);
  state.flagCells.clear();
  for (const e of world.query(DeliveryFlag, Position)) {
    const cells = markerCells(world, state.terrain, e);
    state.flagCells.set(e, cells);
    addCells(state, cells);
  }
}

function rebuildState(world: World, content: ContentSet, terrain: TerrainGraph): IncrementalBlocks {
  // The refcounts the journal stamps into are the ones the state below hands out - same Map and Set.
  const refs: BlockedRefcounts = { counts: new Map(), blocked: new Set() };
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
    flagCells: new Map(),
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
  const fresh = rebuildState(world, content, terrain);
  blocksMemo.set(world, fresh);
  world.registerCacheVerifier('workFlagPlacementBlocks', () => verifyBlocksMemo(world, content, terrain));
  return fresh;
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
  const held = state.flagCells.get(ignoreFlag);
  if (held === undefined || held.length === 0) return state.blocked;
  return blocksWithout(state, held);
}

/** The blocked set minus one flag's own contributions: a node that flag covers stays blocked only
 *  while another blocker also contributes to it. O(|ignoredCells|), the ignored flag's own footprint,
 *  because it withholds through the refcounts instead of materializing the difference. */
function blocksWithout(state: IncrementalBlocks, ignoredCells: BlockedCells): BlockOverlay {
  const withheld = new Map<NodeId, number>();
  for (const node of ignoredCells) withheld.set(node, (withheld.get(node) ?? 0) + 1);
  return {
    has: (node) => (state.counts.get(node) ?? 0) > (withheld.get(node) ?? 0),
    // Over-counts by the withheld nodes; `BlockOverlay` asks only that 0 mean empty, which holds
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
  if (sameCells(state.blocked, fresh)) return [];
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
