import { type ContentSet, footprintCellDx } from '@open-northland/data';
import { Building, Position, ResourceFootprint } from '../../components/index.js';
import { landscapeEditState } from '../../components/landscape.js';
import type { Component, Entity, World } from '../../ecs/world.js';
import { type BlockOverlay, LayeredBlocks } from '../../nav/block-overlay.js';
import { ClearanceField, type ClearanceProbe } from '../../nav/clearance.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { landscapeBlocks } from '../landscape/view.js';
import { buildingBlockedCells } from './building-blocked-cache.js';
import { buildingFootprintOf, translatedCells } from './geometry.js';
import { resourceBlockedCells } from './resource-blocked-cache.js';

// The per-world free-size classes vehicles route by, over the ground walk-block (buildings, resources,
// landscapes; never vehicles, which the mover judges against each other at step time). The classes are
// kept current by replaying the two footprinted stores' membership journals: a placed or razed blocker
// re-derives the classes around its own cells, so the update cost is local to the change. Derived state,
// never hashed.

interface ClearanceMemo {
  readonly content: ContentSet;
  readonly terrain: TerrainGraph;
  readonly field: ClearanceField;
  /** Held membership generations of the journal-replayed stores. */
  readonly gens: Map<Component<unknown>, number>;
  /** The tier upgrade swaps `buildingType` in place, a value bump with no membership entry; the held
   *  type per building narrows that bump to the buildings whose cells actually moved. */
  buildingValueGen: number;
  readonly buildingTypes: Map<Entity, number>;
  /** The scripted landscape edits the probe's landscape layer keys on; a resource-backed placement
   *  reaches the memo through the `ResourceFootprint` journal instead. */
  landscapeRevision: number;
  /** The cells each blocker last contributed, so its removal knows what region to re-derive. */
  readonly records: Map<Entity, readonly NodeId[]>;
}

const memoByWorld = new WeakMap<World, ClearanceMemo>();

const SOURCES: readonly Component<unknown>[] = [Building, ResourceFootprint];

/** The ground walk-block a vehicle's clearance is measured against: every dynamic layer but the vehicles. */
export function groundBlockOverlay(world: World, ctx: SystemContext, terrain: TerrainGraph): BlockOverlay {
  return new LayeredBlocks([
    buildingBlockedCells(world, ctx, terrain),
    resourceBlockedCells(world, terrain),
    landscapeBlocks(world, terrain).walk,
  ]);
}

function probeOf(world: World, ctx: SystemContext, terrain: TerrainGraph): ClearanceProbe {
  const blocked = groundBlockOverlay(world, ctx, terrain);
  return (node) => terrain.isWalkable(node) && !blocked.has(node);
}

/** Every cell whose walk-block membership `e` can decide: a building's body plus its door (the door
 *  carve-out), or a resource's walk cells. Empty for a positionless or footprint-less entity. */
function blockerCellsOf(world: World, content: ContentSet, terrain: TerrainGraph, e: Entity): NodeId[] {
  const p = world.tryGet(e, Position);
  if (p === undefined) return [];
  const { hx, hy } = nodeOfPosition(p.x, p.y);
  const building = world.tryGet(e, Building);
  if (building !== undefined) {
    const footprint = buildingFootprintOf(content, building.buildingType);
    if (footprint === undefined) return [];
    const cells = translatedCells(terrain, footprint.blocked, hx, hy);
    const door = footprint.door;
    if (door !== undefined) {
      const doorX = hx + footprintCellDx(hy, door);
      if (terrain.inBounds(doorX, hy + door.dy)) cells.push(terrain.nodeAt(doorX, hy + door.dy));
    }
    return cells;
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

function rebuild(world: World, ctx: SystemContext, terrain: TerrainGraph): ClearanceMemo {
  const gens = new Map<Component<unknown>, number>();
  for (const source of SOURCES) {
    world.journalMembership(source);
    gens.set(source, world.componentGeneration(source));
  }
  const memo: ClearanceMemo = {
    content: ctx.content,
    terrain,
    field: new ClearanceField(terrain, probeOf(world, ctx, terrain)),
    gens,
    buildingValueGen: world.componentValueGeneration(Building),
    buildingTypes: new Map(),
    landscapeRevision: landscapeEditState(world).topologyRevision,
    records: new Map(),
  };
  const ignored = new Set<NodeId>(); // the field was just built over the live overlay
  for (const source of SOURCES) {
    for (const e of world.query(source, Position)) resyncEntity(world, memo, e, ignored);
  }
  return memo;
}

/** Catch the memo up through the journals; false demands a rebuild (a journal gap or a landscape edit). */
function catchUp(world: World, ctx: SystemContext, memo: ClearanceMemo): boolean {
  if (landscapeEditState(world).topologyRevision !== memo.landscapeRevision) return false;
  const changed = new Set<NodeId>();
  for (const source of SOURCES) {
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
    for (const e of world.query(Building, Position)) {
      if (memo.buildingTypes.get(e) !== world.get(e, Building).buildingType)
        resyncEntity(world, memo, e, changed);
    }
    memo.buildingValueGen = buildingValueGen;
  }
  if (changed.size > 0) memo.field.recompute(probeOf(world, ctx, memo.terrain), changed);
  return true;
}

/**
 * The current free-size classes over the ground walk-block. The returned field is the live memo:
 * read it within a decision and never across a blocker change.
 */
export function vehicleClearance(world: World, ctx: SystemContext, terrain: TerrainGraph): ClearanceField {
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
function verifyMemo(world: World, ctx: SystemContext, terrain: TerrainGraph): string[] {
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
    landscapeEditState(world).topologyRevision === memo.landscapeRevision &&
    world.componentValueGeneration(Building) === memo.buildingValueGen &&
    SOURCES.every((source) => world.componentGeneration(source) === (memo.gens.get(source) ?? 0))
  );
}
