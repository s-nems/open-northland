import type { ContentSet } from '@open-northland/data';
import {
  Building,
  DeliveryFlag,
  Position,
  Resource,
  ResourceFootprint,
  Signpost,
} from '../../../../components/index.js';
import type { Component, Entity, World } from '../../../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../../../nav/terrain/index.js';
import { sameCells } from '../../geometry.js';
import {
  type BlockerVisit,
  BUILDING_ZONE,
  buildingBlockerCells,
  EXCLUSION,
  eachBlockerCell,
  markerBlockerCells,
  resourceBlockerCells,
  signpostBlockerCells,
} from '../blockers.js';

// The incrementally-maintained work-flag blocked set — the refcounted per-world cache behind
// ../work-flag's placement queries, with its journal replay, rebuild, and coherence verifier.

/** One blocker's blocked nodes (in-bounds, every channel but the margin zones EXCLUSION/BUILDING_ZONE;
 *  duplicates kept so add and removal replay symmetrically). Captured at admit time — the entity may be
 *  destroyed by removal. */
type BlockedCells = readonly NodeId[];

/**
 * The per-world incremental blocked-set state. The refcounted `counts`/`blocked` pair is maintained
 * against the blocker stores' membership journals, so a burst that plants N flags/signposts costs
 * N × O(own footprint) instead of N × O(all blockers) — the rebuild-on-bump memo this replaces made
 * the AI's opening signpost wave quadratic (profiled 0.6–2.4 s single ticks). The memo feeds command
 * gates and sim decisions (`canPlaceWorkFlag`, the auto-flag plant), so the registered `verifyCaches`
 * verifier proves the held set byte-identical to a full {@link buildBlocks} re-derive.
 */
interface IncrementalBlocks {
  readonly content: ContentSet;
  readonly terrain: TerrainGraph;
  /** Held membership generations of the three journal-replayed stores ({@link STATIC_SOURCES}). */
  readonly gens: Map<Component<unknown>, number>;
  /** Held {@link ResourceFootprint} membership generation — journal-replayed like the static sources,
   *  but its deltas resync through the Resource capturer (a footprint stamp/unstamp changes which cells
   *  that resource blocks), so a stamp decoupled from its Resource membership change is still caught. */
  footprintGen: number;
  /** Guard for the one input no journal covers: the in-place tier swap (`touchComponent(Building)`)
   *  changes captured cells with no membership bump — any move forces a full rebuild (rare). */
  buildingValueGen: number;
  /** The marker layer's inputs; a bump re-diffs the whole DeliveryFlag store — O(flags), tiny. */
  flagGen: number;
  flagMoves: number;
  /** Node → standing contribution count; `blocked` holds exactly the keys with a positive count. */
  readonly counts: Map<NodeId, number>;
  readonly blocked: Set<NodeId>;
  readonly resourceCells: Map<Entity, BlockedCells>;
  readonly buildingCells: Map<Entity, BlockedCells>;
  readonly signpostCells: Map<Entity, BlockedCells>;
  readonly flagCells: Map<Entity, BlockedCells>;
}
const blocksMemo = new WeakMap<World, IncrementalBlocks>();

/** One journal-replayed blocker store: its component, member-record map, and per-entity capturer. */
interface StaticBlockerSource {
  readonly component: Component<unknown>;
  readonly members: (state: IncrementalBlocks) => Map<Entity, BlockedCells>;
  readonly capture: (world: World, content: ContentSet, terrain: TerrainGraph, e: Entity) => NodeId[];
}

/** The entity's blocked nodes under `run`'s visitor — the shared channel/bounds filter of every capturer. */
function captureCells(terrain: TerrainGraph, run: (visit: BlockerVisit) => void): NodeId[] {
  const cells: NodeId[] = [];
  run((x, y, channel) => {
    if (channel === EXCLUSION || channel === BUILDING_ZONE) return; // a margin zone is open ground for a flag
    if (terrain.inBounds(x, y)) cells.push(terrain.nodeAt(x, y));
  });
  return cells;
}

const RESOURCE_SOURCE: StaticBlockerSource = {
  component: Resource,
  members: (s) => s.resourceCells,
  capture: (world, _content, terrain, e) => captureCells(terrain, (v) => resourceBlockerCells(world, e, v)),
};

