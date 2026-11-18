import type { ContentSet } from '@open-northland/data';
import type { World } from '../../ecs/world.js';
import { type NodeBox, unionNodeBoxes } from '../../nav/node-circle.js';
import { type ReachArea, reachBox } from '../../nav/range-search.js';
import type { TerrainGraph } from '../../nav/terrain/index.js';
import type { WalkBlockMask } from '../footprint/walk-block-mask.js';
import type { SignpostSite } from './network.js';
import { ChangedNodeList, postTerrainReach, type ReachSpan, signpostMask } from './terrain-reach.js';

/** Nodes per side of the blocks a coverage re-checks its posts by. */
const COVERAGE_BLOCK_NODES = 16;
/** The epoch reading of a post or block never checked. */
const UNCHECKED = -1;
/** Per post, the four bounds of the box its held search read. */
const BOX_FIELDS = 4;
const MIN_X = 0;
const MAX_X = 1;
const MIN_Y = 2;
const MAX_Y = 3;

function sameBox(a: ReachArea, b: ReachArea): boolean {
  return a.minX === b.minX && a.maxX === b.maxX && a.minY === b.minY && a.maxY === b.maxY;
}

/** The union of the fresh posts' read boxes a scan lists changes over. */
const scanArea = { minHx: 0, maxHx: 0, minHy: 0, maxHy: 0 };
/** The changes a scan lists and then marks its posts by. */
const scanChanges = new ChangedNodeList();

/**
 * A signpost group's coverage under one span: the nodes some post's search of that span marks. It keeps each post's
 * search and, per node, how many of those searches mark it. Asked about a node, it re-checks only the
 * posts whose search box meets that node's block, once per reach epoch, so a node's count is exact
 * whatever the other posts hold, and a post whose search changed costs its own area, not a new union.
 * Once per epoch it lists the nodes changed since its previous scan over the boxes its held searches
 * read, and asks again only the posts a change met: a search none met answers as it did.
 */
export class GroupCoverage {
  /** The union of the posts' search boxes, whatever the searches mark. */
  readonly bounds: NodeBox;
  private readonly width: number;
  private readonly counts: Uint16Array;
  private readonly held: (ReachArea | undefined)[];
  private readonly postCheckedAt: Float64Array;
  private readonly blockColumns: number;
  /** Per block, the posts whose search box meets it. */
  private readonly blockPosts: number[][];
  private readonly blockCheckedAt: Float64Array;
  /** Per post, whether a change may have met its held search since it was asked. */
  private readonly stale: Uint8Array;
  private readonly readBoxes: Int32Array;
  /** The epoch, mask, mask version and resistance clock of the latest scan. */
  private scannedAt = UNCHECKED;
  private scannedMask: WalkBlockMask | undefined;
  private scannedMaskVersion = 0;
  private scannedResistanceClock = 0;

  constructor(
    private readonly world: World,
    private readonly content: ContentSet,
    private readonly terrain: TerrainGraph,
    readonly posts: readonly SignpostSite[],
    private readonly span: ReachSpan,
  ) {
    const range = span.range;
    const boxes = posts.map((p) => reachBox(terrain, p.hx, p.hy, range));
    this.bounds = unionNodeBoxes(boxes);
    const { minX, maxX, minY, maxY } = this.bounds;
    this.width = Math.max(0, maxX - minX + 1);
    const height = Math.max(0, maxY - minY + 1);
    this.counts = new Uint16Array(this.width * height);
    this.held = posts.map(() => undefined);
    this.postCheckedAt = new Float64Array(posts.length).fill(UNCHECKED);
    this.stale = new Uint8Array(posts.length);
    this.readBoxes = new Int32Array(BOX_FIELDS * posts.length);
    this.blockColumns = Math.ceil(this.width / COVERAGE_BLOCK_NODES);
    const blockRows = Math.ceil(height / COVERAGE_BLOCK_NODES);
    this.blockPosts = Array.from({ length: this.blockColumns * blockRows }, () => []);
    this.blockCheckedAt = new Float64Array(this.blockPosts.length).fill(UNCHECKED);
    boxes.forEach((box, i) => {
      if (box.minX > box.maxX || box.minY > box.maxY) return;
      const lastRow = Math.floor((box.maxY - minY) / COVERAGE_BLOCK_NODES);
      const lastColumn = Math.floor((box.maxX - minX) / COVERAGE_BLOCK_NODES);
      for (let row = Math.floor((box.minY - minY) / COVERAGE_BLOCK_NODES); row <= lastRow; row++)
        for (
          let column = Math.floor((box.minX - minX) / COVERAGE_BLOCK_NODES);
          column <= lastColumn;
          column++
        )
          (this.blockPosts[row * this.blockColumns + column] as number[]).push(i);
    });
  }

  /** Whether some post's search marks `(x, y)`, with the posts' searches current as of reach
   *  `epoch`, a reading that moves with every mask or road change. */
  covers(x: number, y: number, epoch: number): boolean {
    const { minX, maxX, minY, maxY } = this.bounds;
    if (x < minX || x > maxX || y < minY || y > maxY) return false;
    const block =
      Math.floor((y - minY) / COVERAGE_BLOCK_NODES) * this.blockColumns +
      Math.floor((x - minX) / COVERAGE_BLOCK_NODES);
    if (this.blockCheckedAt[block] !== epoch) {
      this.scan(epoch);
      for (const i of this.blockPosts[block] as number[]) this.checkPost(i, epoch);
      this.blockCheckedAt[block] = epoch;
    }
    return this.counts[(y - minY) * this.width + x - minX] !== 0;
  }

