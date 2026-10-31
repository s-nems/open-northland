import type { KnowledgeBase, KnowledgeBuilding } from './base.js';
import { downstreamOf, inputsOf, outputsOf, upstreamOf } from './chains.js';
import { BUILDING_LANES, type LaneNode } from './lanes.js';

export const CARD_WIDTH = 166;
export const GOOD_CARD_HEIGHT = 46;
export const BUILDING_CARD_HEIGHT = 50;
const GUTTER = 36;
const ROW_GAP = 8;
const LANE_PADDING = 8;
const CORNER = 7;
const ARROW = 7;
/** Half the height of the arrow head's back edge. */
const ARROW_SPREAD = ARROW - 2;
/** The shortest control arm of a link that leaves its lane. */
const MIN_SPOT_SPAN = 40;
/** Past this many outputs a pointed card draws only its inputs: the rest would hide the tree. */
const MANY_OUTPUTS = 6;

const GOOD_KEY_PREFIX = 'good:';
const BUILDING_KEY_PREFIX = 'building:';

/** A node of the tree being laid out; `key` is how lines and relations name its card. */
export interface TreeNode {
  readonly key: string;
  readonly kids: readonly TreeNode[];
}

/** A card's place in its lane plane, in pixels. */
export interface TreeCard {
  readonly key: string;
  readonly col: number;
  readonly row: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The line joining a card to its parent, as SVG path data. */
export interface TreeLine {
  readonly from: string;
  readonly to: string;
  readonly path: string;
  readonly head: string;
}

export interface TreeLaneLayout {
  readonly width: number;
  readonly height: number;
  readonly cards: readonly TreeCard[];
  readonly lines: readonly TreeLine[];
}

export type RelationKind = 'down' | 'up';

export interface TreeLink {
  readonly from: string;
  readonly to: string;
  readonly kind: RelationKind;
}

/** A card's chain: the keys above and below it, and the links worth drawing across lanes. */
export interface TreeRelation {
  readonly up: ReadonlySet<string>;
  readonly down: ReadonlySet<string>;
  readonly links: readonly TreeLink[];
}

/** A card's box inside the tree plane, in unzoomed pixels. */
export interface PlaneRect {
  readonly left: number;
  readonly right: number;
  readonly mid: number;
}

interface PlacedNode {
  readonly node: TreeNode;
  readonly col: number;
  row: number;
  kids: readonly PlacedNode[];
}

interface BusCell {
  readonly col: number;
  readonly row: number;
}

/** A subtree's cards relative to its root, each parent level with its first child, so that child's line
 *  runs straight. */
function shape(
  node: TreeNode,
  col: number,
  row: number,
  cards: PlacedNode[],
  buses: BusCell[],
): { readonly at: PlacedNode; readonly next: number } {
  const at: PlacedNode = { node, col, row, kids: [] };
  cards.push(at);
  if (node.kids.length === 0) return { at, next: row + 1 };
  let next = row;
  at.kids = node.kids.map((kid) => {
    const placed = shape(kid, col + 1, next, cards, buses);
    next = placed.next;
    return placed.at;
  });
  const lastRow = at.kids.at(-1)?.row ?? row;
  for (let r = row; r <= lastRow; r += 1) buses.push({ col, row: r });
  return { at, next };
}

/** Each root takes the first row where its cards and its lines touch nothing already placed. */
function placeRoots(roots: readonly TreeNode[]): PlacedNode[] {
  const taken = new Set<string>();
  const placed: PlacedNode[] = [];
  for (const root of roots) {
    const cards: PlacedNode[] = [];
    const buses: BusCell[] = [];
    shape(root, 0, 0, cards, buses);
    const cells = (dy: number): string[] => [
      ...cards.map((c) => `c${c.col}:${c.row + dy}`),
      ...buses.map((b) => `g${b.col}:${b.row + dy}`),
    ];
    let dy = 0;
    while (cells(dy).some((cell) => taken.has(cell))) dy += 1;
    for (const cell of cells(dy)) taken.add(cell);
    for (const card of cards) card.row += dy;
    placed.push(...cards);
  }
  return placed;
}

function linePath(x1: number, y1: number, x2: number, y2: number): string {
  if (y1 === y2) return `M${x1} ${y1}H${x2}`;
  const bus = x1 + GUTTER / 2 - ARROW / 2;
  return `M${x1} ${y1}H${bus - CORNER}Q${bus} ${y1} ${bus} ${y1 + CORNER}V${y2 - CORNER}Q${bus} ${y2} ${bus + CORNER} ${y2}H${x2}`;
}

function arrowHead(x: number, y: number): string {
  return `M${x} ${y}l-${ARROW} -${ARROW_SPREAD}v${ARROW_SPREAD * 2}z`;
}

/** One lane's plane: where its cards stand and how its lines run. A line only ever joins a card to its
 *  parent in the same lane, so lines cannot cross. */
export function layoutLane(roots: readonly TreeNode[], cardHeight: number): TreeLaneLayout {
  const placed = placeRoots(roots);
  const lastCol = Math.max(0, ...placed.map((p) => p.col));
  const rows = 1 + Math.max(0, ...placed.map((p) => p.row));
  const xOf = (col: number): number => LANE_PADDING + col * (CARD_WIDTH + GUTTER);
  const yOf = (row: number): number => LANE_PADDING + row * (cardHeight + ROW_GAP);
  const midOf = (row: number): number => yOf(row) + cardHeight / 2;
  return {
    width: xOf(lastCol) + CARD_WIDTH + LANE_PADDING,
    height: yOf(rows) - ROW_GAP + LANE_PADDING,
    cards: placed.map(({ node, col, row }) => ({
      key: node.key,
      col,
      row,
      x: xOf(col),
      y: yOf(row),
      width: CARD_WIDTH,
      height: cardHeight,
    })),
    lines: placed.flatMap((parent) =>
      parent.kids.map((kid) => ({
        from: parent.node.key,
        to: kid.node.key,
        path: linePath(xOf(parent.col) + CARD_WIDTH, midOf(parent.row), xOf(kid.col) - ARROW, midOf(kid.row)),
        head: arrowHead(xOf(kid.col), midOf(kid.row)),
      })),
    ),
  };
}

/** A link between cards of different lanes, with its arrow head. */
export function spotLine(from: PlaneRect, to: PlaneRect): { readonly path: string; readonly head: string } {
  const span = Math.max(MIN_SPOT_SPAN, Math.abs(to.left - from.right) / 2);
  const end = to.left - ARROW;
  return {
    path: `M${from.right} ${from.mid}C${from.right + span} ${from.mid},${end - span} ${to.mid},${end} ${to.mid}`,
    head: arrowHead(to.left, to.mid),
  };
}

export const goodKey = (id: string): string => `${GOOD_KEY_PREFIX}${id}`;
export const buildingKey = (id: string): string => `${BUILDING_KEY_PREFIX}${id}`;

/** An authored lane node as a tree node, each card keyed by `key`. */
export function treeNodeOf(node: LaneNode, key: (id: string) => string): TreeNode {
  return { key: key(node.id), kids: node.kids.map((kid) => treeNodeOf(kid, key)) };
}

/** A good's card chain: everything it is made from and everything it goes into. `everyLink` keeps a
 *  pinned card's outputs however many, since the reader asked to follow them. */
export function relateGood(base: KnowledgeBase, key: string, everyLink = false): TreeRelation {
  const good = base.goodById.get(key.slice(GOOD_KEY_PREFIX.length));
  if (good === undefined) return { up: new Set(), down: new Set(), links: [] };
  const keyOf = (type: number): string[] => {
    const id = base.goodByType.get(type)?.id;
    return id === undefined ? [] : [goodKey(id)];
  };
  const keysOf = (types: ReadonlySet<number>): Set<string> => new Set([...types].flatMap(keyOf));
  const inputs = inputsOf(base, good.typeId).flatMap((e) =>
    keyOf(e.from).map((from): TreeLink => ({ from, to: key, kind: 'up' })),
  );
  const outputs = outputsOf(base, good.typeId);
  const links =
    outputs.length > MANY_OUTPUTS && !everyLink
      ? inputs
      : [
          ...inputs,
          ...outputs.flatMap((e) => keyOf(e.to).map((to): TreeLink => ({ from: key, to, kind: 'down' }))),
        ];
  return {
    up: keysOf(upstreamOf(base, good.typeId)),
    down: keysOf(downstreamOf(base, good.typeId)),
    links,
  };
}

/** The trades a workshop keeps besides its own; they say nothing about what it is for. */
const SUPPORT_JOBS: ReadonlySet<string> = new Set(['carrier', 'collector']);

/** The trade a workplace exists for. */
export function tradeOf(base: KnowledgeBase, building: KnowledgeBuilding) {
  if (building.kind !== 'workplace') return undefined;
  return building.workers.find((w) => {
    const job = base.jobByType.get(w.jobType);
    return job === undefined || !SUPPORT_JOBS.has(job.id);
  });
}

function buildingParents(): ReadonlyMap<string, string> {
  const parents = new Map<string, string>();
  const walk = (node: LaneNode): void => {
    for (const kid of node.kids) {
      parents.set(kid.id, node.id);
      walk(kid);
    }
  };
  for (const lane of BUILDING_LANES) lane.roots.forEach(walk);
  return parents;
}

const PARENT_OF_BUILDING = buildingParents();

/** A building's card chain: the steps before it, what its discoveries wait on, and what it opens. */
export function relateBuilding(base: KnowledgeBase, key: string): TreeRelation {
  const id = key.slice(BUILDING_KEY_PREFIX.length);
  const up = new Set<string>();
  const links: TreeLink[] = [];
  for (let at = PARENT_OF_BUILDING.get(id); at !== undefined; at = PARENT_OF_BUILDING.get(at)) {
    up.add(buildingKey(at));
  }
  for (const job of base.buildingById.get(id)?.tech?.jobs ?? []) {
    const place = base.buildings.find((b) => tradeOf(base, b)?.jobType === job.id);
    if (place === undefined || place.id === id) continue;
    up.add(buildingKey(place.id));
    links.push({ from: buildingKey(place.id), to: key, kind: 'up' });
  }
  const down = new Set<string>();
  const collect = (parent: string): void => {
    for (const [child, of] of PARENT_OF_BUILDING) {
      if (of === parent) {
        down.add(buildingKey(child));
        collect(child);
      }
    }
  };
  collect(id);
  return { up, down, links };
}
