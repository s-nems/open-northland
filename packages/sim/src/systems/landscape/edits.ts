import { type ContentSet, type FootprintCell, GROUND_LAND, GROUND_WATER } from '@open-northland/data';
import { Palisade, Position, ResourceFootprint, type ResourceFootprintData } from '../../components/index.js';
import { landscapeEditState, writeLandscapeEdits } from '../../components/landscape.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import {
  cellAnchorNode,
  cellOfNode,
  type HalfCellNode,
  hexDistance,
  hexDistanceBetween,
  nodeOfPosition,
} from '../../nav/halfcell.js';
import type {
  LandscapeGround,
  LandscapeRemovalGroup,
  NodeId,
  ResourceSpec,
  ScriptLandscapePlacement,
  ScriptLandscapeType,
  TerrainGraph,
} from '../../nav/terrain/index.js';
import { chestFootprint, chestRecord } from '../chests/footprint.js';
import { createChest } from '../chests/index.js';
import type { SystemContext } from '../context.js';
import { createBerryBush } from '../economy/berries.js';
import { createGroundGoods } from '../economy/ground-goods.js';
import { dynamicBlockOverlay } from '../footprint/blocked.js';
import { buildingBodyCells } from '../footprint/building-blocked-cache.js';
import { translatedCells } from '../footprint/geometry.js';
import { placementBlockerGrid } from '../footprint/placement/blocker-grid.js';
import { palisadeBodyCells } from '../footprint/placement/blockers.js';
import {
  contentFootprintCells,
  resourceFootprintCells,
  tryFootprintCellsOf,
} from '../footprint/resource-footprint-cells.js';
import {
  createResourceNode,
  stampResourceFootprintData,
  unstampResourceFootprint,
} from '../footprint/resources.js';
import { removePalisade } from '../palisades/index.js';
import { placementBlockCells } from './footprint.js';
import {
  authoredLandscapes,
  landscapeAttachNodes,
  landscapeResources,
  landscapesWithin,
  landscapeTypes,
} from './view.js';

/** Cells this close to a map edge are the original's map border, where a script neither lays nor
 *  removes a landscape and an `OnLand` write paints nothing. */
const BORDER_CELLS = 2;

function isBorderCell(terrain: TerrainGraph, cx: number, cy: number): boolean {
  return (
    cx < BORDER_CELLS ||
    cy < BORDER_CELLS ||
    cx >= terrain.cellColumns - BORDER_CELLS ||
    cy >= terrain.cellRows - BORDER_CELLS
  );
}

function isBorderPoint(terrain: TerrainGraph, point: HalfCellNode): boolean {
  const { cx, cy } = cellOfNode(point.hx, point.hy);
  return isBorderCell(terrain, cx, cy);
}

/** Remove every standing placement within `range` of `point`, with their backing resources and walls.
 *  Returns the walk cells they blocked, for a caller judging whether a later placement closes anything new. */
export function removeLandscapes(
  world: World,
  ctx: SystemContext,
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
  return removePlacements(world, ctx, terrain, matches, onResourceRemoved);
}

/** A script removal: {@link removeLandscapes}, except that, as in the original, it leaves standing
 *  what is anchored on the map border. */
export function removeScriptedLandscapes(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  point: HalfCellNode,
  range: number,
  group: LandscapeRemovalGroup | undefined,
  onResourceRemoved: (entity: Entity) => void,
): NodeId[] {
  const types = landscapeTypes(terrain);
  const matches = landscapesWithin(world, terrain, point, range).filter(
    (p) => (group === undefined || types.get(p.typeId)?.groups.includes(group)) && !isBorderPoint(terrain, p),
  );
  return removePlacements(world, ctx, terrain, matches, onResourceRemoved);
}

