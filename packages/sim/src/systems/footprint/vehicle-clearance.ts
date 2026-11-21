import { type ContentSet, type FootprintCell, footprintCellDx } from '@open-northland/data';
import { Building, Palisade, PalisadeBlocking, Position, ResourceFootprint } from '../../components/index.js';
import { landscapeEditState } from '../../components/landscape.js';
import type { ChangeFeed } from '../../ecs/change-feed.js';
import { EntityIntLists } from '../../ecs/entity-int-lists.js';
import type { Component, Entity, World } from '../../ecs/world.js';
import { ClearanceField, type ClearanceProbe } from '../../nav/clearance.js';
import { hexDistanceBetween, nodeHxOfPosition, nodeHyOfPosition } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { ContentContext } from '../context.js';
import { type LandscapeBlocks, landscapeBlocks } from '../landscape/view.js';
import { buildingBlockedCells, placedWalkBody, walkBodyOf } from './building-blocked-cache.js';
import { houseFootprintOf, translatedCells } from './geometry.js';
import { resourceBlockedCells } from './resource-blocked-cache.js';
import { tryFootprintCellsOf } from './resource-footprint-cells.js';
import { standingWallCells } from './standing-walls.js';
import { walkBlockMask } from './walk-block-mask.js';

// The per-world free-size classes vehicles stand by and ships route by, over the ground walk-block
// (buildings and walls, resources, landscapes; never vehicles, which the mover judges against each other
// at step time). Membership changes replay through journals and a resource feed, and scripted
// landscape edits replay the walk cells that entered or left: a placed, finished, swung or razed
// blocker re-derives the classes around its own cells, so the update cost is local to the change. Land vehicles pass narrower gaps (`landVehicleFits`). Derived state, never hashed.

interface ClearanceMemo {
  readonly content: ContentSet;
  readonly terrain: TerrainGraph;
  readonly field: ClearanceField;
  /** Held membership generations of the journal-replayed stores. */
  readonly gens: Map<Component<unknown>, number>;
  readonly resources: ChangeFeed;
  /** The tier upgrade swaps `buildingType` in place, a value bump with no membership entry; the value
   *  journal and the held type per building narrow that bump to the buildings whose cells moved. */
  buildingValueGen: number;
  readonly buildingTypes: Map<Entity, number>;
  /** The scripted landscape edits the probe's landscape layer keys on; a resource-backed placement
   *  reaches the memo through the `resources` feed instead. */
  landscapeRevision: number;
  landscapes: LandscapeBlocks;
  readonly landscapeCells: Set<NodeId>;
  /** The cells each blocker last contributed, so its removal knows what region to re-derive. */
  readonly records: EntityIntLists<NodeId>;
}

/** A blocker's held cells, copied out of {@link ClearanceMemo.records}. */
const heldCells: NodeId[] = [];
/** A blocker's current cells, the first {@link blockerCellsInto} count of them: a scratch that keeps its
 *  room, since one rebuild fills it for every standing resource. */
const currentCells: NodeId[] = [];

const memoByWorld = new WeakMap<World, ClearanceMemo>();
const resourceFeeds = new WeakMap<World, ChangeFeed>();

function resourceFeedOf(world: World): ChangeFeed {
  let feed = resourceFeeds.get(world);
  if (feed === undefined) {
    feed = world.watchChanges([ResourceFootprint], []);
    resourceFeeds.set(world, feed);
  }
  return feed;
}

const ignoreChange = (): void => {};

/** A wall's gate swing and finish re-add `Palisade` or `PalisadeBlocking`, so membership journals see them. */
const SOURCES: readonly Component<unknown>[] = [Building, ResourceFootprint, Palisade, PalisadeBlocking];

/** The probe over the walk-block mask as levelled now: a recompute writes no entity, so it stays current
 *  for the pass that reads it. */
function probeOf(world: World, ctx: ContentContext, terrain: TerrainGraph): ClearanceProbe {
  const blocked = walkBlockMask(world, ctx, terrain).levelled();
  return (node) => (terrain.isWalkable(node) || terrain.isWater(node)) && !blocked.has(node);
}