const STATIC_SOURCES: readonly StaticBlockerSource[] = [
  RESOURCE_SOURCE,
  {
    component: Building,
    members: (s) => s.buildingCells,
    capture: (world, content, terrain, e) =>
      captureCells(terrain, (v) => buildingBlockerCells(world, content, e, v)),
  },
  {
    component: Signpost,
    members: (s) => s.signpostCells,
    capture: (world, _content, terrain, e) => captureCells(terrain, (v) => signpostBlockerCells(world, e, v)),
  },
];

function addCells(state: IncrementalBlocks, cells: BlockedCells): void {
  for (const node of cells) {
    const next = (state.counts.get(node) ?? 0) + 1;
    state.counts.set(node, next);
    if (next === 1) state.blocked.add(node);
  }
}

function removeCells(state: IncrementalBlocks, cells: BlockedCells): void {
  for (const node of cells) {
    const next = (state.counts.get(node) ?? 0) - 1;
    if (next <= 0) {
      state.counts.delete(node);
      state.blocked.delete(node);
    } else {
      state.counts.set(node, next);
    }
  }
}

/** Replay one journal entry: drop the held record, then re-admit from live state. Idempotent, so a
 *  same-entity op sequence (add + destroy, remove + re-add) converges on the final membership. */
function resyncEntity(world: World, state: IncrementalBlocks, source: StaticBlockerSource, e: Entity): void {
  const map = source.members(state);
  const held = map.get(e);
  if (held !== undefined) {
    removeCells(state, held);
    map.delete(e);
  }
  if (!world.has(e, source.component)) return;
  const cells = source.capture(world, state.content, state.terrain, e);
  map.set(e, cells);
  addCells(state, cells);
}

/** Re-derive the whole marker layer from the DeliveryFlag store — flags are the one blocker that MOVES
 *  (an in-place Position write the journals cannot see), and the store is small, so any flag change
 *  re-diffs it wholesale in O(flags). */
function refreshMarkerLayer(world: World, state: IncrementalBlocks): void {
  for (const cells of state.flagCells.values()) removeCells(state, cells);
  state.flagCells.clear();
  for (const e of world.query(DeliveryFlag, Position)) {
    const cells = captureCells(state.terrain, (v) => markerBlockerCells(world, e, v));
    state.flagCells.set(e, cells);
    addCells(state, cells);
  }
}

function rebuildState(world: World, content: ContentSet, terrain: TerrainGraph): IncrementalBlocks {
  const gens = new Map<Component<unknown>, number>();
  for (const source of STATIC_SOURCES) {
    world.journalMembership(source.component);
    gens.set(source.component, world.componentGeneration(source.component));
  }
  world.journalMembership(ResourceFootprint);
  const state: IncrementalBlocks = {
    content,
    terrain,
    gens,
    footprintGen: world.componentGeneration(ResourceFootprint),
    buildingValueGen: world.componentValueGeneration(Building),
    flagGen: world.componentGeneration(DeliveryFlag),
    flagMoves: flagMoves.get(world) ?? 0,
    counts: new Map(),
    blocked: new Set(),
    resourceCells: new Map(),
    buildingCells: new Map(),
    signpostCells: new Map(),
    flagCells: new Map(),
  };
  for (const source of STATIC_SOURCES) {
    for (const e of world.query(source.component, Position)) resyncEntity(world, state, source, e);
  }
  refreshMarkerLayer(world, state);
  return state;
}

/** Catch `state` up to the live world via the membership journals; false demands a full rebuild
 *  (a journal gap, or a change on an input the journals cannot cover — see {@link IncrementalBlocks}). */
