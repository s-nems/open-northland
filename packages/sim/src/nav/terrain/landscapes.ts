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
  /** A felled node such as a tree when true. Mutually exclusive with `deposit`. */
  readonly felling?: boolean;
  /** A mined finite deposit: its level ladder. `initial` is the deposit's full size, the ladder
   *  denominator, for a node placed already part-mined; omitted it is `remaining`. */
  readonly deposit?: {
    readonly levels: number;
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
  /** A good's ground form (`goodtypes.ini` `landscapetype`): a placement is a loose heap of the good
   *  holding its level in units, drawn from the goods sheet rather than the static landscape layer. The
   *  slug resolves against the world's content when the heap is laid. */
  readonly good?: { readonly goodId: string };
  /** A player-buildable wooden wall record. `maxHitpoints` is the readable logic type's maximum valency;
   * `repairPerStrike` is its positive repair transition delta. Both stay in data rather than id branches. */
  readonly wall?: {
    readonly maxHitpoints: number;
    readonly repairPerStrike: number;
    readonly construction: readonly { readonly goodType: number; readonly amount: number }[];
    readonly gate?: { readonly open: boolean; readonly counterpartGfxIndex: number };
  };
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
