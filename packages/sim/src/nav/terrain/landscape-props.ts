import type { LandscapeType } from '@open-northland/data';
import { type Fixed, ONE } from '../../core/fixed.js';

/** Resolved, sim-ready properties of one landscape type, derived once from the IR at build time. */
export interface LandscapeProps {
  readonly walkable: boolean;
  /** Whether a building's reserved zone may cover a node of this type. Distinct from `walkable`: a real
   *  map's margin band around a tree or rock is walkable ground you may not build on. */
  readonly buildable: boolean;
  /** Whether crops may be sown on a node of this type, from the original's `biocanplanton` ground flag
   *  in `trianglepatterntypes.cif`, which only `land` carries. Desert sand is walkable and buildable but
   *  grows nothing. */
  readonly plantable: boolean;
  /** Cost to step onto a node of this type, in fixed-point. Walkable nodes cost one unit. */
  readonly walkCost: Fixed;
}

/** Default props for a landscape typeId absent from the content table, treated as blocking. */
export const UNKNOWN_LANDSCAPE_PROPS: LandscapeProps = {
  walkable: false,
  buildable: false,
  plantable: false,
  walkCost: ONE,
};

export function resolveLandscapeProps(t: LandscapeType): LandscapeProps {
  return {
    walkable: t.walkable,
    buildable: t.buildable,
    plantable: t.plantable,
    // Uniform unit cost per walkable step: `landscapetypes.ini` carries no per-type movement weight,
    // only `maximumValency` and the `allowedon{land,water,everything}` placement flags. The original
    // weights movement by ground class instead, through `trianglepatterntypes.cif` `moveresistance`.
    walkCost: ONE,
  };
}
