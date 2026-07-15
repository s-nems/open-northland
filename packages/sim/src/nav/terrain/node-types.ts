import type { LandscapeType } from '@open-northland/data';
import { type Fixed, ONE } from '../../core/fixed.js';

/** Resolved, sim-ready properties of one landscape type (derived once from the IR at build time). */
export interface NodeTypeProps {
  readonly walkable: boolean;
  /** Whether a building's reserved zone may cover a node of this type. Distinct from `walkable`: a
   *  real map's margin band around a tree/rock is walkable ground you may not build on, while water
   *  is neither. Read by build placement, never by navigation. */
  readonly buildable: boolean;
  /** Whether crops may be sown on a node of this type (the farmer drive's field gate) — the original's
   *  `biocanplanton` ground flag (`trianglepatterntypes.cif`, only `land` carries it). Distinct from
   *  the flags above: desert sand is walkable and buildable but grows nothing. */
  readonly plantable: boolean;
  /** Cost to step onto a node of this type, in fixed-point. Walkable nodes cost one unit. */
  readonly walkCost: Fixed;
}

/** Default props for a landscape typeId not present in the content table (treated as blocking). */
export const UNKNOWN_NODE_TYPE: NodeTypeProps = {
  walkable: false,
  buildable: false,
  plantable: false,
  walkCost: ONE,
};

export function resolveTypeProps(t: LandscapeType): NodeTypeProps {
  return {
    walkable: t.walkable,
    buildable: t.buildable,
    plantable: t.plantable,
    // Uniform unit cost per walkable step — faithful for this table: `landscapetypes.ini` carries no
    // per-type movement weight (its per-type numbers are `maximumValency` and the
    // `allowedon{land,water,everything}` placement flags, neither a traversal cost). The original
    // weights movement by ground class instead (`trianglepatterntypes.cif` `moveresistance`: land 2,
    // sand 3, mountain 4, snow 5, emitted as the IR's `trianglePatternTypes`) — a ground-class
    // walk-cost is a future step. Stays Fixed so the pathfinder never converts.
    walkCost: ONE,
  };
}
