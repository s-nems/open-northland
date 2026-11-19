import { footprintCellDx } from '@open-northland/data';
import type { BlockOverlay } from './block-overlay.js';
import { HEX_NEIGHBOUR_OFFSETS, hexDistanceBetween, type NodeArea } from './halfcell.js';
import { NO_WALK, type NodeBox, type SpatialGate } from './node-circle.js';
import type { NodeId, TerrainGraph } from './terrain/index.js';

/** A cloneable, bounded piece of the half-cell grid. */
export interface ReachArea extends NodeBox {
  readonly cells: Uint8Array;
}

/** Area cell states: marked, and a target not marked yet, which only a flood with targets writes and it
 *  clears before returning. */
export const MARKED = 1;
const WANTED = 2;

export function reachContains(area: ReachArea, hx: number, hy: number): boolean {
  if (hx < area.minX || hx > area.maxX || hy < area.minY || hy > area.maxY) return false;
  return area.cells[(hy - area.minY) * (area.maxX - area.minX + 1) + hx - area.minX] === MARKED;
}

/** Any even and any odd node row: only the parity matters. */
const EVEN_ROW = 0;
const ODD_ROW = 1;
/** Even- and odd-row x offsets and the y offsets of {@link HEX_NEIGHBOUR_OFFSETS}, in its order. */
export const HEX_DX_EVEN = HEX_NEIGHBOUR_OFFSETS.map((c) => footprintCellDx(EVEN_ROW, c));
export const HEX_DX_ODD = HEX_NEIGHBOUR_OFFSETS.map((c) => footprintCellDx(ODD_ROW, c));
export const HEX_DY = HEX_NEIGHBOUR_OFFSETS.map((c) => c.dy);

/** Per-call scratch shared by every flood and fully reset before use, so it carries no state: the
 *  best cost per node of the flood's window, and the bucket queue as one linked list of entries per
 *  cost (the first entry per cost, then each entry's node and successor). Typed lists, because an
 *  array per cost ran up to twice as slow depending on the order the engine warmed the code in. */
let costScratch = new Uint16Array(0);
let headScratch = new Int32Array(0);
let entryNodes = new Int32Array(0);
let entryNext = new Int32Array(0);
const NO_ENTRY = -1;
/** How far above the budget a cost slot's never-inspected and closed states sit; the budget itself
 *  marks an open node no cost under the budget has reached yet. */
const UNSEEN_OVER_BUDGET = 1;
const CLOSED_OVER_BUDGET = 2;
/** Set on an entered node's cost slot: no later step improves an entered node, so the flag only tells
 *  entered from reached. Every other slot state stays under it. */
const ENTERED_FLAG = 0x8000;

/** Doubles the entry lists, keeping the entries written so far. */
function growEntries(): void {
  const size = Math.max(1024, 2 * entryNodes.length);
  const nodes = new Int32Array(size);
  nodes.set(entryNodes);
  entryNodes = nodes;
  const next = new Int32Array(size);
  next.set(entryNext);
  entryNext = next;
}

/** {@link searchReach}'s answer with what it read: each entered node's cost, and the box of every node
 *  it inspected. The answer depends only on the ground, blockers and roads of the inspected nodes, the
 *  entered ones and their neighbours (see {@link floodInspected}). */
export interface ReachSearch {
  readonly area: ReachArea;
  readonly searched: NodeArea;
  readonly costs: FloodCosts;
  /** False when the flood stopped once it had marked every target: its area is then only part of the
   *  full answer, though every node it marks the full flood marks too. */
  readonly complete: boolean;
}

/** A node a flood may stop at once it has marked it. */
export interface ReachTarget {
  readonly hx: number;
  readonly hy: number;
}

/** The first `count` of `nodes`: what a flood asked to stop early must mark before it stops. */
export interface ReachTargets {
  readonly nodes: readonly ReachTarget[];
  readonly count: number;
}

/** Whether a flood from `(hx, hy)` over `range` can mark `target`: inside its area box and hex range. */
function markable(area: ReachArea, hx: number, hy: number, range: number, target: ReachTarget): boolean {
  const { hx: x, hy: y } = target;
  if (x < area.minX || x > area.maxX || y < area.minY || y > area.maxY) return false;
  return hexDistanceBetween(hx, hy, x, y) < range;
}

