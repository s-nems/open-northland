import type { LandscapeType } from '@open-northland/data';
import { type Fixed, ONE } from '../../core/fixed.js';

/** Resolved, sim-ready properties of one landscape type (derived once from the IR at build time). */
export interface NodeTypeProps {
  readonly walkable: boolean;
  /** Whether a building's reserved zone may cover a node of this type. Distinct from `walkable`: a
   *  real map's margin band around a tree/rock is walkable ground you may not BUILD on, while water
   *  is neither. The build-placement rule reads this; navigation never does. */
  readonly buildable: boolean;
  /** Whether crops may be SOWN on a node of this type (the farmer drive's field gate). Distinct from
   *  both flags above: desert sand is walkable AND buildable but grows nothing — the original's
   *  `biocanplanton` ground flag (`trianglepatterntypes.cif`, only `land` carries it). */
  readonly plantable: boolean;
  /** Cost to step ONTO a node of this type, in fixed-point. Walkable nodes cost one unit. */
  readonly walkCost: Fixed;
  /** Per-node capacity — how many units may cluster on a node of this type (0 = unset/blocking). */
  readonly maxValency: number;
}

/** Default props for a landscape typeId not present in the content table (treated as blocking). */
export const UNKNOWN_NODE_TYPE: NodeTypeProps = {
  walkable: false,
  buildable: false,
  plantable: false,
  walkCost: ONE,
  maxValency: 0,
};

export function resolveTypeProps(t: LandscapeType): NodeTypeProps {
  return {
    walkable: t.walkable,
    buildable: t.buildable,
    plantable: t.plantable,
    // Walk cost is a uniform unit per walkable step — faithful for THIS table:
    // `landscapetypes.ini` carries NO per-type movement weight (its only per-type numbers are
    // `maximumValency` = a per-cell capacity cap, and the `allowedon{land,water,everything}`
    // PLACEMENT-layer flags — neither is a traversal cost). The original DOES weight movement by
    // GROUND class, though: `trianglepatterntypes.cif` carries per-logicType `moveresistance`
    // (land 2, sand 3, mountain 4, snow 5 — now emitted as the IR's `trianglePatternTypes`); a
    // ground-class walk-cost is a future step, not this landscape-object table's field. Stays Fixed
    // so the pathfinder never converts; blocking nodes keep this cost but are never traversed.
    walkCost: ONE,
    maxValency: t.maxValency,
  };
}
