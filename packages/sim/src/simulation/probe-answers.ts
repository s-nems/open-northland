/**
 * The probes' answers as plain, structured-cloneable data: a caller off the simulation's thread asks for
 * one in a single call and reads it without a closure over live state. Each is computed by the same
 * live probe the command gates on, so the two cannot disagree.
 */
import type { ContentSet } from '@open-northland/data';
import { contentIndex } from '../core/content-index.js';
import type { Entity, World } from '../ecs/world.js';
import type { HalfCellNode, NodeArea } from '../nav/halfcell.js';
import type { TerrainGraph } from '../nav/terrain/index.js';
import { contestedGroundFor } from '../systems/conflict/contested-ground.js';
import {
  placementBlockerVersion,
  placementProbe,
  workFlagBlockerVersion,
} from '../systems/footprint/index.js';
import { gridChangeKey, placementBlockerGrid } from '../systems/footprint/placement/blocker-grid.js';
import { ownPalisadeNodeList, palisadePlacementProbe } from '../systems/palisades/index.js';
import { buildingEnabled } from '../systems/progression/index.js';
import { signpostNetwork, signpostNetworkRevision, signpostProbe } from '../systems/signposts/index.js';
import { mooringSpotsOf } from '../systems/vehicles/index.js';
import type { FogState } from '../systems/vision/index.js';

/** A probe's verdict on every node of an area. */
export interface NodeGridAnswer {
  readonly area: NodeArea;
  /** 1 where the probe accepts the node, row-major over the area from its minimum corner. */
  readonly accepted: Uint8Array;
  /** Changes whenever an answer over the same area may differ, so a memo over the answer keys on it. */
  readonly key: string;
}

/** Half-cell nodes packed as `hy * NODE_SET_STRIDE + hx`, ascending. Holds on-map nodes only. */
export type NodeSetAnswer = Uint32Array;

/** Wider than any map's half-cell width, so a packed node decodes back uniquely. */
export const NODE_SET_STRIDE = 1 << 16;

/** Where a ship's dock order would moor: the serializable form of `MooringProbe`. */
export interface MooringAnswer {
  /** Changes whenever the spots may have. */
  readonly key: string;
  readonly spots: NodeSetAnswer;
}

function nodeAreaWidth(area: NodeArea): number {
  return area.maxHx - area.minHx + 1;
}

function nodeAreaHeight(area: NodeArea): number {
  return area.maxHy - area.minHy + 1;
}

/** Whether the answer accepts node `(hx, hy)`; a node outside its area is not answered and reads false. */
export function nodeGridAccepts(answer: NodeGridAnswer, hx: number, hy: number): boolean {
  const { area } = answer;
  if (hx < area.minHx || hx > area.maxHx || hy < area.minHy || hy > area.maxHy) return false;
  return answer.accepted[(hy - area.minHy) * nodeAreaWidth(area) + (hx - area.minHx)] === 1;
}

export function nodeSetHas(set: NodeSetAnswer, hx: number, hy: number): boolean {
  if (hx < 0 || hy < 0 || hx >= NODE_SET_STRIDE) return false;
  const packed = hy * NODE_SET_STRIDE + hx;
  let lo = 0;
  let hi = set.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const at = set[mid] ?? 0;
    if (at === packed) return true;
    if (at < packed) lo = mid + 1;
    else hi = mid - 1;
  }
  return false;
}

function packedNodeSet(nodes: Iterable<HalfCellNode>): NodeSetAnswer {
  const packed: number[] = [];
  for (const { hx, hy } of nodes) {
    if (hx >= 0 && hy >= 0 && hx < NODE_SET_STRIDE) packed.push(hy * NODE_SET_STRIDE + hx);
  }
  return Uint32Array.from(new Set(packed)).sort();
}

function gridOver(area: NodeArea, accepts: (hx: number, hy: number) => boolean): Uint8Array {
  const width = nodeAreaWidth(area);
  const grid = new Uint8Array(width * nodeAreaHeight(area));
  for (let hy = area.minHy; hy <= area.maxHy; hy++) {
    const row = (hy - area.minHy) * width - area.minHx;
    for (let hx = area.minHx; hx <= area.maxHx; hx++) if (accepts(hx, hy)) grid[row + hx] = 1;
  }
  return grid;
}

function areaKey(area: NodeArea): string {
  return `${area.minHx},${area.minHy},${area.maxHx},${area.maxHy}`;
}

/** A footprint grid with the token over the blocker counts and the signpost network it read. */
interface FootprintGrid {
  readonly key: string;
  readonly grid: Uint8Array;
}

/** Grids kept per world before they are all dropped: a panned view keeps asking for new areas. */
const MAX_FOOTPRINT_GRIDS = 256;

/** Footprint grids by (type, placer, area), each valid while the blocker counts near its area and the
 *  signpost network hold, so a blocker changing across the map leaves them standing. The contested
 *  ground and the technology gate are laid over them per answer. A read-path cache, never hashed. */
const footprintGrids = new WeakMap<World, Map<string, FootprintGrid>>();