/** Whether `search`, from `(hx, hy)` over `range`, contains each of `targets` exactly when the full flood
 *  would: it ran to its budget, or it marked every target the full flood can mark. */
export function reachCovers(
  search: ReachSearch,
  hx: number,
  hy: number,
  range: number,
  targets: ReachTargets | undefined,
): boolean {
  if (search.complete) return true;
  if (targets === undefined) return false;
  for (let i = 0; i < targets.count; i++) {
    const target = targets.nodes[i] as ReachTarget;
    if (markable(search.area, hx, hy, range, target) && !reachContains(search.area, target.hx, target.hy))
      return false;
  }
  return true;
}

/** The cheapest cost of each node a flood entered, row-major over a box holding all of them in the first
 *  `width * height` values; every other node reads {@link NOT_ENTERED}. A flood that never left its start
 *  holds the start alone. */
export interface FloodCosts {
  readonly minX: number;
  readonly minY: number;
  readonly width: number;
  readonly height: number;
  readonly values: Uint8Array | Uint16Array;
  /** The slot value of a node not entered: the largest value `values` holds. */
  readonly unset: number;
}

/** {@link enteredCost} of a node not entered: above every budget a flood runs. */
export const NOT_ENTERED = 0xffff;
/** Budgets up to this keep their costs a byte each, the byte's largest value meaning not entered. */
const BYTE_COST_UNSET = 0xff;
/** Nodes kept around the entered ones, so a repair that enters a few more still fits. */
const COST_BOX_MARGIN = 2;

/** `(x, y)`'s entered cost in `costs`, or {@link NOT_ENTERED}. */
export function enteredCost(costs: FloodCosts, x: number, y: number): number {
  const dx = x - costs.minX;
  const dy = y - costs.minY;
  if (dx < 0 || dy < 0 || dx >= costs.width || dy >= costs.height) return NOT_ENTERED;
  const value = costs.values[dy * costs.width + dx] as number;
  return value === costs.unset ? NOT_ENTERED : value;
}

/** The steps to `(x, y)` in the `lengths` of a step-counted flood, to a node no walk stands on from the
 *  nearest neighbour one does, or {@link NO_WALK}. */
export function walkLengthTo(lengths: FloodCosts, x: number, y: number): number {
  const own = enteredCost(lengths, x, y);
  if (own !== NOT_ENTERED) return own;
  let beside = NOT_ENTERED;
  const dxs = (y & 1) === 0 ? HEX_DX_EVEN : HEX_DX_ODD;
  for (let k = 0; k < HEX_DY.length; k++) {
    const cost = enteredCost(lengths, x + (dxs[k] as number), y + (HEX_DY[k] as number));
    if (cost < beside) beside = cost;
  }
  return beside === NOT_ENTERED ? NO_WALK : beside + 1;
}

/** Whether the flood traced by `search` read `(x, y)`: entered it, or inspected it from an entered
 *  neighbour. The hex neighbour relation is symmetric. */
export function floodInspected(search: ReachSearch, x: number, y: number): boolean {
  const costs = search.costs;
  if (enteredCost(costs, x, y) !== NOT_ENTERED) return true;
  const dxs = (y & 1) === 0 ? HEX_DX_EVEN : HEX_DX_ODD;
  for (let k = 0; k < HEX_DY.length; k++) {
    if (enteredCost(costs, x + (dxs[k] as number), y + (HEX_DY[k] as number)) !== NOT_ENTERED) return true;
  }
  return false;
}

/** The ground resistance an original range search spends: twice its nominal range. */
export function originalReachBudget(range: number): number {
  return 2 * range;
}

/** Original range searches walk six neighbours, spend {@link originalReachBudget} in ground resistance,
 *  and inspect an entered node before charging its resistance. Guide callbacks also require distance
 *  strictly below the nominal range. Byte-verified behavior; the navigation grid and blockers are ours. */
export function searchReach(
  terrain: TerrainGraph,
  blocked: BlockOverlay,
  hx: number,
  hy: number,
  range: number,
  budget = originalReachBudget(range),
  groundCost = true,
): ReachArea {
  return floodReach(terrain, blocked, hx, hy, range, budget, groundCost).area;
}

