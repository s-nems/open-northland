/**
 * The probes' answers as plain, structured-cloneable data: a caller off the simulation's thread asks for
 * one in a single call and reads it without a closure over live state. Each is computed by the same
 * live probe the command gates on, so the two cannot disagree.
 */
import type { ContentSet } from '@open-northland/data';
import { Building, Owner, Palisade, ResourceFootprint, UnderConstruction } from '../components/index.js';
import { landscapeEditState, landscapePlacementRevision } from '../components/landscape.js';
import { bioGroundWaived } from '../components/rules.js';
import { contentIndex } from '../core/content-index.js';
import type { Entity, World } from '../ecs/world.js';
import type { HalfCellNode, NodeArea } from '../nav/halfcell.js';
import { NO_COMPONENT, type NodeId, type TerrainGraph } from '../nav/terrain/index.js';
import { ownedBuildings } from '../systems/ai-shared/seat-roster.js';
import { contestedGroundFor } from '../systems/conflict/contested-ground.js';
import { buildingFootprintOf, doorNodeOf } from '../systems/footprint/geometry.js';
import {
  type PlacementProbe,
  placementBlockerVersion,
  placementProbe,
  workFlagBlockerVersion,
} from '../systems/footprint/index.js';
import { interactionCellOf } from '../systems/footprint/interaction.js';
import {
  gridChangeKey,
  type PlacementGrid,
  placementBlockerGrid,
} from '../systems/footprint/placement/blocker-grid.js';
import {
  chainShipHouse,
  SHIP_SITE_RINGS,
  shipWaterWithin,
} from '../systems/footprint/placement/vehicle-site.js';
import { peaceGroundWithin } from '../systems/match/peace.js';
import { ownPalisadeNodeList, palisadePlacementProbe } from '../systems/palisades/index.js';
import { buildingEnabled } from '../systems/progression/index.js';
import { roadAreaKey } from '../systems/roads/index.js';
import { roadSiteAreaKey } from '../systems/roads/site-index.js';
import { roadSitePlacementProbe } from '../systems/roads/sites.js';
import {
  plannedSignpostsVersion,
  signpostNetworkRevision,
  signpostProbe,
} from '../systems/signposts/index.js';
import { mooringSpotsOf } from '../systems/vehicles/index.js';
import type { FogState } from '../systems/vision/index.js';

/** A probe's verdict on every node of an area. */
export interface NodeGridAnswer {
  readonly area: NodeArea;
  /** 1 where the probe accepts the node, {@link UPGRADE_GROUND_ONLY} where a wall or road answer accepts
   *  it only over upgrade ground, else 0; row-major over the area from its minimum corner. */
  readonly accepted: Uint8Array;
  /** Changes whenever an answer over the same area may differ, so a memo over the answer keys on it. */
  readonly key: string;
}

/** A wall or road answer's node a line takes only over ground a standing building keeps for its upgrade. */
const UPGRADE_GROUND_ONLY = 2;

/** Half-cell nodes packed as `hy * NODE_SET_STRIDE + hx`, ascending. Holds on-map nodes only. */
export type NodeSetAnswer = Uint32Array;

/** Wider than any map's half-cell width, so a packed node decodes back uniquely. */
export const NODE_SET_STRIDE = 1 << 16;

/** Where a ship's dock order would moor: the serializable form of `MooringProbe`. */
export interface MooringAnswer {
  /** Changes whenever the spots may have. */
  readonly key: string;
  readonly spots: NodeSetAnswer;
  /** The water nodes the ship may lie moored at (`MooringProbe.canDock`). */
  readonly docks: NodeSetAnswer;
}

function nodeAreaWidth(area: NodeArea): number {
  return area.maxHx - area.minHx + 1;
}

function nodeAreaHeight(area: NodeArea): number {
  return area.maxHy - area.minHy + 1;
}

function answerAt(answer: NodeGridAnswer, hx: number, hy: number): number {
  const { area } = answer;
  if (hx < area.minHx || hx > area.maxHx || hy < area.minHy || hy > area.maxHy) return 0;
  return answer.accepted[(hy - area.minHy) * nodeAreaWidth(area) + (hx - area.minHx)] ?? 0;
}

/** Whether the answer accepts node `(hx, hy)`, upgrade ground too with `overUpgradeGround`; a node outside
 *  its area is not answered and reads false. */
export function nodeGridAccepts(
  answer: NodeGridAnswer,
  hx: number,
  hy: number,
  overUpgradeGround = false,
): boolean {
  const at = answerAt(answer, hx, hy);
  return at === 1 || (overUpgradeGround && at === UPGRADE_GROUND_ONLY);
}