/** Every cell whose walk-block membership `e` can decide, written to the front of `out`, returning how
 * many: a building's body and door passage, a wall's open and closed footprints, or a resource's walk
 * cells. Indexed loops, since one rebuild runs this cold for every standing resource. */
function blockerCellsInto(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  e: Entity,
  out: NodeId[],
): number {
  const p = world.tryGet(e, Position);
  if (p === undefined) return 0;
  const hx = nodeHxOfPosition(p.x, p.y);
  const hy = nodeHyOfPosition(p.x, p.y);
  let count = 0;
  const building = world.tryGet(e, Building);
  if (building !== undefined) {
    const footprint = houseFootprintOf(content, building);
    if (footprint === undefined) return 0;
    // The building index holds the carved body, except for a footprint that blocks nothing.
    const { body, passage } =
      placedWalkBody(world, content, terrain, e) ?? walkBodyOf(terrain, footprint, hx, hy);
    // `walkBodyOf` carves the passage out of the body, so the two are disjoint.
    for (const cell of body) out[count++] = cell;
    for (let i = 0; i < passage.length; i++) out[count++] = passage[i] as NodeId;
    return count;
  }
  const wall = world.tryGet(e, Palisade);
  if (wall !== undefined) {
    const body = new Set([
      ...translatedCells(terrain, wall.placementWalk, hx, hy),
      ...translatedCells(terrain, wall.walk, hx, hy),
    ]);
    for (const cell of body) out[count++] = cell;
    return count;
  }
  const walk = tryFootprintCellsOf(world, e)?.walk;
  if (walk === undefined) return 0;
  const offsets = walkOffsetsOf(walk);
  const dxSlot = (hy & 1) === 0 ? EVEN_DX_SLOT : ODD_DX_SLOT;
  for (let i = 0; i < offsets.length; i += OFFSET_STRIDE) {
    const x = hx + (offsets[i + dxSlot] ?? 0);
    const y = hy + (offsets[i + DY_SLOT] ?? 0);
    if (terrain.inBounds(x, y)) out[count++] = terrain.nodeAt(x, y);
  }
  return count;
}

/** A walk-cell list's offsets packed per cell as `[dx from an even anchor row, dx from an odd one, dy]`,
 *  so a rebuild over every standing resource reads plain numbers instead of the content's cell objects. */
const EVEN_DX_SLOT = 0;
const ODD_DX_SLOT = 1;
const DY_SLOT = 2;
const OFFSET_STRIDE = 3;
/** Any even and any odd anchor row: only the parity matters. */
const EVEN_ANCHOR_ROW = 0;
const ODD_ANCHOR_ROW = 1;
/** Keyed by the shared, read-only cell list a footprint resolves to. */
const walkOffsets = new WeakMap<readonly Readonly<FootprintCell>[], Int32Array>();

function walkOffsetsOf(walk: readonly Readonly<FootprintCell>[]): Int32Array {
  let offsets = walkOffsets.get(walk);
  if (offsets === undefined) {
    offsets = new Int32Array(walk.length * OFFSET_STRIDE);
    for (let i = 0; i < walk.length; i++) {
      const cell = walk[i] as Readonly<FootprintCell>;
      offsets[i * OFFSET_STRIDE + EVEN_DX_SLOT] = footprintCellDx(EVEN_ANCHOR_ROW, cell);
      offsets[i * OFFSET_STRIDE + ODD_DX_SLOT] = footprintCellDx(ODD_ANCHOR_ROW, cell);
      offsets[i * OFFSET_STRIDE + DY_SLOT] = cell.dy;
    }
    walkOffsets.set(walk, offsets);
  }
  return offsets;
}

/** Replay one journal entry into `changed`: the cells the entity held and the cells it holds now. */
function resyncEntity(world: World, memo: ClearanceMemo, e: Entity, changed: Set<NodeId>): void {
  memo.records.read(e, heldCells);
  for (let i = 0; i < heldCells.length; i++) changed.add(heldCells[i] as NodeId);
  memo.records.delete(e);
  const building = world.tryGet(e, Building);
  if (building === undefined) memo.buildingTypes.delete(e);
  else memo.buildingTypes.set(e, building.buildingType);
  if (!SOURCES.some((source) => world.has(e, source))) return;
  const count = blockerCellsInto(world, memo.content, memo.terrain, e, currentCells);
  memo.records.set(e, currentCells, count);
  for (let i = 0; i < count; i++) changed.add(currentCells[i] as NodeId);
}