/** The box a flood from `(hx, hy)` over `range` lays its area over, whatever it marks. */
export function reachBox(terrain: TerrainGraph, hx: number, hy: number, range: number): NodeBox {
  return {
    minX: Math.max(0, hx - range + 1),
    maxX: Math.min(terrain.width - 1, hx + range - 1),
    minY: Math.max(0, hy - range + 1),
    maxY: Math.min(terrain.height - 1, hy + range - 1),
  };
}

/** {@link searchReach} with its searched box; without `groundCost` every step costs one rather than the
 *  entered node's resistance. The marked set is order-independent: a node is marked when
 *  it neighbours any node whose cheapest cost stays under the budget, so the order a bucket is walked in
 *  does not matter. With `targets` the flood stops once it has marked every target it can mark, and the
 *  answer is exact for those targets alone (see {@link reachCovers}). The flood writes over the buffers of
 *  `spent`, a search no one reads again, where they fit. */
export function floodReach(
  terrain: TerrainGraph,
  blocked: BlockOverlay,
  hx: number,
  hy: number,
  range: number,
  budget = originalReachBudget(range),
  groundCost = true,
  targets?: ReachTargets,
  spent?: ReachSearch,
): ReachSearch {
  if (budget + CLOSED_OVER_BUDGET >= ENTERED_FLAG) throw new RangeError(`reach budget ${budget} too large`);
  const { minX, maxX, minY, maxY } = reachBox(terrain, hx, hy, range);
  const width = Math.max(0, maxX - minX + 1);
  const size = width * Math.max(0, maxY - minY + 1);
  const cells = spent?.area.cells.length === size ? spent.area.cells.fill(0) : new Uint8Array(size);
  const area = { minX, maxX, minY, maxY, cells };
  const unmoved = {
    area,
    searched: { minHx: hx - 1, maxHx: hx + 1, minHy: hy - 1, maxHy: hy + 1 },
    // The start is read even when the flood goes no further, so it counts as entered.
    costs: startOnlyCosts(hx, hy, budget),
    complete: true,
  };
  if (!terrain.inBounds(hx, hy)) return unmoved;
  const start = terrain.nodeAt(hx, hy);
  if (!terrain.isWalkable(start) || blocked.has(start)) return unmoved;
  // Targets not marked yet; without targets it never reaches zero.
  let pending = targets === undefined ? NO_TARGETS : wantTargets(area, hx, hy, range, targets);
  const startCell = (hy - minY) * width + hx - minX;
  if (cells[startCell] === WANTED) pending--;
  cells[startCell] = MARKED;
  // Every entered node costs at least one, so a node with a cost under the budget lies fewer than
  // `budget` hex steps from the start, each moving at most one node on either axis, and the nodes it
  // inspects one step further.
  const reach = budget;
  const side = 2 * reach + 1;
  const windowX = hx - reach;
  const windowY = hy - reach;
  // A slot holds the node's best cost under the budget, flagged once entered, or the state of a node not
  // reached yet: never inspected, inspected and found closed, or inspected and open (so its mark is set).
  const unseen = budget + UNSEEN_OVER_BUDGET;
  const closed = budget + CLOSED_OVER_BUDGET;
  const open = budget;
  if (costScratch.length < side * side) costScratch = new Uint16Array(side * side);
  const costs = costScratch;
  costs.fill(unseen, 0, side * side);
  if (headScratch.length < budget) headScratch = new Int32Array(budget);
  const heads = headScratch;
  heads.fill(NO_ENTRY, 0, budget);
  if (entryNodes.length === 0) growEntries();
  let entries = 0;
  const resistances = terrain.walkableResistances();
  const mapWidth = terrain.width;
  const mapHeight = terrain.height;
  let poppedMinX = hx;
  let poppedMaxX = hx;
  let poppedMinY = hy;
  let poppedMaxY = hy;
  const startSlot = reach * side + reach;
  costs[startSlot] = 0;
  entryNodes[0] = start;
  entryNext[0] = NO_ENTRY;
  heads[0] = entries++;
  flood: for (let cost = 0; cost < budget && pending !== 0; cost++) {
    // Every push lands in a later bucket, so this one stays fixed while it is walked.
    for (let entry = heads[cost] as number; entry !== NO_ENTRY; entry = entryNext[entry] as number) {
      const node = entryNodes[entry] as number;
      const x = node % mapWidth;
      const y = (node - x) / mapWidth;
      const at = (y - windowY) * side + x - windowX;
      if (costs[at] !== cost) continue;
      costs[at] = cost | ENTERED_FLAG;
      if (x < poppedMinX) poppedMinX = x;
      if (x > poppedMaxX) poppedMaxX = x;
      if (y < poppedMinY) poppedMinY = y;
      if (y > poppedMaxY) poppedMaxY = y;
      const dxs = (y & 1) === 0 ? HEX_DX_EVEN : HEX_DX_ODD;
      for (let k = 0; k < HEX_DY.length; k++) {
        const nx = x + (dxs[k] as number);
        const ny = y + (HEX_DY[k] as number);
        if (nx < 0 || ny < 0 || nx >= mapWidth || ny >= mapHeight) continue;
        const slot = (ny - windowY) * side + nx - windowX;
        let known = costs[slot] as number;
        // Closed, or entered: no later step improves an entered node.
        if (known >= closed) continue;
        const id = ny * mapWidth + nx;
        const resistance = resistances[id] as number;
        if (known === unseen) {
          // The first inspection judges and marks the node; a repeat only relaxes its cost.
          if (resistance === 0 || blocked.has(id as NodeId)) {
            costs[slot] = closed;
            continue;
          }
          if (hexDistanceBetween(hx, hy, nx, ny) < range) {
            const cell = (ny - minY) * width + nx - minX;
            if (cells[cell] === WANTED && --pending === 0) {
              cells[cell] = MARKED;
              break flood;
            }
            cells[cell] = MARKED;
          }
          known = open;
          costs[slot] = open;
        }
        const nextCost = cost + (groundCost ? resistance : 1);
        if (nextCost >= known) continue;
        costs[slot] = nextCost;
        if (entries === entryNodes.length) growEntries();
        entryNodes[entries] = id;
        entryNext[entries] = heads[nextCost] as number;
        heads[nextCost] = entries++;
      }
    }
  }
  // The start is read even when the flood stops before it pops it, so it counts as entered.
  costs[startSlot] = (costs[startSlot] as number) | ENTERED_FLAG;
  // A full flood leaves the targets it could not mark wanted.
  if (pending > 0 && targets !== undefined) unwantTargets(area, targets);
  // A popped node inspects its neighbours, one node out on either axis.
  const searched = {
    minHx: Math.max(0, poppedMinX - 1),
    maxHx: Math.min(mapWidth - 1, poppedMaxX + 1),
    minHy: Math.max(0, poppedMinY - 1),
    maxHy: Math.min(mapHeight - 1, poppedMaxY + 1),
  };
  const kept = {
    minX: Math.max(0, poppedMinX - COST_BOX_MARGIN, windowX),
    minY: Math.max(0, poppedMinY - COST_BOX_MARGIN, windowY),
    maxX: Math.min(mapWidth - 1, poppedMaxX + COST_BOX_MARGIN, windowX + side - 1),
    maxY: Math.min(mapHeight - 1, poppedMaxY + COST_BOX_MARGIN, windowY + side - 1),
  };
  return {
    area,
    searched,
    costs: enteredCosts(costs, windowX, windowY, side, emptyCosts(kept, budget, spent?.costs)),
    complete: pending !== 0,
  };
}

