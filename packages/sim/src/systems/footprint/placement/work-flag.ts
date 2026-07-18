import type { ContentSet } from '@open-northland/data';
import {
  Building,
  DeliveryFlag,
  Position,
  Resource,
  ResourceFootprint,
  Signpost,
} from '../../../components/index.js';
import type { Component, Entity, World } from '../../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { forEachRingOffset, sameCells } from '../geometry.js';
import {
  type BlockerVisit,
  BUILDING_ZONE,
  buildingBlockerCells,
  EXCLUSION,
  eachBlockerCell,
  markerBlockerCells,
  placementBlockerVersion,
  resourceBlockerCells,
  signpostBlockerCells,
} from './blockers.js';

// WORK-FLAG PLACEMENT — where a work flag (and, through canPlaceWorkFlag, a signpost) may stand: the same
// ./blockers.ts scan the building rule reads, minus the margin channels (EXCLUSION + BUILDING_ZONE) and
// plus the markers.

/** One blocker's blocked nodes (in-bounds, every channel but the margin zones EXCLUSION/BUILDING_ZONE;
 *  duplicates kept so add and removal replay symmetrically). Captured at admit time — the entity may be
 *  destroyed by removal. */
type BlockedCells = readonly NodeId[];

/**
 * The per-world INCREMENTAL blocked-set state. The refcounted `counts`/`blocked` pair is maintained
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
  /** Guards for inputs the journals cannot cover — any change forces a full rebuild (all rare):
   *  the in-place tier swap (`touchComponent(Building)`) and a footprint stamp decoupled from its
   *  Resource membership change (outside the bundled-step invariant `placementBlockerVersion` documents). */
  footprintGen: number;
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

const STATIC_SOURCES: readonly StaticBlockerSource[] = [
  {
    component: Resource,
    members: (s) => s.resourceCells,
    capture: (world, _content, terrain, e) => captureCells(terrain, (v) => resourceBlockerCells(world, e, v)),
  },
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
  const footprintGen = world.componentGeneration(ResourceFootprint);
  const heldResourceGen = state.gens.get(Resource) ?? 0;
  if (footprintGen !== state.footprintGen && world.componentGeneration(Resource) === heldResourceGen) {
    return false;
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
  state.footprintGen = footprintGen;
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

export function canPlaceWorkFlag(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  node: NodeId,
  ignoreFlag?: Entity,
): boolean {
  return (
    terrain.isWalkable(node) && !workFlagPlacementBlocks(world, ctx.content, terrain, ignoreFlag).has(node)
  );
}

/**
 * The greatest Manhattan ring radius {@link nearestWorkFlagPlacement} expands before falling back to
 * the whole-map reference scan. The cap only bounds the cost of a hopeless neighbourhood — the
 * fallback reproduces the exact linear winner past it — so it is a pure performance knob, not a
 * decoded distance (named approximation; the `RING_MAX_RADIUS` convention).
 */
const PLACEMENT_RING_MAX_RADIUS = 48;

/** The nearest legal work-flag node to `from`, by Manhattan distance then node id. Auto-created flags use
 * this when a gatherer spawns or changes trade, because its feet may currently be inside a resource or
 * building body. This is a one-shot command/spawn query, never per-tick planner work — but it runs once
 * per employment command, so a box-select `setJob` burst pays it per settler: expanding rings, never a
 * whole-map scan, below the cap. */
export function nearestWorkFlagPlacement(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  from: NodeId,
): NodeId | null {
  const origin = terrain.coordsOf(from);
  const blocked = workFlagPlacementBlocks(world, ctx.content, terrain);
  // The first ring holding a legal node ends the search; its lowest node id is the same
  // `(distance, node-id)` winner the reference scan below picks.
  for (let r = 0; r <= PLACEMENT_RING_MAX_RADIUS; r++) {
    let ringBest: NodeId | null = null;
    forEachRingOffset(r, (dx, dy) => {
      const x = origin.x + dx;
      const y = origin.y + dy;
      if (!terrain.inBounds(x, y)) return;
      const node = terrain.nodeAt(x, y);
      if (!terrain.isWalkable(node) || blocked.has(node)) return;
      if (ringBest === null || node < ringBest) ringBest = node;
    });
    if (ringBest !== null) return ringBest;
  }
  // Nothing within the cap. The rings covered every node at distance ≤ cap, so only farther nodes can
  // match — the whole-map reference scan finds the same winner the uncapped search would.
  let best: NodeId | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let node = 0; node < terrain.nodeCount; node++) {
    const candidate = node as NodeId;
    if (!terrain.isWalkable(candidate) || blocked.has(candidate)) continue;
    const c = terrain.coordsOf(candidate);
    const distance = Math.abs(c.x - origin.x) + Math.abs(c.y - origin.y);
    if (distance < bestDistance || (distance === bestDistance && (best === null || candidate < best))) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

/** Per-world count of work-flag RELOCATIONS. `componentGeneration` sees only add/remove — a relocate
 *  mutates the flag's `Position` in place, and a flag is the one blocker that moves — so the version
 *  below counts moves explicitly. Bumped by the single relocate seam (`relocateWorkFlag`). */
const flagMoves = new WeakMap<World, number>();

/** Record one work-flag relocation, invalidating every {@link workFlagBlockerVersion}-keyed memo. */
export function noteWorkFlagMove(world: World): void {
  flagMoves.set(world, (flagMoves.get(world) ?? 0) + 1);
}

/**
 * The version of the WORK-FLAG blocker inputs — {@link placementBlockerVersion} plus the `DeliveryFlag`
 * generation, since this rule also consumes the marker channel the building rule ignores, plus the
 * flag-MOVE count the generation cannot see. The signpost placement overlay keys its memoized band
 * probe on this.
 */
export function workFlagBlockerVersion(world: World): string {
  return `${placementBlockerVersion(world)}.${world.componentGeneration(DeliveryFlag)}.${flagMoves.get(world) ?? 0}`;
}
