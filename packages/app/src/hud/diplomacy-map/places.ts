import { fogTileVisible, ONE, type RememberedMarkers } from '@open-northland/render';
import { entityById, type FogView, type WorldSnapshot } from '@open-northland/sim';
import { entityIdsWith } from '../../game/snapshot/id-index.js';
import { isWildlife, ownerPlayerOf, positionOf } from '../../game/snapshot/index.js';
import type { Rect } from '../geometry.js';

/** Something of `owner`'s the viewer knows the place of, in fractional tile coordinates. */
export interface OwnedSpot {
  readonly owner: number;
  readonly col: number;
  readonly row: number;
}

/** One group of an owner's spots, placed at their centroid in tile coordinates. */
export interface Settlement {
  readonly owner: number;
  readonly col: number;
  readonly row: number;
  readonly buildings: number;
}

/** A label's box in px, `(x, y)` being the top-left it wants; `key` is unique among the boxes laid out. */
export interface LabelBox {
  readonly key: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Where a label's box ended up. */
export interface LabelSpot {
  readonly key: string;
  readonly x: number;
  readonly y: number;
}

// Tuned project choices for how a map reads, an approximation, not the original's behaviour.
const SETTLEMENT_GRID_TILES = 32;
const MIN_SETTLEMENT_BUILDINGS = 3;

/**
 * The buildings the minimap would mark for this view, so the labels built on them tell nothing the fog
 * hides: live ones on visible ground, then, under fog, the remembered ones on explored ground.
 */
export function knownBuildings(
  snapshot: WorldSnapshot,
  fog: FogView | null,
  memory: RememberedMarkers | undefined,
): OwnedSpot[] {
  const known: OwnedSpot[] = [];
  for (const id of entityIdsWith(snapshot, 'Building')) {
    const entity = entityById(snapshot, id);
    if (entity === undefined) continue;
    const owner = ownerPlayerOf(entity);
    if (owner === undefined) continue;
    const at = positionOf(entity);
    if (at === undefined) continue;
    const col = at.x / ONE;
    const row = at.y / ONE;
    if (fog !== null && !fogTileVisible(fog, col, row)) continue;
    known.push({ owner, col, row });
  }
  if (fog === null) return known;
  for (const ghost of memory?.markers([]) ?? []) {
    if (ghost.kind === 'building' && ghost.owner !== undefined)
      known.push({ owner: ghost.owner, col: ghost.tileX, row: ghost.tileY });
  }
  return known;
}

/** Where `owner`'s people stand: all a nation that has raised no building yet has to be placed by. A
 *  walk over the settlers, so it is for the viewer's own nation alone, which fog cannot hide from itself. */
export function peopleOf(snapshot: WorldSnapshot, owner: number): OwnedSpot[] {
  const people: OwnedSpot[] = [];
  for (const id of entityIdsWith(snapshot, 'Settler')) {
    const entity = entityById(snapshot, id);
    if (entity === undefined || isWildlife(entity) || ownerPlayerOf(entity) !== owner) continue;
    const at = positionOf(entity);
    if (at === undefined) continue;
    people.push({ owner, col: at.x / ONE, row: at.y / ONE });
  }
  return people;
}

/**
 * Each owner's settlements, owners ascending, largest first, ties west then north. An owner's buildings
 * group over the 8-connected occupied cells of a coarse grid. Only a sizeable group counts, save the
 * owner's largest, so a lone outpost earns no label but a nation of one hut still gets one.
 */
export function settlementsOf(buildings: readonly OwnedSpot[]): Settlement[] {
  // Sorted first, so neither the grouping nor a float sum depends on the input order.
  const byOwner = new Map<number, OwnedSpot[]>();
  for (const building of [...buildings].sort(byOwnerAndPlace)) {
    const owned = byOwner.get(building.owner);
    if (owned === undefined) byOwner.set(building.owner, [building]);
    else owned.push(building);
  }
  return [...byOwner.entries()].flatMap(([owner, owned]) =>
    connectedGroups(owned)
      .map((group) => settlementOf(owner, group))
      .sort(byLargestFirst)
      .filter((settlement, rank) => rank === 0 || settlement.buildings >= MIN_SETTLEMENT_BUILDINGS),
  );
}

function byOwnerAndPlace(a: OwnedSpot, b: OwnedSpot): number {
  return a.owner - b.owner || a.col - b.col || a.row - b.row;
}

function byLargestFirst(a: Settlement, b: Settlement): number {
  return b.buildings - a.buildings || a.col - b.col || a.row - b.row;
}

function settlementOf(owner: number, group: readonly OwnedSpot[]): Settlement {
  let col = 0;
  let row = 0;
  for (const building of group) {
    col += building.col;
    row += building.row;
  }
  return { owner, col: col / group.length, row: row / group.length, buildings: group.length };
}

function gridKey(gridCol: number, gridRow: number): string {
  return `${gridCol},${gridRow}`;
}

interface GridCell {
  readonly gridCol: number;
  readonly gridRow: number;
  readonly members: OwnedSpot[];
}

function connectedGroups(owned: readonly OwnedSpot[]): OwnedSpot[][] {
  const cells = new Map<string, GridCell>();
  for (const building of owned) {
    const gridCol = Math.floor(building.col / SETTLEMENT_GRID_TILES);
    const gridRow = Math.floor(building.row / SETTLEMENT_GRID_TILES);
    const key = gridKey(gridCol, gridRow);
    const cell = cells.get(key);
    if (cell === undefined) cells.set(key, { gridCol, gridRow, members: [building] });
    else cell.members.push(building);
  }
  const groups: OwnedSpot[][] = [];
  const reached = new Set<string>();
  for (const [key, seed] of cells) {
    if (reached.has(key)) continue;
    reached.add(key);
    const group: OwnedSpot[] = [];
    const frontier = [seed];
    for (let cell = frontier.pop(); cell !== undefined; cell = frontier.pop()) {
      group.push(...cell.members);
      for (let dRow = -1; dRow <= 1; dRow++) {
        for (let dCol = -1; dCol <= 1; dCol++) {
          const near = gridKey(cell.gridCol + dCol, cell.gridRow + dRow);
          const neighbour = cells.get(near);
          if (neighbour === undefined || reached.has(near)) continue;
          reached.add(near);
          frontier.push(neighbour);
        }
      }
    }
    groups.push(group);
  }
  return groups;
}

interface MovingBox {
  readonly key: string;
  x: number;
  y: number;
  readonly w: number;
  readonly h: number;
}

interface Axis {
  readonly start: 'x' | 'y';
  readonly size: 'w' | 'h';
}

const ACROSS: Axis = { start: 'x', size: 'w' };
const DOWN: Axis = { start: 'y', size: 'h' };

/** `start` kept inside the span of `bounds` along `axis`; a box too big to fit sits at the low edge. */
function clampedStart(start: number, size: number, bounds: Rect, axis: Axis): number {
  const low = bounds[axis.start];
  return Math.max(low, Math.min(start, low + bounds[axis.size] - size));
}

/** The starts along `axis` where the nearest free spot can lie: the wanted one, an edge of `bounds`, or
 *  flush against a placed box. */
function stopsAlong(box: MovingBox, placed: readonly MovingBox[], bounds: Rect, axis: Axis): number[] {
  const { start, size } = axis;
  const low = bounds[start];
  const high = low + bounds[size] - box[size];
  const stops = [box[start], low, high];
  for (const other of placed) stops.push(other[start] - box[size], other[start] + other[size]);
  return stops.filter((stop) => stop >= low && stop <= high);
}

function overlapsAny(box: MovingBox, x: number, y: number, placed: readonly MovingBox[]): boolean {
  return placed.some(
    (other) => x < other.x + other.w && other.x < x + box.w && y < other.y + other.h && other.y < y + box.h,
  );
}

/** Move `box` to the free spot nearest where it stands; with none free it stays and overlaps. */
function settle(box: MovingBox, placed: readonly MovingBox[], bounds: Rect): void {
  const xs = stopsAlong(box, placed, bounds, ACROSS);
  const ys = stopsAlong(box, placed, bounds, DOWN);
  const { x: wantedX, y: wantedY } = box;
  let nearest = Number.POSITIVE_INFINITY;
  for (const x of xs) {
    for (const y of ys) {
      const distance = Math.hypot(x - wantedX, y - wantedY);
      if (distance >= nearest || overlapsAny(box, x, y, placed)) continue;
      nearest = distance;
      box.x = x;
      box.y = y;
    }
  }
}

/**
 * Nudges `labels` apart and inside `bounds`, answering in input order. Boxes settle one by one in key
 * order, so the answer ignores the input order and needs no passes. Each takes its nearest free spot,
 * which leaves a box overlapping only when the boxes before it left no gap: a crowded layout may overlap
 * even if a tighter packing exists.
 */
export function spreadLabels(labels: readonly LabelBox[], bounds: Rect): LabelSpot[] {
  const boxes: MovingBox[] = labels.map((label) => ({
    ...label,
    x: clampedStart(label.x, label.w, bounds, ACROSS),
    y: clampedStart(label.y, label.h, bounds, DOWN),
  }));
  const placed: MovingBox[] = [];
  for (const box of [...boxes].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))) {
    settle(box, placed, bounds);
    placed.push(box);
  }
  return boxes.map(({ key, x, y }) => ({ key, x, y }));
}