function rebuild(world: World, ctx: ContentContext, terrain: TerrainGraph): ClearanceMemo {
  const gens = new Map<Component<unknown>, number>();
  for (const source of SOURCES) {
    if (source !== ResourceFootprint) world.journalMembership(source);
    gens.set(source, world.componentGeneration(source));
  }
  world.journalValueWrites(Building);
  const resources = resourceFeedOf(world);
  resources.drain(ignoreChange);
  const landscapes = landscapeBlocks(world, terrain);
  const memo: ClearanceMemo = {
    content: ctx.content,
    terrain,
    field: new ClearanceField(terrain, probeOf(world, ctx, terrain)),
    gens,
    resources,
    buildingValueGen: world.componentValueGeneration(Building),
    buildingTypes: new Map(),
    landscapeRevision: landscapeEditState(world).topologyRevision,
    landscapes,
    landscapeCells: new Set(landscapes.walk),
    records: new EntityIntLists(),
  };
  recordBlockers(world, memo);
  return memo;
}

/** Hold every standing blocker's cells and building type, as {@link resyncEntity} would, but for a field
 *  just built over the live overlay: no held cells to drop and no region to re-derive. */
function recordBlockers(world: World, memo: ClearanceMemo): void {
  for (let k = 0; k < SOURCES.length; k++) {
    for (const e of world.query(SOURCES[k] as Component<unknown>, Position)) {
      if (inEarlierSource(world, e, k)) continue; // a wall sits in two of the sources
      const building = world.tryGet(e, Building);
      if (building !== undefined) memo.buildingTypes.set(e, building.buildingType);
      const count = blockerCellsInto(world, memo.content, memo.terrain, e, currentCells);
      memo.records.set(e, currentCells, count);
    }
  }
}

/** Whether `e` carries one of the sources before the `k`-th, so an earlier pass recorded it. */
function inEarlierSource(world: World, e: Entity, k: number): boolean {
  for (let j = 0; j < k; j++) if (world.has(e, SOURCES[j] as Component<unknown>)) return true;
  return false;
}

/** Replay the landscape layer's retained cell changes. Sparse reads can outlive the chain; comparing
 * its held cells with the current set still limits clearance recomputation to cells that changed. */
function catchUpLandscapes(world: World, memo: ClearanceMemo, changed: Set<NodeId>): void {
  const revision = landscapeEditState(world).topologyRevision;
  if (revision === memo.landscapeRevision) return;
  const current = landscapeBlocks(world, memo.terrain);
  let view = memo.landscapes;
  while (view !== current && view.next !== undefined) {
    view = view.next;
    for (const change of view.changes) {
      if (change.channel !== 'walk') continue;
      changed.add(change.node);
      if (change.entered) memo.landscapeCells.add(change.node);
      else memo.landscapeCells.delete(change.node);
    }
  }
  if (view !== current) {
    for (const node of memo.landscapeCells) {
      if (!current.walk.has(node)) {
        changed.add(node);
        memo.landscapeCells.delete(node);
      }
    }
    for (const node of current.walk) {
      if (!memo.landscapeCells.has(node)) {
        changed.add(node);
        memo.landscapeCells.add(node);
      }
    }
  }
  memo.landscapes = current;
  memo.landscapeRevision = revision;
}

