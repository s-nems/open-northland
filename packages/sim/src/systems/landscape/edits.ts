import { ResourceFootprint } from '../../components/index.js';
import { landscapeEditState, writeLandscapeEdits } from '../../components/landscape.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import { type HalfCellNode, hexDistance } from '../../nav/halfcell.js';
import type {
  LandscapeRemovalGroup,
  NodeId,
  ScriptLandscapeType,
  TerrainGraph,
} from '../../nav/terrain/index.js';
import { createChest } from '../chests/index.js';
import type { SystemContext } from '../context.js';
import { createBerryBush } from '../economy/berries.js';
import { createGroundGoods } from '../economy/ground-goods.js';
import {
  createResourceNode,
  stampResourceFootprintData,
  unstampResourceFootprint,
} from '../footprint/resources.js';
import { landscapeView } from './view.js';

export function removeLandscapes(
  world: World,
  terrain: TerrainGraph,
  point: HalfCellNode,
  range: number,
  group?: LandscapeRemovalGroup,
  onResourceRemoved?: (entity: Entity) => void,
): void {
  const view = landscapeView(world, terrain);
  const matches = view.placements.filter(
    (p) =>
      hexDistance(p, point) <= range &&
      (group === undefined || view.types.get(p.typeId)?.groups.includes(group)),
  );
  if (matches.length === 0) return;
  const ids = new Set(matches.map((p) => p.id));
  for (const id of ids) {
    for (const entity of view.resources.get(id) ?? []) {
      unstampResourceFootprint(world, entity);
      world.destroy(entity);
      onResourceRemoved?.(entity);
    }
  }
  writeLandscapeEdits(world, (state) => {
    state.topologyRevision++;
    const authored = new Set(terrain.landscapes?.placements.map((p) => p.id));
    const removed = new Set(state.removed);
    for (const id of ids) if (authored.has(id)) removed.add(id);
    state.removed = [...removed].sort((a, b) => a - b);
    state.added = state.added.filter((p) => !ids.has(p.id));
  });
}

const firstFreeIds = new WeakMap<TerrainGraph, number>();

/** One past the highest authored placement id, found once per map. */
function firstFreeId(terrain: TerrainGraph): number {
  let id = firstFreeIds.get(terrain);
  if (id === undefined) {
    id = 0;
    for (const placement of terrain.landscapes?.placements ?? []) id = Math.max(id, placement.id + 1);
    firstFreeIds.set(terrain, id);
  }
  return id;
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
  if (type.chest !== undefined) {
    return createChest(world, ctx.content, { ...type.chest, contents: level, ...at });
  }
  if (type.good !== undefined) {
    const goodType = contentIndex(ctx.content).goodTypeBySlug.get(type.good.goodId);
    if (goodType === undefined) return null;
    return createGroundGoods(world, { goodType, amount: level, ...at });
  }
  if (type.resource === undefined) return undefined;
  const deposit = type.resource.deposit;
  const initial = deposit?.initial ?? type.resource.remaining;
  const remaining =
    deposit !== undefined && deposit.levels > 0
      ? Math.min(initial, Math.max(1, Math.floor((initial * level) / deposit.levels)))
      : type.resource.remaining;
  const resource = createResourceNode(world, ctx.content, { ...type.resource, remaining, ...at });
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

export function setLandscape(
  world: World,
  ctx: SystemContext,
  point: HalfCellNode,
  typeId: number,
  level: number,
): boolean {
  const terrain = ctx.terrain;
  if (terrain?.landscapes === undefined || !terrain.inBounds(point.hx, point.hy)) return false;
  const type = landscapeView(world, terrain).types.get(typeId);
  if (type === undefined) return false;
  const state = landscapeEditState(world);
  const id = Math.max(state.nextId, firstFreeId(terrain));
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
      ...(resource !== undefined || type.bushGfxIndex !== undefined ? { resourceBacked: true } : {}),
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