function removePlacements(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  matches: readonly ScriptLandscapePlacement[],
  onResourceRemoved: ((entity: Entity) => void) | undefined,
): NodeId[] {
  const types = landscapeTypes(terrain);
  const freed: NodeId[] = [];
  if (matches.length === 0) return freed;
  const ids = new Set(matches.map((p) => p.id));
  const resources = landscapeResources(world);
  for (const placement of matches) {
    for (const entity of resources.entitiesOf(placement.id)) {
      if (world.has(entity, Palisade)) {
        palisadeBodyCells(world, entity, (hx, hy) => {
          if (terrain.inBounds(hx, hy)) freed.push(terrain.nodeAt(hx, hy));
        });
        removePalisade(world, ctx, entity);
        onResourceRemoved?.(entity);
        continue;
      }
      const footprint = tryFootprintCellsOf(world, entity);
      const at = world.tryGet(entity, Position);
      if (footprint !== undefined && at !== undefined) {
        const anchor = nodeOfPosition(at.x, at.y);
        freed.push(...translatedCells(terrain, footprint.walk, anchor.hx, anchor.hy));
      }
      unstampResourceFootprint(world, entity);
      world.destroy(entity);
      onResourceRemoved?.(entity);
    }
    const type = types.get(placement.typeId);
    if (placement.resourceBacked !== true && type !== undefined) {
      const { walk } = placementBlockCells(type, placement.level);
      freed.push(...translatedCells(terrain, walk, placement.hx, placement.hy));
    }
  }
  const authored = authoredLandscapes(terrain);
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

/** A scripted resource placement blocks as `type` at `level` and is worked from its node's own record:
 *  the record's key at that level when it names the same cells, else those cells written out. */
function scriptedFootprint(
  world: World,
  resource: Entity,
  type: ScriptLandscapeType,
  level: number,
): ResourceFootprintData {
  const blocks = placementBlockCells(type, level);
  const own = world.get(resource, ResourceFootprint);
  const cells = resourceFootprintCells(world, own);
  if ('gfx' in own && own.buildFree !== true) {
    const leveled: ResourceFootprintData = { gfx: own.gfx, level };
    const resolved = resourceFootprintCells(world, leveled);
    if (sameCellList(resolved.walk, blocks.walk) && sameCellList(resolved.build, blocks.build))
      return leveled;
  }
  return {
    walk: blocks.walk.map((cell) => ({ ...cell })),
    build: blocks.build.map((cell) => ({ ...cell })),
    work: cells.work.map((cell) => ({ ...cell })),
    ...(cells.sourceGfxIndex !== undefined ? { sourceGfxIndex: cells.sourceGfxIndex } : {}),
  };
}

function sameCellList(a: readonly FootprintCell[], b: readonly FootprintCell[]): boolean {
  return a.length === b.length && a.every((cell, i) => cell.dx === b[i]?.dx && cell.dy === b[i]?.dy);
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
      stampResourceFootprintData(world, resource, scriptedFootprint(world, resource, type, level));
      return resource;
    }
    case 'none':
      return undefined;
  }
}

/** The cells a placement of `type` at `level` blocks for walking, as its backing or the landscape layer
 *  stamps them: a chest its record's footprint, a goods heap and a bush none, the rest the type's own. */