/** Catch the memo up through the journals; false demands a rebuild after an unrecoverable membership gap. */
function catchUp(world: World, ctx: ContentContext, memo: ClearanceMemo): boolean {
  const changed = new Set<NodeId>();
  catchUpLandscapes(world, memo, changed);
  if (memo.resources.pending && memo.resources.drain((e) => resyncEntity(world, memo, e, changed))) {
    return false;
  }
  memo.gens.set(ResourceFootprint, world.componentGeneration(ResourceFootprint));
  for (const source of SOURCES) {
    if (source === ResourceFootprint) continue;
    const gen = world.componentGeneration(source);
    const held = memo.gens.get(source) ?? 0;
    if (gen === held) continue;
    const deltas = world.membershipDeltasSince(source, held);
    if (deltas === null) return false;
    for (const e of deltas) resyncEntity(world, memo, e, changed);
    memo.gens.set(source, gen);
  }
  const buildingValueGen = world.componentValueGeneration(Building);
  if (buildingValueGen !== memo.buildingValueGen) {
    // A journal gap falls back to comparing every building's type, never to a whole-map rebuild.
    const written =
      world.valueWritesSince(Building, memo.buildingValueGen) ?? world.query(Building, Position);
    for (const e of written) {
      const building = world.tryGet(e, Building);
      if (building === undefined || !world.has(e, Position)) continue;
      if (memo.buildingTypes.get(e) !== building.buildingType) resyncEntity(world, memo, e, changed);
    }
    memo.buildingValueGen = buildingValueGen;
  }
  if (changed.size > 0) memo.field.recompute(probeOf(world, ctx, memo.terrain), changed);
  return true;
}

/**
 * The current free-size classes over the ground walk-block, land and water alike. The returned field
 * is the live memo: read it within a decision and never across a blocker change.
 */
export function vehicleClearance(world: World, ctx: ContentContext, terrain: TerrainGraph): ClearanceField {
  const held = memoByWorld.get(world);
  if (
    held !== undefined &&
    held.content === ctx.content &&
    held.terrain === terrain &&
    (isFresh(world, held) || catchUp(world, ctx, held))
  ) {
    return held.field;
  }
  const fresh = rebuild(world, ctx, terrain);
  memoByWorld.set(world, fresh);
  world.registerCacheVerifier('vehicleClearance', () => verifyMemo(world, ctx, terrain));
  return fresh.field;
}

/** The coherence tripwire: while the memo claims freshness, a field built from scratch must agree. */
function verifyMemo(world: World, ctx: ContentContext, terrain: TerrainGraph): string[] {
  const memo = memoByWorld.get(world);
  if (memo === undefined || memo.content !== ctx.content || memo.terrain !== terrain) return [];
  if (!isFresh(world, memo)) return []; // a pending catch-up - the next read applies it
  const fresh = new ClearanceField(terrain, probeOf(world, ctx, terrain));
  for (let node = 0; node < terrain.nodeCount; node++) {
    const id = node as NodeId;
    if (memo.field.classOf(id) !== fresh.classOf(id)) {
      return [
        `vehicleClearance holds class ${memo.field.classOf(id)} at node ${node} but re-derived ${fresh.classOf(id)} - a blocker change missed its region`,
      ];
    }
  }
  return [];
}

function isFresh(world: World, memo: ClearanceMemo): boolean {
  if (
    memo.resources.pending ||
    landscapeEditState(world).topologyRevision !== memo.landscapeRevision ||
    world.componentValueGeneration(Building) !== memo.buildingValueGen
  ) {
    return false;
  }
  // Indexed: every clearance read asks this first.
  for (let i = 0; i < SOURCES.length; i++) {
    const source = SOURCES[i] as Component<unknown>;
    if (world.componentGeneration(source) !== (memo.gens.get(source) ?? 0)) return false;
  }
  return true;
}

/** Resource cells a land vehicle's disc may overlap beyond its anchor in transit. */
export const RESOURCE_TOLERANCE_NEIGHBOURS = 2;
/** Building cells a land vehicle's disc may overlap beyond its anchor in transit. Walls never count here. */
export const BUILDING_TOLERANCE_NEIGHBOURS = 2;

/**
 * Whether a vehicle of `logicSize` may stop and stand on a node: its free-size class admits it. A
 * standing vehicle's disc blocks other vehicles, so it never rests in a gap it may only pass
 * ({@link landVehicleFits}). Read within one decision, like {@link vehicleClearance}.
 */
export function vehicleStandable(
  world: World,
  ctx: ContentContext,
  terrain: TerrainGraph,
  logicSize: number,
): (node: NodeId) => boolean {
  const clearance = vehicleClearance(world, ctx, terrain);
  return (node) => clearance.classOf(node) >= logicSize;
}

