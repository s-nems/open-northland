import type { ContentSet, FootprintCell } from '@open-northland/data';
import { Position, ResourceFootprint } from '../../components/index.js';
import { landscapeEditState, writeLandscapeEdits } from '../../components/landscape.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import { type HalfCellNode, hexDistance, nodeOfPosition } from '../../nav/halfcell.js';
import type {
  LandscapeRemovalGroup,
  NodeId,
  ResourceSpec,
  ScriptLandscapeType,
  TerrainGraph,
} from '../../nav/terrain/index.js';
import { chestFootprint, chestRecord } from '../chests/footprint.js';
import { createChest } from '../chests/index.js';
import type { SystemContext } from '../context.js';
import { createBerryBush } from '../economy/berries.js';
import { createGroundGoods } from '../economy/ground-goods.js';
import { translatedCells } from '../footprint/geometry.js';
import {
  createResourceNode,
  stampResourceFootprintData,
  unstampResourceFootprint,
} from '../footprint/resources.js';
import { authoredLandscapes, landscapeResources, landscapesWithin, landscapeTypes } from './view.js';

/** Remove every standing placement within `range` of `point`, with their backing resources. Returns
 *  the walk cells they blocked, for a caller judging whether a later placement closes anything new. */
export function removeLandscapes(
  world: World,
  terrain: TerrainGraph,
  point: HalfCellNode,
  range: number,
  group?: LandscapeRemovalGroup,
  onResourceRemoved?: (entity: Entity) => void,
): NodeId[] {
  const types = landscapeTypes(terrain);
  const matches = landscapesWithin(world, terrain, point, range).filter(
    (p) => group === undefined || types.get(p.typeId)?.groups.includes(group),
  );
  const freed: NodeId[] = [];
  if (matches.length === 0) return freed;
  const ids = new Set(matches.map((p) => p.id));
  const resources = landscapeResources(world);
  for (const placement of matches) {
    for (const entity of resources.get(placement.id) ?? []) {
      const footprint = world.tryGet(entity, ResourceFootprint);
      const at = world.tryGet(entity, Position);
      if (footprint !== undefined && at !== undefined) {
        const anchor = nodeOfPosition(at.x, at.y);
        freed.push(...translatedCells(terrain, footprint.walk, anchor.hx, anchor.hy));
      }
      unstampResourceFootprint(world, entity);
      world.destroy(entity);
      onResourceRemoved?.(entity);
    }
    if (placement.resourceBacked !== true) {
      const walk = types.get(placement.typeId)?.walk ?? [];
      freed.push(...translatedCells(terrain, walk, placement.hx, placement.hy));
    }
  }
  const authored = authoredLandscapes(terrain).byId;
  writeLandscapeEdits(world, (state) => {
    state.topologyRevision++;
    const removed = new Set(state.removed);
    for (const id of ids) if (authored.has(id)) removed.add(id);
    state.removed = [...removed].sort((a, b) => a - b);
    state.added = state.added.filter((p) => !ids.has(p.id));
  });
  return freed;
}

/** What stands in for a placement of a type: the one entity kind its backing creates, or none for
 *  decor and a bare fruit bush. One reading shared by the backing, its walk cells and the layer flag,
 *  so the three cannot disagree on a type. */
type PlacementBacking =
  | { readonly kind: 'chest'; readonly chest: NonNullable<ScriptLandscapeType['chest']> }
  | { readonly kind: 'good'; readonly goodId: string }
  | { readonly kind: 'resource'; readonly resource: ResourceSpec }
  | { readonly kind: 'none' };

function placementBackingOf(type: ScriptLandscapeType): PlacementBacking {
  if (type.chest !== undefined) return { kind: 'chest', chest: type.chest };
  if (type.good !== undefined) return { kind: 'good', goodId: type.good.goodId };
  if (type.resource !== undefined) return { kind: 'resource', resource: type.resource };
  return { kind: 'none' };
}

/**
 * The live entity standing in for a scripted placement of `type`: a chest, a goods heap or a resource
 * node, each created before the old object is removed so a rejected replacement leaves the world as it
 * was. `undefined` for a decor type; null when the type cannot be placed - a resource with no footprint
 * or a good the world's content lacks.
 */