function catchUp(world: World, state: IncrementalBlocks): boolean {
  if (world.componentValueGeneration(Building) !== state.buildingValueGen) return false;
  // A footprint stamp/unstamp changes which cells its resource blocks — replay its own journal
  // through the Resource capturer, so even a stamp decoupled from a Resource add/destroy resyncs
  // exactly the affected entity (resync is idempotent against the Resource replay below).
  const footprintGen = world.componentGeneration(ResourceFootprint);
  if (footprintGen !== state.footprintGen) {
    const deltas = world.membershipDeltasSince(ResourceFootprint, state.footprintGen);
    if (deltas === null) return false;
    for (const e of deltas) resyncEntity(world, state, RESOURCE_SOURCE, e);
    state.footprintGen = footprintGen;
  }
  for (const source of STATIC_SOURCES) {
    const gen = world.componentGeneration(source.component);
    const held = state.gens.get(source.component) ?? 0;
    if (gen === held) continue;
    const deltas = world.membershipDeltasSince(source.component, held);
    if (deltas === null) return false;
    for (const e of deltas) resyncEntity(world, state, source, e);
    state.gens.set(source.component, gen);
  }
  const flagGen = world.componentGeneration(DeliveryFlag);
  const moves = flagMoves.get(world) ?? 0;
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

/** The nodes a work flag may NOT occupy: every standing resource/building body cell plus the other
 *  markers' cells — every {@link eachBlockerCell} channel except the margin zones ({@link EXCLUSION}
 *  and {@link BUILDING_ZONE}), since a resource/building margin remains valid open ground for a flag.
 *  Backed by the incremental {@link IncrementalBlocks} state, so reads share one refcounted set that
 *  changes cost O(own footprint), and the returned set object mutates in place as the world changes —
 *  read it fresh within a decision, never hold it across sim mutations. The `ignoreFlag` variant (a
 *  flag re-placed over its own cell) withholds that flag's contributions via the refcounts. */
export function workFlagPlacementBlocks(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  ignoreFlag?: Entity,
): ReadonlySet<NodeId> {
  const state = liveBlocks(world, content, terrain);
  if (ignoreFlag === undefined) return state.blocked;
  const held = state.flagCells.get(ignoreFlag);
  if (held === undefined || held.length === 0) return state.blocked;
  // A node the ignored flag covers stays blocked only while another blocker also contributes to it.
  const without = new Set(state.blocked);
  const heldCounts = new Map<NodeId, number>();
  for (const node of held) heldCounts.set(node, (heldCounts.get(node) ?? 0) + 1);
  for (const [node, n] of heldCounts) {
    if ((state.counts.get(node) ?? 0) <= n) without.delete(node);
  }
  return without;
}

/** The {@link blocksMemo} coherence verifier: while the state claims freshness, a full re-derive must
 *  agree — the tripwire for a missed incremental delta or an input the guards fail to see (`verifyCaches`). */
function verifyBlocksMemo(world: World, content: ContentSet, terrain: TerrainGraph): string[] {
  const state = blocksMemo.get(world);
  if (state === undefined || state.content !== content || state.terrain !== terrain) return [];
  if (!isFresh(world, state)) return []; // a pending catch-up — the next read applies it
  const fresh = buildBlocks(world, content, terrain, undefined);
  if (sameCells(state.blocked, fresh)) return [];
  return [
    `workFlagPlacementBlocks holds ${state.blocked.size} nodes but re-derived ${fresh.size} — an incremental delta missed a blocker change`,
  ];
}

/** Whether every input generation matches the held state — the verifier's "claims freshness" gate. */
function isFresh(world: World, state: IncrementalBlocks): boolean {
  return (
    world.componentValueGeneration(Building) === state.buildingValueGen &&
    world.componentGeneration(ResourceFootprint) === state.footprintGen &&
    world.componentGeneration(DeliveryFlag) === state.flagGen &&
    (flagMoves.get(world) ?? 0) === state.flagMoves &&
    STATIC_SOURCES.every((s) => world.componentGeneration(s.component) === (state.gens.get(s.component) ?? 0))
  );
}

function buildBlocks(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  ignoreFlag: Entity | undefined,
): ReadonlySet<NodeId> {
  const blocked = new Set<NodeId>();
  eachBlockerCell(
    world,
    content,
    (x, y, channel) => {
      if (channel === EXCLUSION || channel === BUILDING_ZONE) return; // a margin zone is open ground for a flag
      if (terrain.inBounds(x, y)) blocked.add(terrain.nodeAt(x, y));
    },
    { ignoreFlag },
  );
  return blocked;
}

/** Per-world count of work-flag RELOCATIONS. `componentGeneration` sees only add/remove — a relocate
 *  mutates the flag's `Position` in place, and a flag is the one blocker that moves — so the version
 *  seam counts moves explicitly. Bumped by the single relocate seam (`relocateWorkFlag`). */
const flagMoves = new WeakMap<World, number>();

/** Record one work-flag relocation, invalidating every `workFlagBlockerVersion`-keyed memo. */
export function noteWorkFlagMove(world: World): void {
  flagMoves.set(world, (flagMoves.get(world) ?? 0) + 1);
}

/** The current work-flag relocation count — a `workFlagBlockerVersion` input the generation cannot see. */
export function workFlagMoveCount(world: World): number {
  return flagMoves.get(world) ?? 0;
}