/** Per-terrain answers of the slow {@link landVehicleFits} test, valid for the predicate whose epoch
 *  stamped them, so one route search tests each node once without allocating per search. */
class FitMemo {
  readonly stamps: Uint16Array;
  readonly fits: Uint8Array;
  private epoch = 0;

  constructor(nodeCount: number) {
    this.stamps = new Uint16Array(nodeCount);
    this.fits = new Uint8Array(nodeCount);
  }

  nextEpoch(): number {
    if (this.epoch === MAX_EPOCH) {
      this.stamps.fill(0);
      this.epoch = 0;
    }
    return ++this.epoch;
  }
}

/** Uint16 stamp ceiling; on the wrap the stamps are cleared so no stale slot matches a reused epoch. */
const MAX_EPOCH = 0xffff;
const fitMemos = new WeakMap<TerrainGraph, FitMemo>();

function fitMemoOf(terrain: TerrainGraph): FitMemo {
  let memo = fitMemos.get(terrain);
  if (memo === undefined) {
    memo = new FitMemo(terrain.nodeCount);
    fitMemos.set(terrain, memo);
  }
  return memo;
}

/**
 * Whether a land vehicle of `logicSize` may pass through a node: it is {@link vehicleStandable}, or the
 * anchor is open and the rest of its disc is open land of the anchor's component except for at most
 * {@link RESOURCE_TOLERANCE_NEIGHBOURS} resource cells and {@link BUILDING_TOLERANCE_NEIGHBOURS} building
 * cells. Landscapes, water, unwalkable ground and walls stay hard. Deviation from the original, whose class
 * test admits no overlap: the catapult squeezes between trees and houses like a settler walking by.
 * Allocation-free and memoized per predicate, since an A* search asks it for every neighbour it relaxes;
 * an older predicate read after a newer one was made loses memo hits, never answers, while fewer than
 * 65535 newer ones are made in its life: the Uint16 epoch then wraps onto its own. Read within one
 * decision, like {@link vehicleClearance}.
 */
export function landVehicleFits(
  world: World,
  ctx: ContentContext,
  terrain: TerrainGraph,
  logicSize: number,
): (node: NodeId) => boolean {
  const standable = vehicleStandable(world, ctx, terrain, logicSize);
  if (logicSize < 1) return standable;
  const buildings = buildingBlockedCells(world, ctx, terrain);
  const resources = resourceBlockedCells(world, terrain);
  const landscapes = landscapeBlocks(world, terrain).walk;
  const walls = standingWallCells(world, terrain).walls;
  const memo = fitMemoOf(terrain);
  const epoch = memo.nextEpoch();
  return (node) => {
    if (standable(node)) return true;
    if (memo.stamps[node] === epoch) return memo.fits[node] === 1;
    const fits = squeezes(node);
    memo.stamps[node] = epoch;
    memo.fits[node] = fits ? 1 : 0;
    return fits;
  };
  function squeezes(node: NodeId): boolean {
    if (!terrain.isWalkable(node) || buildings.has(node) || resources.has(node) || landscapes.has(node)) {
      return false;
    }
    const component = terrain.componentOf(node);
    const cx = terrain.xOf(node);
    const cy = terrain.yOf(node);
    let resourceCells = 0;
    let buildingCells = 0;
    // The disc's bounding box: `logicSize` rows either way and one column of odd-row lean beyond it.
    for (let y = cy - logicSize; y <= cy + logicSize; y++) {
      for (let x = cx - logicSize - 1; x <= cx + logicSize + 1; x++) {
        if (hexDistanceBetween(cx, cy, x, y) > logicSize || (x === cx && y === cy)) continue;
        if (!terrain.inBounds(x, y)) return false;
        const cell = terrain.nodeAt(x, y);
        if (!terrain.isWalkable(cell) || terrain.componentOf(cell) !== component || landscapes.has(cell)) {
          return false;
        }
        if (buildings.has(cell)) {
          if (++buildingCells > BUILDING_TOLERANCE_NEIGHBOURS || walls.has(cell)) return false;
        } else if (resources.has(cell) && ++resourceCells > RESOURCE_TOLERANCE_NEIGHBOURS) {
          return false;
        }
      }
    }
    return true;
  }
}