function createPlacementBacking(
  world: World,
  ctx: SystemContext,
  type: ScriptLandscapeType,
  point: HalfCellNode,
  level: number,
  landscapeId: number,
): Entity | null | undefined {
  const at = { x: point.hx, y: point.hy, landscapeId };
  const backing = placementBackingOf(type);
  switch (backing.kind) {
    case 'chest':
      return createChest(world, ctx.content, { ...backing.chest, contents: level, ...at });
    case 'good': {
      const goodType = contentIndex(ctx.content).goodTypeBySlug.get(backing.goodId);
      if (goodType === undefined) return null;
      return createGroundGoods(world, { goodType, amount: level, ...at });
    }
    case 'resource': {
      const spec = backing.resource;
      const deposit = spec.deposit;
      const initial = deposit?.initial ?? spec.remaining;
      const remaining =
        deposit !== undefined && deposit.levels > 0
          ? Math.min(initial, Math.max(1, Math.floor((initial * level) / deposit.levels)))
          : spec.remaining;
      const resource = createResourceNode(world, ctx.content, { ...spec, remaining, ...at });
      if (resource === null) return null;
      const footprint = world.get(resource, ResourceFootprint);
      stampResourceFootprintData(world, resource, {
        walk: type.walk.map((cell) => ({ ...cell })),
        build: type.build.map((cell) => ({ ...cell })),
        work: footprint.work.map((cell) => ({ ...cell })),
        ...(footprint.sourceGfxIndex !== undefined ? { sourceGfxIndex: footprint.sourceGfxIndex } : {}),
      });
      return resource;
    }
    case 'none':
      return undefined;
  }
}

/** The cells a placement of `type` blocks for walking, as its backing or the landscape layer stamps
 *  them: a chest its record's footprint, a goods heap and a bush none, the rest the type's own. */
export function placementWalkCells(content: ContentSet, type: ScriptLandscapeType): readonly FootprintCell[] {
  const backing = placementBackingOf(type);
  switch (backing.kind) {
    case 'chest':
      return chestFootprint(chestRecord(content, backing.chest.kind, backing.chest.gfxIndex)).walk;
    case 'good':
      return [];
    case 'resource':
      return type.walk;
    case 'none':
      return type.bushGfxIndex !== undefined ? [] : type.walk;
  }
}

export function setLandscape(
  world: World,
  ctx: SystemContext,
  point: HalfCellNode,
  typeId: number,
  level: number,
): boolean {
  const terrain = ctx.terrain;
  if (terrain?.landscapes === undefined || !terrain.inBounds(point.hx, point.hy)) return false;
  const type = landscapeTypes(terrain).get(typeId);
  if (type === undefined) return false;
  const state = landscapeEditState(world);
  const id = Math.max(state.nextId, authoredLandscapes(terrain).nextId);
  const resource = createPlacementBacking(world, ctx, type, point, level, id);
  if (resource === null) return false;
  removeLandscapes(world, terrain, point, 0, undefined, (entity) =>
    ctx.events.emit({ kind: 'missionLandscapeResourceRemoved', entity }),
  );
  if (type.bushGfxIndex !== undefined)
    createBerryBush(world, { x: point.hx, y: point.hy, gfxIndex: type.bushGfxIndex, landscapeId: id });
  writeLandscapeEdits(world, (edit) => {
    edit.topologyRevision++;
    edit.nextId = id + 1;
    edit.added.push({
      id,
      typeId,
      hx: point.hx,
      hy: point.hy,
      level,
      ...(placementBackingOf(type).kind !== 'none' || type.bushGfxIndex !== undefined
        ? { resourceBacked: true }
        : {}),
    });
  });
  return true;
}

export function forNodesInArea(
  terrain: TerrainGraph,
  point: HalfCellNode,
  range: number,
  apply: (node: NodeId, hx: number, hy: number) => void,
): void {
  for (let hy = Math.max(0, point.hy - range); hy <= Math.min(terrain.height - 1, point.hy + range); hy++) {
    for (let hx = Math.max(0, point.hx - range); hx <= Math.min(terrain.width - 1, point.hx + range); hx++) {
      if (hexDistance({ hx, hy }, point) <= range) apply(terrain.nodeAt(hx, hy), hx, hy);
    }
  }
}

export function setBuildForbidden(
  world: World,
  terrain: TerrainGraph,
  point: HalfCellNode,
  range: number,
  flag: boolean,
): void {
  const current = landscapeEditState(world);
  const changed: NodeId[] = [];
  forNodesInArea(terrain, point, range, (node) => {
    if (current.forbidden.has(node) !== flag) changed.push(node);
  });
  if (changed.length === 0) return;
  writeLandscapeEdits(world, (state) => {
    state.forbiddenRevision++;
    for (const node of changed) {
      if (flag) state.forbidden.set(node, true);
      else state.forbidden.delete(node);
    }
  });
}

export function setVertexColors(
  world: World,
  terrain: TerrainGraph,
  point: HalfCellNode,
  range: number,
  amount: number,
  onLand: boolean,
): boolean {
  if (onLand && terrain.landVertices === undefined) return false;
  const value = Math.max(0, Math.min(255, amount));
  const current = landscapeEditState(world);
  const changed: NodeId[] = [];
  forNodesInArea(terrain, point, range, (node) => {
    if ((!onLand || terrain.landVertices?.[node] === true) && current.tints.get(node) !== value)
      changed.push(node);
  });
  if (changed.length === 0) return true;
  writeLandscapeEdits(world, (state) => {
    for (const node of changed) state.tints.set(node, value);
  });
  return true;
}
