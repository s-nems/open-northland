import type { DiplomacyState } from '@open-northland/sim';
import type { UiString } from '../../../content/gui-gfx.js';
import { messages } from '../../../i18n/index.js';

export interface DiplomacyGood {
  readonly goodType: number;
  readonly goodId?: string;
  readonly label: string;
  readonly amount: number;
}

export interface TributePanelRow {
  readonly slot: number;
  readonly text?: string;
  readonly demands: readonly (DiplomacyGood & { readonly onHand: number })[];
  readonly payable: boolean;
}

export interface DiplomacyOffer {
  readonly index: number;
  readonly give: DiplomacyGood;
  readonly take: DiplomacyGood;
}

export type DeclarationBlock = 'observer' | 'script' | 'details' | 'loading';

export interface DiplomacyPanelRow {
  readonly player: number;
  readonly name?: string;
  readonly tribe?: number;
  readonly colour: number;
  readonly towardYou: DiplomacyState;
  readonly yourStance: DiplomacyState;
  readonly canDeclare: boolean;
  readonly blocked?: DeclarationBlock;
  readonly tributes: readonly TributePanelRow[];
  readonly tradeOffers: readonly DiplomacyOffer[];
  readonly goodsTraded?: number;
}

/** Submit returns whether the current authority and host preflight accepted the request.
 *  The live rows, rather than this answer, confirm that the simulation applied it. */
export interface DiplomacySource {
  rows(): readonly DiplomacyPanelRow[];
  tick(): number;
  viewer(): number | null;
  declare(other: number, state: DiplomacyState): Promise<boolean>;
  pay(other: number, slot: number): Promise<boolean>;
}

/** The decoded `misclogic` rows naming each stance. */
const STANCE_STRING_ID: Readonly<Record<DiplomacyState, number>> = {
  friend: 200,
  neutral: 201,
  enemy: 202,
};

/** A stance in the player's language. */
export function diplomacyStanceText(uiString: UiString, state: DiplomacyState): string {
  return uiString('misclogic', STANCE_STRING_ID[state], messages().hud.diplomacyStances[state]);
}

/** The decoded `miscwindow` row 'Player'. */
const PLAYER_STRING_ID = 361;

/** An authored roster name, else the numbered fallback: many maps leave a slot unnamed. */
export function playerLabel(uiString: UiString, player: number, name: string | null | undefined): string {
  return name ?? `${uiString('miscwindow', PLAYER_STRING_ID, messages().hud.player)} ${player}`;
}

/** The selected tab resolved against the live row set: a selection whose player vanished (or was never
 *  made) falls back to the first row, and an empty set to null. */
export function resolveSelectedPlayer(
  rows: readonly DiplomacyPanelRow[],
  selected: number | null,
): number | null {
  if (selected !== null && rows.some((r) => r.player === selected)) return selected;
  return rows[0]?.player ?? null;
}
