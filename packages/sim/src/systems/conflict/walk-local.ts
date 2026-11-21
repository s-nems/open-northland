import type { BlockOverlay } from '../../nav/block-overlay.js';
import { hexDistanceBetween } from '../../nav/halfcell.js';
import { StepFlood } from '../../nav/step-flood.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';

/**
 * How many nodes one chaser's walk flood visits before it stops and answers from the nodes it reached.
 * Authored: a cost guard above the few steps round a unit and the ground along the largest building body.
 */
const WALK_LOCAL_NODES = 1024;

/** One terrain's flood scratch, shared by every chaser on it: the flood, and the stamped cells a walk along
 *  a building keeps to. */
interface Scratch {
  readonly flood: StepFlood;
  readonly sideMarks: Int32Array;
  sideStamp: number;
  /** The cells {@link sideStamp} marks. */
  stamped: readonly NodeId[] | undefined;
}

const scratchByTerrain = new WeakMap<TerrainGraph, Scratch>();

/** The largest side stamp before the stamps wrap and are cleared. */
const MAX_STAMP = 0x7fffffff;

/** A walk's overlay kept to the marked cells: every other node is closed. */
class KeptToSide implements BlockOverlay {
  base: BlockOverlay | undefined;
  readonly size = 1;
  constructor(private readonly scratch: Scratch) {}
  has(node: NodeId): boolean {
    return this.scratch.sideMarks[node] !== this.scratch.sideStamp || this.base?.has(node) === true;
  }
}

/**
 * The nodes one chaser reaches by walking, the way it walks: round walls and enemy bodies, through
 * friends, and for a walk {@link along} a building only on the cells beside it. Flooded level by level on
 * the asks after {@link begin}, each only as deep as it needs, so a chaser that finds no free cell to ask
 * about floods nothing; valid until the next begin.
 */
export class WalkLocal {
  private readonly scratch: Scratch;
  private readonly kept: KeptToSide;
  private origin = 0 as NodeId;
  private overlay: BlockOverlay | undefined;
  private side: readonly NodeId[] | undefined;
  private flooding = false;
  /** Whether the flood may still expand: begun, not run dry and under {@link WALK_LOCAL_NODES}. */
  private open = false;

  constructor(private readonly terrain: TerrainGraph) {
    let scratch = scratchByTerrain.get(terrain);
    if (scratch === undefined) {
      scratch = {
        flood: new StepFlood(terrain),
        sideMarks: new Int32Array(terrain.nodeCount),
        sideStamp: 0,
        stamped: undefined,
      };
      scratchByTerrain.set(terrain, scratch);
    }
    this.scratch = scratch;
    this.kept = new KeptToSide(scratch);
  }

  begin(origin: NodeId, overlay: BlockOverlay): void {
    this.origin = origin;
    this.overlay = overlay;
    this.side = undefined;
    this.flooding = false;
  }

  /** Keep the walk to `side`, the cells beside a building, past the chaser's own node; asked before the
   *  first {@link within}. */
  along(side: readonly NodeId[]): void {
    this.side = side;
    this.flooding = false;
  }

  /** Whether the chaser walks to `node` within `steps` walking steps. */
  within(node: NodeId, steps: number): boolean {
    const { terrain, origin, overlay } = this;
    // No walk is shorter than the map distance.
    const far = hexDistanceBetween(
      terrain.xOf(origin),
      terrain.yOf(origin),
      terrain.xOf(node),
      terrain.yOf(node),
    );
    if (far > steps || overlay === undefined) return false;
    const flood = this.started(overlay);
    // A breadth-first level holds the nodes first reached at that many steps.
    while (this.open && flood.depth < steps && !flood.reached(node)) this.deepen(flood);
    return flood.reached(node) && flood.stepsTo(node) <= steps;
  }

  /** Whether the chaser walks within `steps` walking steps to a node `accept` admits. */
  reachesWithin(steps: number, accept: (node: NodeId) => boolean): boolean {
    if (this.overlay === undefined) return false;
    const flood = this.started(this.overlay);
    while (this.open && flood.depth < steps) this.deepen(flood);
    for (let i = 0; i < flood.order.length; i++) {
      const node = flood.order.at(i);
      if (flood.stepsTo(node) <= steps && accept(node)) return true;
    }
    return false;
  }

  /** The flood, begun on the first ask since {@link begin}. */
  private started(overlay: BlockOverlay): StepFlood {
    const { flood } = this.scratch;
    if (!this.flooding) {
      this.flooding = true;
      this.open = true;
      flood.begin(this.origin, this.side === undefined ? overlay : this.keptTo(this.side, overlay));
    }
    return flood;
  }

  private deepen(flood: StepFlood): void {
    this.open = flood.order.length < WALK_LOCAL_NODES && flood.nextLevel();
  }

  /** {@link kept} over `overlay`, its marks stamped for `side` unless they already are. */
  private keptTo(side: readonly NodeId[], overlay: BlockOverlay): BlockOverlay {
    const scratch = this.scratch;
    if (scratch.stamped !== side) {
      if (scratch.sideStamp === MAX_STAMP) {
        scratch.sideMarks.fill(0);
        scratch.sideStamp = 0;
      }
      scratch.sideStamp += 1;
      for (const cell of side) scratch.sideMarks[cell] = scratch.sideStamp;
      scratch.stamped = side;
    }
    this.kept.base = overlay;
    return this.kept;
  }
}