/** Whether the answer takes node `(hx, hy)` only over ground a standing building keeps for its upgrade. */
export function nodeGridUpgradeReserve(answer: NodeGridAnswer, hx: number, hy: number): boolean {
  return answerAt(answer, hx, hy) === UPGRADE_GROUND_ONLY;
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

/** Marks the refused nodes of `grid` over `area` on an upgrade's ground that `over`, the same probe
 *  waiving that ground, accepts. */
function markUpgradeGround(
  grid: Uint8Array,
  area: NodeArea,
  blockers: PlacementGrid,
  over: PlacementProbe,
): Uint8Array {
  const width = nodeAreaWidth(area);
  const mapWidth = blockers.terrain.width;
  for (let hy = area.minHy; hy <= area.maxHy; hy++) {
    for (let hx = area.minHx; hx <= area.maxHx; hx++) {
      const at = (hy - area.minHy) * width + (hx - area.minHx);
      if (
        grid[at] === 0 &&
        blockers.terrain.inBounds(hx, hy) &&
        (blockers.upgradeReserve[hy * mapWidth + hx] ?? 0) > 0 &&
        over.canPlace(hx, hy)
      ) {
        grid[at] = UPGRADE_GROUND_ONLY;
      }
    }
  }
  return grid;
}

function areaKey(area: NodeArea): string {
  return `${area.minHx},${area.minHy},${area.maxHx},${area.maxHy}`;
}

/** A footprint grid with the token over the blocker counts it read. */
interface FootprintGrid {
  readonly key: string;
  readonly grid: Uint8Array;
}

/** Grids kept per world before they are all dropped: a panned view keeps asking for new areas. */
const MAX_FOOTPRINT_GRIDS = 256;

/** Footprint grids by (type, tribe, area), each valid while the blocker counts near its area hold, so a
 *  blocker changing across the map leaves them standing. The contested ground and the technology gate are
 *  laid over them per answer. A read-path cache, never hashed. */
const footprintGrids = new WeakMap<World, Map<string, FootprintGrid>>();

/** How far past an anchor a footprint cell reaches, in nodes: its offsets, plus the row parity's shift. */
function footprintReach(content: ContentSet, buildingType: number, tribe: number | undefined): number {
  const footprint = buildingFootprintOf(content, buildingType, tribe);
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
  tribe: number | undefined,
  area: NodeArea,
): FootprintGrid {
  let grids = footprintGrids.get(world);
  if (grids === undefined) {
    grids = new Map();
    footprintGrids.set(world, grids);
  }
  const blockers = placementBlockerGrid(world, content, terrain);
  const key = `${gridChangeKey(blockers, area, footprintReach(content, buildingType, tribe))}.${bioGroundWaived(world) ? 1 : 0}`;
  const slot = `${buildingType}:${tribe ?? ''}:${areaKey(area)}`;
  const held = grids.get(slot);
  if (held !== undefined && held.key === key) return held;
  const probe = placementProbe(world, content, terrain, buildingType, tribe);
  const fresh = { key, grid: gridOver(area, (hx, hy) => probe.canPlace(hx, hy)) };
  if (grids.size >= MAX_FOOTPRINT_GRIDS && held === undefined) grids.clear();
  grids.set(slot, fresh);
  return fresh;
}

/** The building placement probe's answer over `area`: `tribe`'s footprint, contested ground, the ground a
 *  peace keeps the seat off and, with a tribe while `gated`, the seat's technology gate. Null for a
 *  mapless sim. */
export function placementAnswerFor(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph | undefined,
  fog: FogState | undefined,
  buildingType: number,
  area: NodeArea,
  player?: number,
  tribe?: number,
  gated = true,
): NodeGridAnswer | null {
  if (terrain === undefined) return null;
  const { key: version, grid: footprint } = footprintGrid(world, content, terrain, buildingType, tribe, area);
  const enabled =
    tribe === undefined || !gated || buildingEnabled(world, { content }, player, tribe, buildingType);
  if (player === undefined) {
    return {
      area,
      accepted: enabled ? footprint.slice() : new Uint8Array(footprint.length),
      key: `${version}:${enabled}`,
    };
  }
  const ground = contestedGroundFor(world, content, fog, player);
  const peace = peaceGroundWithin(world, player, area);
  const width = nodeAreaWidth(area);
  const accepted = new Uint8Array(footprint.length);
  if (enabled) {
    for (let i = 0; i < footprint.length; i++) {
      if (footprint[i] !== 1) continue;
      const hx = area.minHx + (i % width);
      const hy = area.minHy + Math.floor(i / width);
      if (!ground.contested(hx, hy) && !(peace?.bars(hx, hy) ?? false)) accepted[i] = 1;
    }
  }
  const contestedKey = ground.keyWithin(area.minHx, area.maxHx, area.minHy, area.maxHy);
  const peaceKey = peace === null ? '-' : peace.key;
  return { area, accepted, key: `${version}:${enabled}:${contestedKey}:${peaceKey}` };
}

/** What the signpost overlay's answer reads: the work-flag blockers, a lobby peace's hold among them, the
 *  player's posts and the posts its scouts plan. */
export function signpostBlockerVersionOf(world: World): string {
  return `${workFlagBlockerVersion(world)}.${signpostNetworkRevision(world)}.${plannedSignpostsVersion(world)}`;
}

/** The signpost probe's answer over `area`, the planned posts' spacing included; null for a mapless sim. */
export function signpostAnswerFor(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph | undefined,
  player: number,
  area: NodeArea,
): NodeGridAnswer | null {
  if (terrain === undefined) return null;
  const probe = signpostProbe(world, content, terrain, player, area, { planned: true });
  return {
    area,
    accepted: gridOver(area, (hx, hy) => probe.canPlace(hx, hy)),
    key: signpostBlockerVersionOf(world),
  };
}

/** The palisade collision probe's answer over `area` and, with a `player`, without the ground a peace
 *  keeps the seat off; null for an unknown row or a mapless sim. */
export function palisadeAnswerFor(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph | undefined,
  gfxIndex: number,
  area: NodeArea,
  player?: number,
): NodeGridAnswer | null {
  if (terrain === undefined) return null;
  const probe = palisadePlacementProbe(world, content, terrain, gfxIndex);
  const over = palisadePlacementProbe(world, content, terrain, gfxIndex, true);
  if (probe === null || over === null) return null;
  const accepted = markUpgradeGround(
    gridOver(area, (hx, hy) => probe.canPlace(hx, hy)),
    area,
    placementBlockerGrid(world, content, terrain),
    over,
  );
  const peace = peaceGroundWithin(world, player, area);
  if (peace !== null) {
    const width = nodeAreaWidth(area);
    for (let i = 0; i < accepted.length; i++) {
      if (accepted[i] !== 0 && peace.bars(area.minHx + (i % width), area.minHy + Math.floor(i / width))) {
        accepted[i] = 0;
      }
    }
  }
  const peaceKey = peace === null ? '-' : peace.key;
  return { area, accepted, key: `${placementBlockerVersion(world)}:${peaceKey}` };
}

/** Road site grids by area, each valid while the blockers, the road sites and the roads on its nodes
 *  hold, so a site ordered across the map leaves them standing. A read-path cache, never hashed. */
const roadSiteGrids = new WeakMap<World, Map<string, FootprintGrid>>();

/** The road site probe's answer over `area`, keyed on what its own nodes read; null for a mapless sim. */
export function roadSiteAnswerFor(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph | undefined,
  area: NodeArea,
): NodeGridAnswer | null {
  if (terrain === undefined) return null;
  let grids = roadSiteGrids.get(world);
  if (grids === undefined) {
    grids = new Map();
    roadSiteGrids.set(world, grids);
  }
  const blockers = placementBlockerGrid(world, content, terrain);
  // The probe reads each node alone, so no blocker beyond the area reaches it; the grid's change key
  // also moves for a resource anchored in the area, which the ground rule reads.
  const key = `${gridChangeKey(blockers, area, 0)}.${roadSiteAreaKey(world, terrain, area)}.${roadAreaKey(world, area)}`;
  const slot = areaKey(area);
  let held = grids.get(slot);
  if (held === undefined || held.key !== key) {
    const probe = roadSitePlacementProbe(world, content, terrain);
    const over = roadSitePlacementProbe(world, content, terrain, true);
    if (grids.size >= MAX_FOOTPRINT_GRIDS && held === undefined) grids.clear();
    held = {
      key,
      grid: markUpgradeGround(
        gridOver(area, (hx, hy) => probe.canPlace(hx, hy)),
        area,
        blockers,
        over,
      ),
    };
    grids.set(slot, held);
  }
  return { area, accepted: held.grid.slice(), key };
}

/** The spot and dock sets stay the same objects while the mooring memo's key holds, so each is packed
 *  once. */
const packedSets = new WeakMap<ReadonlySet<NodeId>, NodeSetAnswer>();

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
  const pack = (set: ReadonlySet<NodeId>): NodeSetAnswer => {
    let packed = packedSets.get(set);
    if (packed === undefined) {
      const nodes: HalfCellNode[] = [];
      for (const node of set) {
        const { x, y } = terrain.coordsOf(node);
        nodes.push({ hx: x, hy: y });
      }
      packed = packedNodeSet(nodes);
      packedSets.set(set, packed);
    }
    return packed;
  };
  return { key: held.key, spots: pack(held.spots), docks: pack(held.docks) };
}

