/**
 * What the cursor card says about the thing under it. A settler and a building share one card: a title,
 * one line under it, and the good rows only a store fills.
 */

/** One good line: a unit the building holds, or a material line of a site's bill. */
export interface HoverCardRow {
  /** The good's string id, the HUD's icon key; absent for a good outside the catalog. */
  readonly goodId?: string;
  readonly label: string;
  readonly amount: number;
  /** Site bill only: the units the line needs in all, so the row reads "3 / 8". */
  readonly needed?: number;
}

/** A building that is not standing finished: it is being raised from nothing, or raised a tier. */
export type BuildingHoverState = 'construction' | 'upgrade';

export interface BuildingHoverModel {
  readonly kind: 'building';
  readonly entityId: number;
  readonly title: string;
  /** Null for a finished building; otherwise the state and how far it has come. */
  readonly state: { readonly kind: BuildingHoverState; readonly pct: number } | null;
  readonly rows: readonly HoverCardRow[];
}

export interface SettlerHoverModel {
  readonly kind: 'settler';
  readonly entityId: number;
  /** The given name alone; the surname is the details panel's, which has the room for it. */
  readonly title: string;
  /** The trade it works, beside its name on the card's one line. */
  readonly profession: string;
}

export type HoverCardModel = BuildingHoverModel | SettlerHoverModel;
