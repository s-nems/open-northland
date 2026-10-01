import { type Fixed, ZERO } from '../../../../core/fixed.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { StandingPostGrid } from '../standing-posts.js';
import { SlotGrid } from './slot-grid.js';

/**
 * This tick's colliders by slot, slots ascending by entity id. Columns are overwritten in place and read
 * up to `count` only: an emptied array drops its storage, and regrowing it cost more than the pass.
 */
export interface ColliderColumns {
  count: number;
  readonly entity: Entity[];
  /** Pre-separation Position and its world-axis form (`worldX`, `worldYOf`). */
  readonly x: Fixed[];
  readonly y: Fixed[];
  readonly worldX: Fixed[];
  readonly worldY: Fixed[];
  /** Half-cell node of the pre-separation Position. */
  readonly hx: number[];
  readonly hy: number[];
  readonly grid: SlotGrid;
}

/**
 * Each mover's pre-separation state, so a pair's two halves read the same values whatever the processing
 * order. The leg target is captured at census time: the grind bookkeeping drops an earlier-processed
 * mover's PathFollow mid-loop. The unit heading toward it is derived on first ask, since only a mover in an
 * overlapping pair reads one.
 */
export interface MoverColumns extends ColliderColumns {
  /** A firm collider: an owned fighter. */
  readonly firm: boolean[];
  readonly hasTarget: boolean[];
  readonly targetX: Fixed[];
  readonly targetY: Fixed[];
  readonly headingX: Fixed[];
  readonly headingY: Fixed[];
  /** The census whose heading the slot holds; any other value means not derived yet. */
  readonly headingCensus: number[];
}

/** A point the resolve rewrites in place for each mover. */
export interface ScratchPoint {
  x: Fixed;
  y: Fixed;
}

/** Collections the separation pass refills every tick without reallocating them. */
export interface SeparationScratch {
  /** The census's walker ids, sorted in place before they become mover slots. */
  order: Int32Array;
  readonly movers: MoverColumns;
  /** The posts firm movers resolve against, read only when this census holds a firm mover. */
  posts: StandingPostGrid | undefined;
  census: number;
  /** Per-mover neighbour mover slots and post ids, valid up to the counts the resolve keeps beside them. */
  readonly nearMovers: number[];
  readonly nearPosts: Entity[];
  readonly push: ScratchPoint;
  readonly candidate: ScratchPoint;
  /** Argument holders for the heading derivation, so it allocates no point. */
  readonly headingFrom: ScratchPoint;
  readonly headingTo: ScratchPoint;
  readonly heading: { hx: Fixed; hy: Fixed };
}

function colliderColumns(): ColliderColumns {
  return { count: 0, entity: [], x: [], y: [], worldX: [], worldY: [], hx: [], hy: [], grid: new SlotGrid() };
}

const scratchByWorld = new WeakMap<World, SeparationScratch>();

export function separationScratch(world: World): SeparationScratch {
  let scratch = scratchByWorld.get(world);
  if (scratch === undefined) {
    scratch = {
      order: new Int32Array(0),
      movers: {
        ...colliderColumns(),
        firm: [],
        hasTarget: [],
        targetX: [],
        targetY: [],
        headingX: [],
        headingY: [],
        headingCensus: [],
      },
      posts: undefined,
      census: 0,
      nearMovers: [],
      nearPosts: [],
      push: { x: ZERO, y: ZERO },
      candidate: { x: ZERO, y: ZERO },
      headingFrom: { x: ZERO, y: ZERO },
      headingTo: { x: ZERO, y: ZERO },
      heading: { hx: ZERO, hy: ZERO },
    };
    scratchByWorld.set(world, scratch);
  }
  return scratch;
}
