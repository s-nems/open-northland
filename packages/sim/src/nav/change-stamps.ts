import type { NodeArea } from './halfcell.js';

/** Nodes per block side: a reader scans only the blocks that changed since its clock reading. */
const STAMP_BLOCK_SIZE = 16;

/**
 * The clock reading of every node's latest change, and of each block's latest, so a reader holding an
 * answer from clock reading `since` finds the nodes changed after it without scanning unchanged blocks.
 * The owner advances its clock and stamps every node whose state the readers depend on.
 */
export class NodeChangeStamps {
  private readonly nodes: Float64Array;
  private readonly blocks: Float64Array;
  private readonly blockColumns: number;
  private readonly blockRows: number;

  constructor(
    private readonly width: number,
    private readonly height: number,
  ) {
    this.nodes = new Float64Array(width * height);
    this.blockColumns = Math.ceil(width / STAMP_BLOCK_SIZE);
    this.blockRows = Math.ceil(height / STAMP_BLOCK_SIZE);
    this.blocks = new Float64Array(this.blockColumns * this.blockRows);
  }

  /** Record that `(x, y)` changed at clock reading `clock`, which never decreases between calls. */
  stamp(x: number, y: number, clock: number): void {
    this.nodes[y * this.width + x] = clock;
    this.blocks[Math.floor(y / STAMP_BLOCK_SIZE) * this.blockColumns + Math.floor(x / STAMP_BLOCK_SIZE)] =
      clock;
  }

  /** Whether some node of `area` changed after clock reading `since` and passes `test`. */
  anyChangedSince(area: NodeArea, since: number, test: (x: number, y: number) => boolean): boolean {
    const minX = Math.max(0, area.minHx);
    const maxX = Math.min(this.width - 1, area.maxHx);
    const minY = Math.max(0, area.minHy);
    const maxY = Math.min(this.height - 1, area.maxHy);
    const firstColumn = Math.floor(minX / STAMP_BLOCK_SIZE);
    const lastColumn = Math.min(this.blockColumns - 1, Math.floor(maxX / STAMP_BLOCK_SIZE));
    const lastRow = Math.min(this.blockRows - 1, Math.floor(maxY / STAMP_BLOCK_SIZE));
    for (let row = Math.floor(minY / STAMP_BLOCK_SIZE); row <= lastRow; row++) {
      for (let column = firstColumn; column <= lastColumn; column++) {
        if ((this.blocks[row * this.blockColumns + column] as number) <= since) continue;
        const y1 = Math.min(maxY, row * STAMP_BLOCK_SIZE + STAMP_BLOCK_SIZE - 1);
        const x1 = Math.min(maxX, column * STAMP_BLOCK_SIZE + STAMP_BLOCK_SIZE - 1);
        for (let y = Math.max(minY, row * STAMP_BLOCK_SIZE); y <= y1; y++) {
          for (let x = Math.max(minX, column * STAMP_BLOCK_SIZE); x <= x1; x++) {
            if ((this.nodes[y * this.width + x] as number) > since && test(x, y)) return true;
          }
        }
      }
    }
    return false;
  }
}
