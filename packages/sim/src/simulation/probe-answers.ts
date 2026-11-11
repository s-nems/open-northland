/**
 * The probes' answers as plain, structured-cloneable data: a caller off the simulation's thread asks for
 * one in a single call and reads it without a closure over live state. Each is computed by the same
 * live probe the command gates on, so the two cannot disagree.
 */
import type { ContentSet } from '@open-northland/data';
import {
  Building,
  Owner,
  Palisade,
  PalisadeBlocking,
  Position,
  ResourceFootprint,
  UnderConstruction,
} from '../components/index.js';
import { landscapeEditState, landscapePlacementRevision } from '../components/landscape.js';
import { bioGroundWaived } from '../components/rules.js';
import { contentIndex } from '../core/content-index.js';
import type { Entity, World } from '../ecs/world.js';
import { type HalfCellNode, type NodeArea, nodeOfPosition } from '../nav/halfcell.js';
import { HEX_DX_EVEN, HEX_DX_ODD, HEX_DY } from '../nav/range-search.js';
import type { NodeId, TerrainGraph } from '../nav/terrain/index.js';
import { ownedBuildings } from '../systems/ai-shared/seat-roster.js';
import { contestedGroundFor } from '../systems/conflict/contested-ground.js';
import { buildingFootprintOf, doorNodeOf } from '../systems/footprint/geometry.js';
import {
  type PlacementProbe,
  placementBlockerVersion,
  placementProbe,
  siteReachFor,
  workFlagBlockerVersion,
} from '../systems/footprint/index.js';
import {
  gridChangeKey,
  type PlacementGrid,
  placementBlockerGrid,
} from '../systems/footprint/placement/blocker-grid.js';
import {
  chainShipHouse,
  SHIP_SITE_RINGS,
  type ShipYardSites,
  shipYardSites,
} from '../systems/footprint/placement/vehicle-site.js';
import { walkBlockMask } from '../systems/footprint/walk-block-mask.js';
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
  /** The land component of each of `spots`, in its order (`MooringProbe.landOf`). */
  readonly spotLands: Int32Array;
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
  return nodeSetIndexOf(set, hx, hy) !== NOT_IN_SET;
}

/** The value `nodeSetIndexOf` returns for a node the set does not hold. */
export const NOT_IN_SET = -1;

/** The position of node `(hx, hy)` in the set, or {@link NOT_IN_SET}. */
export function nodeSetIndexOf(set: NodeSetAnswer, hx: number, hy: number): number {
  if (hx < 0 || hy < 0 || hx >= NODE_SET_STRIDE) return NOT_IN_SET;
  const packed = hy * NODE_SET_STRIDE + hx;
  let lo = 0;
  let hi = set.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const at = set[mid] ?? 0;
    if (at === packed) return mid;
    if (at < packed) lo = mid + 1;
    else hi = mid - 1;
  }
  return NOT_IN_SET;
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

/** The building placement probe's answer over `area`: `tribe`'s footprint, the seat's site reach (unless `withinReach` is off),
 *  contested ground, the ground a peace keeps the seat off and, with a tribe while `gated`, the seat's
 *  technology gate. Null for a mapless sim. */
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
  withinReach = true,
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
  const reach = withinReach ? siteReachFor(world, player).over(area) : null;
  const ground = contestedGroundFor(world, content, fog, player);
  const peace = peaceGroundWithin(world, player, area);
  const width = nodeAreaWidth(area);
  const accepted = new Uint8Array(footprint.length);
  // The footprint-accepted nodes out of reach, as runs of indices: settlers walking about inside the area
  // leave the key alone until the edge of the reach actually moves across it.
  const outOfReach: number[] = [];
  if (enabled) {
    for (let i = 0; i < footprint.length; i++) {
      if (footprint[i] !== 1) continue;
      const hx = area.minHx + (i % width);
      const hy = area.minHy + Math.floor(i / width);
      if (reach !== null && reach[i] !== 1) {
        const runs = outOfReach.length;
        if (runs > 0 && outOfReach[runs - 1] === i - 1) outOfReach[runs - 1] = i;
        else outOfReach.push(i, i);
        continue;
      }
      if (!ground.contested(hx, hy) && !(peace?.bars(hx, hy) ?? false)) accepted[i] = 1;
    }
  }
  const reachKey = outOfReach.join(',');
  const contestedKey = ground.keyWithin(area.minHx, area.maxHx, area.minHy, area.maxHy);
  const peaceKey = peace === null ? '-' : peace.key;
  return { area, accepted, key: `${version}:${enabled}:${reachKey}:${contestedKey}:${peaceKey}` };
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
/** The land components of a packed spot set, built once beside it. */
const packedLands = new WeakMap<NodeSetAnswer, Int32Array>();

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
  const spots = pack(held.spots);
  let spotLands = packedLands.get(spots);
  if (spotLands === undefined) {
    spotLands = Int32Array.from(spots, (packed) =>
      terrain.componentOf(terrain.nodeAt(packed % NODE_SET_STRIDE, Math.floor(packed / NODE_SET_STRIDE))),
    );
    packedLands.set(spots, spotLands);
  }
  return { key: held.key, spots, spotLands, docks: pack(held.docks) };
}