export function placementWalkCells(
  content: ContentSet,
  type: ScriptLandscapeType,
  level: number,
): readonly FootprintCell[] {
  const backing = placementBackingOf(type);
  switch (backing.kind) {
    case 'chest':
      return contentFootprintCells(
        content,
        chestFootprint(chestRecord(content, backing.chest.kind, backing.chest.gfxIndex)),
      ).walk;
    case 'good':
      return [];
    case 'resource':
      return placementBlockCells(type, level).walk;
    case 'none':
      return type.bushGfxIndex !== undefined ? [] : placementBlockCells(type, level).walk;
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
  removeLandscapes(world, ctx, terrain, point, 0, undefined, (entity) =>
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

/** Original behavior: a script level is read unsigned and capped at the type's maximum, so a negative
 *  one lays the maximum. */
export function scriptLandscapeLevel(type: ScriptLandscapeType, level: number): number {
  const cap = type.maxLevel;
  if (cap === undefined) return level;
  return level < 0 ? cap : Math.min(level, cap);
}

function groundTakes(terrain: TerrainGraph, ground: LandscapeGround | undefined, node: NodeId): boolean {
  if (ground === undefined || ground.anywhere) return true;
  const kind = terrain.groundKinds?.[node];
  // A map without the ground lane has nothing to refuse on.
  if (kind === undefined) return true;
  return (ground.land && kind === GROUND_LAND) || (ground.water && kind === GROUND_WATER);
}

/**
 * A script's `SetLandscape`, by the rules in docs/formats/MISSIONS.md. Approximations: a building's body
 * stands for the original's house points, the placement grid's exclusion and building zones for its
 * build-blocked points, the dynamic walk overlay for its walk-blocked ones, and the attach points of
 * every standing placement, the map's own included, for its held attach points. Returns null when
 * refused, else the walk nodes the cleared placements freed.
 */
export function setScriptedLandscape(
  world: World,
  ctx: SystemContext,
  point: HalfCellNode,
  typeId: number,
  level: number,
  force: boolean,
  onResourceRemoved?: (entity: Entity) => void,
): NodeId[] | null {
  const terrain = ctx.terrain;
  if (terrain?.landscapes === undefined || !terrain.inBounds(point.hx, point.hy)) return null;
  const type = landscapeTypes(terrain).get(typeId);
  if (type === undefined || isBorderPoint(terrain, point)) return null;
  const anchor = terrain.nodeAt(point.hx, point.hy);
  const bodies = buildingBodyCells(world, ctx, terrain);
  const held = landscapeAttachNodes(world, terrain);
  if (bodies.has(anchor) || held.has(anchor)) return null;
  if (level === 0) return removeLandscapes(world, ctx, terrain, point, 0, undefined, onResourceRemoved);
  if (!groundTakes(terrain, type.ground, anchor)) return null;
  const size = scriptLandscapeLevel(type, level);
  if (size === 0) return removeLandscapes(world, ctx, terrain, point, 0, undefined, onResourceRemoved);
  if (landscapesWithin(world, terrain, point, 0).some((p) => p.typeId === typeId && p.level === size))
    return [];
  const blocks = placementBlockCells(type, size);
  const walk = translatedCells(terrain, blocks.walk, point.hx, point.hy);
  if (walk.length === 0) {
    if (dynamicBlockOverlay(world, ctx, terrain).has(anchor)) return null;
  } else if (!force) {
    const grid = placementBlockerGrid(world, ctx.content, terrain);
    if (walk.some((node) => (grid.exclusion[node] ?? 0) > 0 || (grid.buildingZone[node] ?? 0) > 0))
      return null;
  }
  const build = translatedCells(terrain, blocks.build, point.hx, point.hy);
  if (!build.every((node) => groundTakes(terrain, type.ground, node))) return null;
  const attachCells = type.attach ?? [];
  const attach = translatedCells(terrain, attachCells, point.hx, point.hy);
  if (attach.length < attachCells.length || attach.some((node) => bodies.has(node) || held.has(node)))
    return null;
  if (!setLandscape(world, ctx, point, typeId, size)) return null;
  const cleared = new Set([...(force ? [] : walk), ...attach]);
  cleared.delete(anchor);
  const freed: NodeId[] = [];
  for (const node of cleared) {
    freed.push(
      ...removeLandscapes(
        world,
        ctx,
        terrain,
        { hx: terrain.xOf(node), hy: terrain.yOf(node) },
        0,
        undefined,
        onResourceRemoved,
      ),
    );
  }
  return freed;
}

function forNodesInArea(
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

/** A script's palette index is stored in one byte: the original keeps the value's low byte. */
const PALETTE_INDEX_MASK = 0xff;
/** Original behavior: an `OnLand` write paints a cell off the map border whose anchor node is land. */
function isLandCell(terrain: TerrainGraph, cx: number, cy: number): boolean {
  if (isBorderCell(terrain, cx, cy)) return false;
  const anchor = cellAnchorNode(cx, cy);
  return terrain.groundKinds?.[terrain.nodeAt(anchor.hx, anchor.hy)] === GROUND_LAND;
}

/**
 * Original behavior: the point's cell takes the index, and so do `range >> 1` less one rings of cells
 * around it, so a range under 4 paints one cell and 900 the whole map; a point off the map still paints
 * the cells of its disc that lie on it. A write replaces the map author's own tint, which a cell reads
 * until a script writes it.
 */
export function setVertexColors(
  world: World,
  terrain: TerrainGraph,
  point: HalfCellNode,
  range: number,
  amount: number,
  onLand: boolean,
): boolean {
  if (onLand && terrain.groundKinds === undefined) return false;
  const value = amount & PALETTE_INDEX_MASK;
  const current = landscapeEditState(world);
  const centre = cellOfNode(point.hx, point.hy);
  const radius = Math.max(0, (range >> 1) - 1);
  const changed: number[] = [];
  const lastCy = Math.min(terrain.cellRows - 1, centre.cy + radius);
  const lastCx = Math.min(terrain.cellColumns - 1, centre.cx + radius);
  for (let cy = Math.max(0, centre.cy - radius); cy <= lastCy; cy++) {
    for (let cx = Math.max(0, centre.cx - radius); cx <= lastCx; cx++) {
      if (hexDistanceBetween(cx, cy, centre.cx, centre.cy) > radius) continue;
      if (onLand && !isLandCell(terrain, cx, cy)) continue;
      const cell = cy * terrain.cellColumns + cx;
      if ((current.tints.get(cell) ?? terrain.authoredTintOfCell(cell)) !== value) changed.push(cell);
    }
  }
  if (changed.length === 0) return true;
  writeLandscapeEdits(world, (state) => {
    // Indexed: this closure runs once per write, too rarely to be optimized, so a for-of here would hand
    // out an iterator result per cell.
    for (let i = 0; i < changed.length; i++) state.tints.set(changed[i] as number, value);
  });
  return true;
}
