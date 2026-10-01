import { type ContentSet, footprintCellDx } from '@open-northland/data';
import { Building, Palisade, PalisadeBlocking, Position, ResourceFootprint } from '../../components/index.js';
import { landscapeEditState } from '../../components/landscape.js';
import type { ChangeFeed } from '../../ecs/change-feed.js';
import type { Component, Entity, World } from '../../ecs/world.js';
import { type BlockOverlay, LayeredBlocks } from '../../nav/block-overlay.js';
import { ClearanceField, type ClearanceProbe } from '../../nav/clearance.js';
import { HEX_NEIGHBOUR_OFFSETS, hexDistanceBetween, nodeOfPosition } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { ContentContext } from '../context.js';
import { type LandscapeBlocks, landscapeBlocks } from '../landscape/view.js';
import { buildingBlockedCells } from './building-blocked-cache.js';
import { buildingFootprintOf, translatedCells } from './geometry.js';
import { resourceBlockedCells } from './resource-blocked-cache.js';
import { standingWallCells } from './wall-joints.js';

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
  readonly records: Map<Entity, readonly NodeId[]>;
}

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

/** The ground walk-block a vehicle's clearance is measured against: every dynamic layer but the vehicles. */
export function groundBlockOverlay(world: World, ctx: ContentContext, terrain: TerrainGraph): BlockOverlay {
  return new LayeredBlocks([
    buildingBlockedCells(world, ctx, terrain),
    resourceBlockedCells(world, terrain),
    landscapeBlocks(world, terrain).walk,
  ]);
}

function probeOf(world: World, ctx: ContentContext, terrain: TerrainGraph): ClearanceProbe {
  const blocked = groundBlockOverlay(world, ctx, terrain);
  return (node) => (terrain.isWalkable(node) || terrain.isWater(node)) && !blocked.has(node);
}

/** Every cell whose walk-block membership `e` can decide: a building's body plus its door (the door
 *  carve-out), a wall's whole placement body (its joint seals lie beside it, inside the recompute reach),
 *  or a resource's walk cells. Empty for a positionless or footprint-less entity. */
function blockerCellsOf(world: World, content: ContentSet, terrain: TerrainGraph, e: Entity): NodeId[] {
  const p = world.tryGet(e, Position);
  if (p === undefined) return [];
  const { hx, hy } = nodeOfPosition(p.x, p.y);
  const building = world.tryGet(e, Building);
  if (building !== undefined) {
    const footprint = buildingFootprintOf(content, building.buildingType, building.tribe);
    if (footprint === undefined) return [];
    const cells = translatedCells(terrain, footprint.blocked, hx, hy);
    const door = footprint.door;
    if (door !== undefined) {
      const doorX = hx + footprintCellDx(hy, door);
      if (terrain.inBounds(doorX, hy + door.dy)) cells.push(terrain.nodeAt(doorX, hy + door.dy));
    }
    return cells;
  }
  const wall = world.tryGet(e, Palisade);
  if (wall !== undefined) {
    return [
      ...new Set([
        ...translatedCells(terrain, wall.placementWalk, hx, hy),
        ...translatedCells(terrain, wall.walk, hx, hy),
      ]),
    ];
  }
  const resource = world.tryGet(e, ResourceFootprint);
  return resource === undefined ? [] : translatedCells(terrain, resource.walk, hx, hy);
}

/** Replay one journal entry into `changed`: the cells the entity held and the cells it holds now. */
function resyncEntity(world: World, memo: ClearanceMemo, e: Entity, changed: Set<NodeId>): void {
  for (const node of memo.records.get(e) ?? []) changed.add(node);
  memo.records.delete(e);
  const building = world.tryGet(e, Building);
  if (building === undefined) memo.buildingTypes.delete(e);
  else memo.buildingTypes.set(e, building.buildingType);
  if (!SOURCES.some((source) => world.has(e, source))) return;
  const cells = blockerCellsOf(world, memo.content, memo.terrain, e);
  memo.records.set(e, cells);
  for (const node of cells) changed.add(node);
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
    records: new Map(),
  };
  const ignored = new Set<NodeId>(); // the field was just built over the live overlay
  for (const source of SOURCES) {
    for (const e of world.query(source, Position)) resyncEntity(world, memo, e, ignored);
  }
  return memo;
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
    catchUp(world, ctx, held)
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
  return (
    !memo.resources.pending &&
    landscapeEditState(world).topologyRevision === memo.landscapeRevision &&
    world.componentValueGeneration(Building) === memo.buildingValueGen &&
    SOURCES.every((source) => world.componentGeneration(source) === (memo.gens.get(source) ?? 0))
  );
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
  readonly stamps: Uint32Array;
  readonly fits: Uint8Array;
  private epoch = 0;

  constructor(nodeCount: number) {
    this.stamps = new Uint32Array(nodeCount);
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

const MAX_EPOCH = 0xffffffff;
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
 * cells. Landscapes, water, unwalkable ground and walls stay hard; a building cell on or beside a wall
 * cell counts as wall, which also covers the wall joint seals. Deviation from the original, whose class
 * test admits no overlap: the catapult squeezes between trees and houses like a settler walking by.
 * Allocation-free and memoized per predicate, since an A* search asks it for every neighbour it relaxes;
 * an older predicate read after a newer one was made loses memo hits, never answers. Read within one
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
  const touchesWall = (node: NodeId): boolean => {
    if (walls.has(node)) return true;
    const x = terrain.xOf(node);
    const y = terrain.yOf(node);
    for (const offset of HEX_NEIGHBOUR_OFFSETS) {
      const nx = x + footprintCellDx(y, offset);
      const ny = y + offset.dy;
      if (terrain.inBounds(nx, ny) && walls.has(terrain.nodeAt(nx, ny))) return true;
    }
    return false;
  };
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
          if (++buildingCells > BUILDING_TOLERANCE_NEIGHBOURS || touchesWall(cell)) return false;
        } else if (resources.has(cell) && ++resourceCells > RESOURCE_TOLERANCE_NEIGHBOURS) {
          return false;
        }
      }
    }
    return true;
  }
}