/** The nodes `player`'s walls, gates and wall sites stand on. */
export function ownPalisadeNodeSet(world: World, player: number): NodeSetAnswer {
  return packedNodeSet(ownPalisadeNodeList(world, player));
}

/**
 * What the ship-water verdict reads: which buildings, sites, walls and resources stand and who owns them,
 * the walk-block mask a builder's work cell and an upgrade's grown body move, and the scripted landscape.
 * A construction stroke moves none of them, so active sites do not churn the key. Never a vehicle's
 * position: the yard probe reads no parked ships, so a hull drifting across the candidate water does not
 * flip the verdict.
 */
export function shipWaterVersionOf(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph | undefined,
): string {
  return [
    world.componentGeneration(Building),
    world.componentGeneration(UnderConstruction),
    world.componentGeneration(Palisade),
    world.componentGeneration(PalisadeBlocking),
    world.componentGeneration(ResourceFootprint),
    world.componentGeneration(Owner),
    world.componentValueGeneration(Owner),
    terrain === undefined ? '' : walkBlockMask(world, { content }, terrain).version,
    landscapePlacementRevision(world),
    landscapeEditState(world).topologyRevision,
  ].join('.');
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
 * Over `area`, 1 where a workshop of `buildingType` (of `tribe`, whose footprint the door reads) anchored at
 * the node would find ship water in its crew's yard search, else 0: within {@link SHIP_SITE_RINGS} of the
 * anchor a fresh yard of the chain's smallest ship house fits for a worker on the door's continent, or
 * `player`'s unfinished yard of that house stands with a work point there. The per-anchor rule
 * {@link shipWaterWithin} states, answered for every anchor at once: each continent's yard spots spread
 * one ring per step over the area grown by the rings. Null when the type's chain builds no ships or the
 * sim is mapless.
 */
export function shipWaterGridFor(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph | undefined,
  buildingType: number,
  tribe: number | undefined,
  area: NodeArea,
  player?: number,
): NodeGridAnswer | null {
  if (terrain === undefined) return null;
  const house = chainShipHouse(contentIndex(content), buildingType);
  const yards = house === null ? null : shipYardSites(world, { content }, terrain, house, tribe ?? 0);
  if (house === null || yards === null) return null;
  const reach = SHIP_SITE_RINGS - 1;
  // Every node within `reach` of an anchor in the area lies in the box, and so does every node of a
  // shortest lattice path between them, so a spread confined to the box measures those distances exactly.
  const box: NodeArea = {
    minHx: area.minHx - reach,
    minHy: area.minHy - reach,
    maxHx: area.maxHx + reach,
    maxHy: area.maxHy + reach,
  };
  const spots = new Map<number, number[]>();
  const addSpot = (continent: number, hx: number, hy: number): void => {
    const list = spots.get(continent) ?? [];
    list.push(boxIndex(box, hx, hy));
    spots.set(continent, list);
  };
  const version = shipWaterVersionOf(world, content, terrain);
  const known = yardSpotsOf(world, `${house}:${tribe ?? 0}:${version}`);
  for (let hy = Math.max(0, box.minHy); hy <= Math.min(terrain.height - 1, box.maxHy); hy++) {
    for (let hx = Math.max(0, box.minHx); hx <= Math.min(terrain.width - 1, box.maxHx); hx++) {
      const node = terrain.nodeAt(hx, hy);
      if (!terrain.isWater(node)) continue;
      let continents = known.get(node);
      if (continents === undefined) {
        continents = yards.fits(hx, hy) ? distinctWorkContinents(yards, hx, hy) : NO_CONTINENTS;
        known.set(node, continents);
      }
      for (const continent of continents) addSpot(continent, hx, hy);
    }
  }
  if (player !== undefined) {
    for (const site of ownedBuildings(world, player)) {
      if (world.tryGet(site, Building)?.buildingType !== house || !world.has(site, UnderConstruction))
        continue;
      const at = world.get(site, Position);
      const { hx, hy } = nodeOfPosition(at.x, at.y);
      if (hx < box.minHx || hx > box.maxHx || hy < box.minHy || hy > box.maxHy) continue;
      for (const continent of distinctWorkContinents(yards, hx, hy, site)) addSpot(continent, hx, hy);
    }
  }
  const reached = new Map<number, Uint8Array>();
  for (const [continent, starts] of spots) reached.set(continent, spreadWithin(box, starts, reach));
  const footprint = tribe === undefined ? undefined : buildingFootprintOf(content, buildingType, tribe);
  const accepted = gridOver(area, (hx, hy) => {
    if (!terrain.inBounds(hx, hy)) return false;
    const shore = terrain.componentOf(doorNodeOf(terrain, footprint, hx, hy) ?? terrain.nodeAt(hx, hy));
    return reached.get(shore)?.[boxIndex(box, hx, hy)] === 1;
  });
  return { area, accepted, key: version };
}

const NO_CONTINENTS: readonly number[] = [];

/** Each water node's yard verdict under one ship house, tribe and {@link shipWaterVersionOf}: the
 *  continents a fresh yard anchored there is worked from, empty where none fits. Neighbouring areas share
 *  most of their grown boxes, so a cursor's areas test each water node once. */
const yardSpotMemo = new WeakMap<
  World,
  { readonly key: string; readonly spots: Map<NodeId, readonly number[]> }
>();

function yardSpotsOf(world: World, key: string): Map<NodeId, readonly number[]> {
  const held = yardSpotMemo.get(world);
  if (held !== undefined && held.key === key) return held.spots;
  const spots = new Map<NodeId, readonly number[]>();
  yardSpotMemo.set(world, { key, spots });
  return spots;
}

function distinctWorkContinents(yards: ShipYardSites, hx: number, hy: number, site?: Entity): number[] {
  const continents: number[] = [];
  yards.workContinents(
    hx,
    hy,
    (continent) => {
      if (!continents.includes(continent)) continents.push(continent);
    },
    site,
  );
  return continents;
}

function boxIndex(box: NodeArea, hx: number, hy: number): number {
  return (hy - box.minHy) * nodeAreaWidth(box) + (hx - box.minHx);
}

/** 1 at every box node within `reach` lattice steps of a start (box indexes), else 0. One breadth-first
 *  pass over a queue of box indexes, its distances held beside the marks. */
function spreadWithin(box: NodeArea, starts: readonly number[], reach: number): Uint8Array {
  const width = nodeAreaWidth(box);
  const height = nodeAreaHeight(box);
  const reached = new Uint8Array(width * height);
  const steps = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let tail = 0;
  for (const index of starts) {
    if (reached[index] === 1) continue;
    reached[index] = 1;
    queue[tail++] = index;
  }
  for (let head = 0; head < tail; head++) {
    const index = queue[head] ?? 0;
    const step = (steps[index] ?? 0) + 1;
    if (step > reach) continue;
    const x = index % width;
    const y = (index - x) / width;
    // The lattice parity is the node's own row's, which the box's first row offsets.
    const dxs = ((box.minHy + y) & 1) === 0 ? HEX_DX_EVEN : HEX_DX_ODD;
    for (let k = 0; k < HEX_DY.length; k++) {
      const nx = x + (dxs[k] ?? 0);
      const ny = y + (HEX_DY[k] ?? 0);
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const at = ny * width + nx;
      if (reached[at] === 1) continue;
      reached[at] = 1;
      steps[at] = step;
      queue[tail++] = at;
    }
  }
  return reached;
}
