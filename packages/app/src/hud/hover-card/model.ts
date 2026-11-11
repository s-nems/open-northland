import type { DiplomacyState } from '@open-northland/sim';
import type { PanelBar } from '../details-panel/model/bars.js';

/**
 * What the cursor card says about the thing under it. A settler, a building, a vehicle and another seat's
 * wall share one card: a title, one line under it, and the good rows only a store or a hold fills. A
 * building, a wall and a vehicle show their health; another seat's thing also names its owner and keeps
 * its goods to itself.
 */

/** The seat another seat's building or person belongs to. */
export interface HoverOwner {
  readonly player: number;
  /** Authored roster name; absent renders the numbered fallback. */
  readonly name?: string;
  /** The viewer's stance toward the owner, when the game has one to tell. */
  readonly stance: DiplomacyState | null;
  /** The team swatch as a CSS colour. */
  readonly colour: string;
}

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
  /** Null for the viewer's own building, whose card lists its store instead. */
  readonly owner: HoverOwner | null;
  readonly health: PanelBar | null;
  readonly rows: readonly HoverCardRow[];
}

export interface SettlerHoverModel {
  readonly kind: 'settler';
  readonly entityId: number;
  /** The same personal name as the details panel. */
  readonly title: string;
  /** The trade it works, beside its name on the card's one line. */
  readonly profession: string;
  /** What the viewer's own worker is set to make, after its trade: the products' names, or "everything".
   *  Null for a person without products to set, one with all of them stopped and another seat's person. */
  readonly products: string | null;
  /** Another seat's person, on a second line under the name; null for the viewer's own. */
  readonly owner: HoverOwner | null;
  /** The viewer's own person's experience and its nearest profession unlock. */
  readonly facts: readonly HoverCardFact[];
}

/** A named line of words, such as who commands a vehicle, drawn like a good row. */
export interface HoverCardFact {
  readonly label: string;
  readonly value: string;
}

export interface VehicleHoverModel {
  readonly kind: 'vehicle';
  readonly entityId: number;
  readonly title: string;
  /** What the vehicle is doing, the vehicle window's status strip; `trouble` while it cannot move. */
  readonly status: { readonly label: string; readonly trouble: boolean };
  readonly owner: HoverOwner | null;
  readonly health: PanelBar | null;
  /** The commander, a ship's seat count and deck, and an own trader's route. */
  readonly facts: readonly HoverCardFact[];
  /** What an own hold carries; empty for another seat's vehicle. */
  readonly rows: readonly HoverCardRow[];
}

export type HoverCardModel = BuildingHoverModel | SettlerHoverModel | VehicleHoverModel;