  /** Mark stale every held post a node changed since the previous scan may have met. */
  private scan(epoch: number): void {
    if (this.scannedAt === epoch) return;
    this.scannedAt = epoch;
    const { world, content, terrain } = this;
    const mask = signpostMask(world, content, terrain);
    const maskVersion = mask.version;
    const resistanceClock = terrain.resistanceClock;
    if (mask === this.scannedMask && this.listChanges(mask, terrain)) this.markMet();
    else this.stale.fill(1);
    this.scannedMask = mask;
    this.scannedMaskVersion = maskVersion;
    this.scannedResistanceClock = resistanceClock;
  }

  /** List the nodes changed since the previous scan inside the fresh posts' read boxes; false when too
   *  many changed. */
  private listChanges(mask: WalkBlockMask, terrain: TerrainGraph): boolean {
    scanArea.minHx = Number.MAX_SAFE_INTEGER;
    scanArea.maxHx = -1;
    scanArea.minHy = Number.MAX_SAFE_INTEGER;
    scanArea.maxHy = -1;
    const boxes = this.readBoxes;
    for (let i = 0; i < this.posts.length; i++) {
      if (this.stale[i] !== 0 || this.held[i] === undefined) continue;
      const at = BOX_FIELDS * i;
      scanArea.minHx = Math.min(scanArea.minHx, boxes[at + MIN_X] as number);
      scanArea.maxHx = Math.max(scanArea.maxHx, boxes[at + MAX_X] as number);
      scanArea.minHy = Math.min(scanArea.minHy, boxes[at + MIN_Y] as number);
      scanArea.maxHy = Math.max(scanArea.maxHy, boxes[at + MAX_Y] as number);
    }
    if (scanArea.maxHx < 0) return false;
    return scanChanges.listSince(
      mask,
      terrain,
      scanArea,
      this.scannedMaskVersion,
      this.scannedResistanceClock,
    );
  }

  /** Mark stale each fresh post whose read box holds a listed change. */
  private markMet(): void {
    const boxes = this.readBoxes;
    for (let i = 0; i < this.posts.length; i++) {
      if (this.stale[i] !== 0 || this.held[i] === undefined) continue;
      const at = BOX_FIELDS * i;
      if (
        scanChanges.meets(
          boxes[at + MIN_X] as number,
          boxes[at + MAX_X] as number,
          boxes[at + MIN_Y] as number,
          boxes[at + MAX_Y] as number,
        )
      )
        this.stale[i] = 1;
    }
  }

  private checkPost(i: number, epoch: number): void {
    if (this.postCheckedAt[i] === epoch) return;
    this.postCheckedAt[i] = epoch;
    const held = this.held[i];
    if (held !== undefined && this.stale[i] === 0) return;
    const post = this.posts[i] as SignpostSite;
    const { world, content, terrain, span } = this;
    const found = postTerrainReach(world, content, terrain, post.entity, post.hx, post.hy, span);
    this.stale[i] = 0;
    const at = BOX_FIELDS * i;
    this.readBoxes[at + MIN_X] = found.searched.minHx;
    this.readBoxes[at + MAX_X] = found.searched.maxHx;
    this.readBoxes[at + MIN_Y] = found.searched.minHy;
    this.readBoxes[at + MAX_Y] = found.searched.maxHy;
    if (found.area === held) return;
    if (held !== undefined && sameBox(held, found.area)) this.recount(held, found.area);
    else {
      if (held !== undefined) this.count(held, -1);
      this.count(found.area, 1);
    }
    this.held[i] = found.area;
  }

  /** Move the counts from `was` to `now` over the box both share, touching only the cells that moved: a
   *  repaired search keeps its box and moves a few marks. */
  private recount(was: ReachArea, now: ReachArea): void {
    const areaWidth = now.maxX - now.minX + 1;
    const { minX, minY } = this.bounds;
    const counts = this.counts;
    const before = was.cells;
    const after = now.cells;
    for (let y = now.minY; y <= now.maxY; y++) {
      const from = (y - now.minY) * areaWidth;
      const to = (y - minY) * this.width + now.minX - minX;
      for (let x = 0; x < areaWidth; x++) {
        const moved = (after[from + x] as number) - (before[from + x] as number);
        if (moved !== 0) counts[to + x] = (counts[to + x] as number) + moved;
      }
    }
  }

  /** Add `sign` times each node `area` marks to the counts. */
  private count(area: ReachArea, sign: number): void {
    const areaWidth = area.maxX - area.minX + 1;
    const { minX, minY } = this.bounds;
    const counts = this.counts;
    const cells = area.cells;
    for (let y = area.minY; y <= area.maxY; y++) {
      const from = (y - area.minY) * areaWidth;
      const to = (y - minY) * this.width + area.minX - minX;
      // A returned reach area holds only 0 or MARKED (1), since a flood clears its WANTED targets before
      // returning (`nav/range-search.ts`), so the product is the change without a branch per cell.
      for (let x = 0; x < areaWidth; x++)
        counts[to + x] = (counts[to + x] as number) + sign * (cells[from + x] as number);
    }
  }
}
