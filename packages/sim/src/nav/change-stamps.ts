import type { NodeArea } from './halfcell.js';

/** Nodes per block side: a reader scans only the blocks that changed since its clock reading. */
const STAMP_BLOCK_SIZE = 16;
/** The largest clock offset above {@link NodeChangeStamps.base} an Int32 stamp holds. */
const MAX_STAMP_OFFSET = 2 ** 31 - 1;

/**
 * The clock reading of every node's latest change, of each block's latest and of each block row's latest,
 * so a reader holding an answer from clock reading `since` finds the nodes changed after it without
 * scanning unchanged blocks or the unchanged rows of a changed block.
 * The owner advances its clock and stamps every node whose state the readers depend on.
 *
 * Stamps hold the clock minus {@link base}. A clock too far past the base rebases: every earlier stamp
 * then reads as the new base, which a reader holding an older `since` sees as a change. Readers are
 * caches that recompute on a change, so that over-report costs a recompute and never an answer.
 */
export class NodeChangeStamps {
  private readonly nodes: Int32Array;
  private readonly blocks: Int32Array;
  /** Per node row and block column, indexed `y * blockColumns + column`. */
  private readonly blockRowStamps: Int32Array;
  private base = 0;
  /** The latest stamp any node holds, as an offset from {@link base}. */
  private latest = 0;
  private readonly blockColumns: number;
  private readonly blockRows: number;

  constructor(
    private readonly width: number,
    private readonly height: number,
  ) {
    this.nodes = new Int32Array(width * height);
    this.blockColumns = Math.ceil(width / STAMP_BLOCK_SIZE);
    this.blockRows = Math.ceil(height / STAMP_BLOCK_SIZE);
    this.blocks = new Int32Array(this.blockColumns * this.blockRows);
    this.blockRowStamps = new Int32Array(this.blockColumns * height);
  }

  /** Record that `(x, y)` changed at clock reading `clock`, which never decreases between calls. */
  stamp(x: number, y: number, clock: number): void {
    if (clock - this.base > MAX_STAMP_OFFSET) this.rebase(clock);
    const offset = clock - this.base;
    this.latest = offset;
    const column = Math.floor(x / STAMP_BLOCK_SIZE);
    this.nodes[y * this.width + x] = offset;
    this.blocks[Math.floor(y / STAMP_BLOCK_SIZE) * this.blockColumns + column] = offset;
    this.blockRowStamps[y * this.blockColumns + column] = offset;
  }

  /** Whether some node of `area` changed after clock reading `since` and passes `test`. Only the test
   *  that nothing changed anywhere since, small enough for a cache check to inline. */
  anyChangedSince(area: NodeArea, since: number, test: (x: number, y: number) => boolean): boolean {
    return this.latest > since - this.base && this.scanChangedSince(area, since, test);
  }

  private scanChangedSince(area: NodeArea, since: number, test: (x: number, y: number) => boolean): boolean {
    const minX = Math.max(0, area.minHx);
    const maxX = Math.min(this.width - 1, area.maxHx);
    const minY = Math.max(0, area.minHy);
    const maxY = Math.min(this.height - 1, area.maxHy);
    const firstColumn = Math.floor(minX / STAMP_BLOCK_SIZE);
    const lastColumn = Math.min(this.blockColumns - 1, Math.floor(maxX / STAMP_BLOCK_SIZE));
    const lastRow = Math.min(this.blockRows - 1, Math.floor(maxY / STAMP_BLOCK_SIZE));
    const sinceOffset = since - this.base;
    for (let row = Math.floor(minY / STAMP_BLOCK_SIZE); row <= lastRow; row++) {
      for (let column = firstColumn; column <= lastColumn; column++) {
        if ((this.blocks[row * this.blockColumns + column] as number) <= sinceOffset) continue;
        const y1 = Math.min(maxY, row * STAMP_BLOCK_SIZE + STAMP_BLOCK_SIZE - 1);
        const x1 = Math.min(maxX, column * STAMP_BLOCK_SIZE + STAMP_BLOCK_SIZE - 1);
        for (let y = Math.max(minY, row * STAMP_BLOCK_SIZE); y <= y1; y++) {
          if ((this.blockRowStamps[y * this.blockColumns + column] as number) <= sinceOffset) continue;
          for (let x = Math.max(minX, column * STAMP_BLOCK_SIZE); x <= x1; x++) {
            if ((this.nodes[y * this.width + x] as number) > sinceOffset && test(x, y)) return true;
          }
        }
      }
    }
    return false;
  }

  /** Move the base just under `clock`, flattening every held stamp to the new base. */
  private rebase(clock: number): void {
    this.base = clock - 1;
    this.latest = 0;
    this.nodes.fill(0);
    this.blocks.fill(0);
    this.blockRowStamps.fill(0);
  }
}
