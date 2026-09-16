import type { FootprintCell } from '@open-northland/data';

export type LandscapeRemovalGroup = 'blocker' | 'fx1' | 'fx2' | 'smoke' | 'wave';

/** The resource a landscape type stands for, resolved by the caller: the felling and deposit balance
 *  constants live in the app catalog. A placed node adds its position and landscape id. */
export interface ResourceSpec {
  readonly good: number;
  readonly remaining: number;
  readonly harvestAtomic: number;
  /** Opaque render-variant tag: the app's decoded-map species record index, stored verbatim. The sim never
   *  interprets it - footprint and collision come from the good's own record in the sim's content set,
   *  whose numbering is unrelated. Omitted for an admin or scene spawn. */
  readonly gfxIndex?: number;
  /** A felled node such as a tree: its chops-to-fell counter. Mutually exclusive with `deposit`. */
  readonly felling?: { readonly chopsLeft: number };
  /** A mined finite deposit: its level ladder and how many work cycles chip one unit off (an observed
   *  calibration in the app catalog). `initial` is the deposit's full size, the ladder denominator, for
   *  a node placed already part-mined; omitted it is `remaining`. */
  readonly deposit?: {
    readonly levels: number;
    readonly strikesPerUnit: number;
    readonly initial?: number;
  };
}

export interface ScriptLandscapeType {
  readonly typeId: number;
  readonly walk: readonly FootprintCell[];
  readonly build: readonly FootprintCell[];
  readonly groups: readonly LandscapeRemovalGroup[];
  readonly resource?: ResourceSpec;
  readonly bushGfxIndex?: number;
  /** A placed record backed by the interactive chest entity rather than the static landscape layer. */
  readonly chest?: { readonly kind: 'wooden' | 'magical'; readonly gfxIndex: number };
}

export interface ScriptLandscapePlacement {
  readonly id: number;
  readonly typeId: number;
  readonly hx: number;
  readonly hy: number;
  readonly level: number;
  /** The associated live resource/bush owns this placement's lifetime and collision. */
  readonly resourceBacked?: boolean;
}

export interface LandscapeMapInput {
  readonly types: readonly ScriptLandscapeType[];
  readonly placements: readonly ScriptLandscapePlacement[];
}