/** How far past an anchor a footprint cell reaches, in nodes: its offsets, plus the row parity's shift. */
function footprintReach(content: ContentSet, buildingType: number): number {
  const footprint = contentIndex(content).buildings.get(buildingType)?.footprint;
  if (footprint === undefined) return 0;
  let reach = 0;
  for (const cells of [footprint.reserved, footprint.familyBody, footprint.blocked]) {
    for (const cell of cells) reach = Math.max(reach, Math.abs(cell.dx) + 1, Math.abs(cell.dy));
  }
  return reach;
}

function footprintGrid(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  buildingType: number,
  player: number | undefined,
  area: NodeArea,
): FootprintGrid {
  let grids = footprintGrids.get(world);
  if (grids === undefined) {
    grids = new Map();
    footprintGrids.set(world, grids);
  }
  const blockers = placementBlockerGrid(world, content, terrain);
  const key = `${gridChangeKey(blockers, area, footprintReach(content, buildingType))}.${signpostNetworkRevision(world)}`;
  const slot = `${buildingType}:${player ?? ''}:${areaKey(area)}`;
  const held = grids.get(slot);
  if (held !== undefined && held.key === key) return held;
  const ownSignposts = player === undefined ? [] : (signpostNetwork(world).get(player) ?? []);
  const probe = placementProbe(world, content, terrain, buildingType, ownSignposts);
  const fresh = { key, grid: gridOver(area, (hx, hy) => probe.canPlace(hx, hy)) };
  if (grids.size >= MAX_FOOTPRINT_GRIDS && held === undefined) grids.clear();
  grids.set(slot, fresh);
  return fresh;
}

/** The building placement probe's answer over `area`: footprint, contested ground and, with a tribe, the
 *  seat's technology gate. Null for a mapless sim. */
export function placementAnswerFor(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph | undefined,
  fog: FogState | undefined,
  buildingType: number,
  area: NodeArea,
  player?: number,
  tribe?: number,
): NodeGridAnswer | null {
  if (terrain === undefined) return null;
  const { key: version, grid: footprint } = footprintGrid(
    world,
    content,
    terrain,
    buildingType,
    player,
    area,
  );
  const enabled = tribe === undefined || buildingEnabled(world, { content }, player, tribe, buildingType);
  if (player === undefined) {
    return {
      area,
      accepted: enabled ? footprint.slice() : new Uint8Array(footprint.length),
      key: `${version}:${enabled}`,
    };
  }
  const ground = contestedGroundFor(world, content, fog, player);
  const width = nodeAreaWidth(area);
  const accepted = new Uint8Array(footprint.length);
  if (enabled) {
    for (let i = 0; i < footprint.length; i++) {
      if (
        footprint[i] === 1 &&
        !ground.contested(area.minHx + (i % width), area.minHy + Math.floor(i / width))
      )
        accepted[i] = 1;
    }
  }
  const contestedKey = ground.keyWithin(area.minHx, area.maxHx, area.minHy, area.maxHy);
  return { area, accepted, key: `${version}:${enabled}:${contestedKey}` };
}

/** The signpost probe's answer over `area`; null for a mapless sim. */
export function signpostAnswerFor(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph | undefined,
  player: number,
  area: NodeArea,
): NodeGridAnswer | null {
  if (terrain === undefined) return null;
  const probe = signpostProbe(world, content, terrain, player, area);
  return {
    area,
    accepted: gridOver(area, (hx, hy) => probe.canPlace(hx, hy)),
    key: `${workFlagBlockerVersion(world)}.${signpostNetworkRevision(world)}`,
  };
}

/** The palisade collision probe's answer over `area`; null for an unknown row or a mapless sim. */
export function palisadeAnswerFor(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph | undefined,
  gfxIndex: number,
  area: NodeArea,
): NodeGridAnswer | null {
  if (terrain === undefined) return null;
  const probe = palisadePlacementProbe(world, content, terrain, gfxIndex);
  if (probe === null) return null;
  return {
    area,
    accepted: gridOver(area, (hx, hy) => probe.canPlace(hx, hy)),
    key: placementBlockerVersion(world),
  };
}

/** The spot set stays the same object while the mooring memo's key holds, so it is packed once. */
const packedSpots = new WeakMap<ReadonlySet<number>, NodeSetAnswer>();

/** The mooring probe's answer; null where the probe is. */
export function mooringAnswerFor(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph | undefined,
  vehicle: Entity,
): MooringAnswer | null {
  if (terrain === undefined) return null;
  const held = mooringSpotsOf(world, { content }, terrain, vehicle);
  if (held === null) return null;
  let spots = packedSpots.get(held.spots);
  if (spots === undefined) {
    const nodes: HalfCellNode[] = [];
    for (const node of held.spots) {
      const { x, y } = terrain.coordsOf(node);
      nodes.push({ hx: x, hy: y });
    }
    spots = packedNodeSet(nodes);
    packedSpots.set(held.spots, spots);
  }
  return { key: held.key, spots };
}

/** The nodes `player`'s walls, gates and wall sites stand on. */
export function ownPalisadeNodeSet(world: World, player: number): NodeSetAnswer {
  return packedNodeSet(ownPalisadeNodeList(world, player));
}