/** A cost box for `budget` over `box`, every node not entered, written over `spent`'s values where they
 *  fit. */
function emptyCosts(box: NodeBox, budget: number, spent?: FloodCosts): FloodCosts {
  const width = box.maxX - box.minX + 1;
  const height = box.maxY - box.minY + 1;
  const size = width * height;
  const bytes = budget < BYTE_COST_UNSET;
  const unset = bytes ? BYTE_COST_UNSET : NOT_ENTERED;
  const reusable = spent !== undefined && spent.unset === unset && spent.values.length >= size;
  const values = reusable ? spent.values : bytes ? new Uint8Array(size) : new Uint16Array(size);
  values.fill(unset, 0, size);
  return { minX: box.minX, minY: box.minY, width, height, values, unset };
}

function startOnlyCosts(hx: number, hy: number, budget: number): FloodCosts {
  const costs = emptyCosts({ minX: hx, maxX: hx, minY: hy, maxY: hy }, budget);
  costs.values[0] = 0;
  return costs;
}

/** `costs` filled with the entered costs from the flood's slots over its window at `(windowX, windowY)`. */
function enteredCosts(
  slots: Uint16Array,
  windowX: number,
  windowY: number,
  side: number,
  costs: FloodCosts,
): FloodCosts {
  const values = costs.values;
  const { width, height } = costs;
  for (let y = 0; y < height; y++) {
    const from = (costs.minY + y - windowY) * side + costs.minX - windowX;
    for (let x = 0; x < width; x++) {
      const slot = slots[from + x] as number;
      if ((slot & ENTERED_FLAG) !== 0) values[y * width + x] = slot & ~ENTERED_FLAG;
    }
  }
  return costs;
}