/** The nodes `player`'s walls, gates and wall sites stand on. */
export function ownPalisadeNodeSet(world: World, player: number): NodeSetAnswer {
  return packedNodeSet(ownPalisadeNodeList(world, player));
}

/** Whether a workshop placed at an anchor would find ship water in its yard search. */
export interface ShipWaterAnswer {
  readonly shipWater: boolean;
  /** Changes whenever the verdict may, so a memo over the answers keys on it. */
  readonly key: string;
}

/**
 * What the ship-water verdict reads: the walk-block and clearance inputs (buildings, walls, resources,
 * the scripted landscape), the ownership the seat's reusable yards follow, and the terrain the door's
 * continent and the water components read. Never a vehicle's position: the yard probe reads no parked
 * ships, so a hull drifting across the candidate water does not flip the verdict.
 */
export function shipWaterVersionOf(world: World): string {
  return `${world.componentGeneration(Building)}.${world.componentValueGeneration(Building)}.${world.componentGeneration(Palisade)}.${world.componentGeneration(ResourceFootprint)}.${world.componentGeneration(Owner)}.${world.componentValueGeneration(Owner)}.${landscapePlacementRevision(world)}.${landscapeEditState(world).topologyRevision}`;
}

/** The building types a ship-water verdict applies to, memoized per content index: those whose upgrade
 *  chain can produce a good whose vehicle house raises on water. */