/** The pending count of a flood without targets. */
const NO_TARGETS = -1;

/** Mark each target the flood can mark wanted, once per node, and count them. */
function wantTargets(area: ReachArea, hx: number, hy: number, range: number, targets: ReachTargets): number {
  const width = area.maxX - area.minX + 1;
  let wanted = 0;
  for (let i = 0; i < targets.count; i++) {
    const target = targets.nodes[i] as ReachTarget;
    if (!markable(area, hx, hy, range, target)) continue;
    const cell = (target.hy - area.minY) * width + target.hx - area.minX;
    if (area.cells[cell] === WANTED) continue;
    area.cells[cell] = WANTED;
    wanted++;
  }
  return wanted;
}

function unwantTargets(area: ReachArea, targets: ReachTargets): void {
  const width = area.maxX - area.minX + 1;
  for (let i = 0; i < targets.count; i++) {
    const { hx, hy } = targets.nodes[i] as ReachTarget;
    if (hx < area.minX || hx > area.maxX || hy < area.minY || hy > area.maxY) continue;
    const cell = (hy - area.minY) * width + hx - area.minX;
    if (area.cells[cell] === WANTED) area.cells[cell] = 0;
  }
}

export function unionReachAreas(areas: readonly ReachArea[]): ReachArea {
  if (areas.length === 1 && areas[0] !== undefined) return areas[0];
  if (areas.length === 0) return { minX: 0, maxX: -1, minY: 0, maxY: -1, cells: new Uint8Array() };
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const area of areas) {
    if (area.minX < minX) minX = area.minX;
    if (area.maxX > maxX) maxX = area.maxX;
    if (area.minY < minY) minY = area.minY;
    if (area.maxY > maxY) maxY = area.maxY;
  }
  const width = maxX - minX + 1;
  const cells = new Uint8Array(width * (maxY - minY + 1));
  for (const area of areas) {
    const areaWidth = area.maxX - area.minX + 1;
    const from = area.cells;
    for (let y = area.minY; y <= area.maxY; y++) {
      const fromRow = (y - area.minY) * areaWidth;
      const toRow = (y - minY) * width + area.minX - minX;
      // Cells hold only 0 or MARKED, so OR is the union without a branch per cell.
      for (let x = 0; x < areaWidth; x++)
        cells[toRow + x] = (cells[toRow + x] as number) | (from[fromRow + x] as number);
    }
  }
  return { minX, maxX, minY, maxY, cells };
}

export function intersectReach(a: SpatialGate | undefined, b: SpatialGate | null): SpatialGate | undefined {
  if (b === null) return a;
  if (a === undefined || a === b) return b;
  const near = a.mayAllowNear !== undefined || b.mayAllowNear !== undefined;
  return {
    bounds: b.bounds,
    allowsNode: (node) => a.allowsNode(node) && b.allowsNode(node),
    ...(near && {
      mayAllowNear: (x: number, y: number, radius: number) =>
        (a.mayAllowNear?.(x, y, radius) ?? true) && (b.mayAllowNear?.(x, y, radius) ?? true),
    }),
  };
}