export function shipWaterWorkshopsOf(content: ContentSet): ReadonlySet<number> {
  const index = contentIndex(content);
  let held = workshopChains.get(index);
  if (held === undefined) {
    held = new Set([...index.buildings.keys()].filter((typeId) => chainShipHouse(index, typeId) !== null));
    workshopChains.set(index, held);
  }
  return held;
}

const workshopChains = new WeakMap<object, ReadonlySet<number>>();

/**
 * Whether a workshop of `buildingType` (of `tribe`, whose footprint the door node reads) placed with its
 * anchor at half-cell node `(x, y)` would have ship water in its crew's yard search
 * ({@link SHIP_SITE_RINGS}, the search {@link shipWaterWithin} mirrors): a fresh yard of the chain's
 * smallest ship house fits on some water node in reach for a worker on the door's continent, or the
 * seat's unfinished yard of that house stands in reach on that shore. Null when the type's chain builds
 * no ships or the sim is mapless, so no verdict applies.
 */
export function shipWaterAnswerFor(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph | undefined,
  buildingType: number,
  tribe: number | undefined,
  x: number,
  y: number,
  player?: number,
): ShipWaterAnswer | null {
  if (terrain === undefined) return null;
  const index = contentIndex(content);
  const house = chainShipHouse(index, buildingType);
  if (house === null) return null;
  // The node the placed house's worker stands on: its door, or the anchor for a door-less footprint,
  // the work point the yard search reads the worker's shore from.
  const footprint = tribe === undefined ? undefined : buildingFootprintOf(content, buildingType, tribe);
  const shore = terrain.componentOf(doorNodeOf(terrain, footprint, x, y) ?? terrain.nodeAtClamped(x, y));
  const reusable =
    player === undefined
      ? []
      : ownedBuildings(world, player).filter(
          (e) =>
            world.tryGet(e, Building)?.buildingType === house && world.has(e, UnderConstruction),
        );
  const shipWater = shipWaterWithin(
    world,
    { content },
    terrain,
    house,
    tribe ?? 0,
    player,
    { hx: x, hy: y },
    shore,
    SHIP_SITE_RINGS,
    reusable,
    // A yard across the water or on another shore is out of this crew's walk, however near it stands.
    (site: Entity): boolean => {
      if (shore === NO_COMPONENT) return false;
      const cell = interactionCellOf(world, { content }, terrain, site);
      return cell !== null && terrain.componentOf(cell) === shore;
    },
  );
  return { shipWater, key: shipWaterVersionOf(world) };
}
