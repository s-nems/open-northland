import type { DiplomacyState } from '@open-northland/sim';
import { messages } from '../../../i18n/index.js';
import { drawPlateOutline } from '../../chrome.js';
import type { Rect } from '../../geometry.js';
import type { ParagraphRun, TextRun } from '../../text-run.js';
import type { PanelContext } from '../context.js';
import {
  addRun,
  centreRun,
  paintPlate,
  paintRowCard,
  placeOnCard,
  ROW_INSET_X,
  ROW_PX,
  TEXT_CAP_H,
  type WindowLayers,
} from '../window-family/index.js';
import {
  type DiplomacyPanelRow,
  type DiplomacyWindowLayout,
  diplomacyStanceText,
  type TributeCardSpec,
  type TributePanelRow,
  tributeTextWidth,
} from './model.js';

/** Team-swatch square side (design px) on the identity card. */
const SWATCH = 9;
/** Gap (design px) between the swatch and the name beside it. */
const SWATCH_NAME_GAP = 5;

/** The decoded original strings the window prefers over the catalog fallbacks. */
const IN_STORES_STRING_ID = 355; // miscwindow 'in stores', the tribute demand's stock note
const THEIR_STANCE_STRING_ID = 358; // miscwindow 'Relationship to your tribe is'
const YOUR_STANCE_STRING_ID = 359; // miscwindow 'Your relation to the other tribe'
const PLAYER_STRING_ID = 361; // miscwindow 'Player'
/** miscwindow 'Become Friendly', 'Become Neutral', 'Become Hostile': the original's stance buttons. */
const DECLARE_STRING_ID: Readonly<Record<DiplomacyState, number>> = { friend: 352, neutral: 353, enemy: 354 };

/** A tribute's wrapped description, measured before the layout so its card can take its height. */
interface TributeCard {
  readonly tribute: TributePanelRow;
  readonly description: ParagraphRun;
  readonly spec: TributeCardSpec;
}

export const diplomacyPlayerLabel = (ctx: PanelContext, player: number, name: string | undefined): string =>
  name ?? `${ctx.uiString('miscwindow', PLAYER_STRING_ID, messages().hud.player)} ${player}`;

export function createDiplomacyBody(layers: WindowLayers) {
  const { ctx } = layers;
  const { scale } = ctx;
  const paragraphs: ParagraphRun[] = [];
  /** Place a run flush with the card's right edge, mirroring the left label inset. */
  const onCardRight = (run: TextRun, card: Rect): void => {
    const { width: rw, height: rh } = ctx.screen();
    const x = card.x + card.w - (ROW_INSET_X + run.width) * scale;
    const y = card.y + (card.h - TEXT_CAP_H * scale) / 2;
    run.place(Math.round(x), Math.round(y), scale, rw, rh);
  };

  const paintBody = (built: DiplomacyWindowLayout, row: DiplomacyPanelRow): void => {
    const [identity, theirLine, yourLine] = built.bodyLines;
    if (identity === undefined) return;
    const idCard = paintRowCard(layers, identity);
    const side = Math.round(SWATCH * scale);
    const swatch: Rect = {
      x: Math.round(idCard.x + ROW_INSET_X * scale),
      y: Math.round(idCard.y + (idCard.h - side) / 2),
      w: side,
      h: side,
    };
    layers.graphics.rect(swatch.x, swatch.y, swatch.w, swatch.h).fill(row.colour);
    drawPlateOutline(layers.graphics, swatch, scale);
    placeOnCard(
      layers,
      addRun(layers, diplomacyPlayerLabel(ctx, row.player, row.name), 'white', ROW_PX),
      idCard,
      ROW_INSET_X + SWATCH + SWATCH_NAME_GAP,
    );

    const stanceLine = (line: Rect | undefined, heading: string, state: DiplomacyState): void => {
      if (line === undefined) return;
      const card = paintRowCard(layers, line);
      placeOnCard(layers, addRun(layers, heading, 'dimmed', ROW_PX), card);
      onCardRight(
        addRun(layers, diplomacyStanceText(ctx.uiString, state), state === 'enemy' ? 'red' : 'white', ROW_PX),
        card,
      );
    };
    stanceLine(
      theirLine,
      ctx.uiString('miscwindow', THEIR_STANCE_STRING_ID, messages().hud.diplomacyTheirStance),
      row.towardYou,
    );
    stanceLine(
      yourLine,
      ctx.uiString('miscwindow', YOUR_STANCE_STRING_ID, messages().hud.diplomacyYourStance),
      row.yourStance,
    );
  };

  /** The stance buttons: the viewer's current stance lit, the other two live. */
  const paintStances = (built: DiplomacyWindowLayout): void => {
    for (const button of built.stances) {
      paintPlate(layers, button.rect, button.current);
      const label = ctx.uiString(
        'miscwindow',
        DECLARE_STRING_ID[button.state],
        messages().hud.diplomacyDeclare[button.state],
      );
      centreRun(layers, addRun(layers, label, 'white', ROW_PX), button.rect);
    }
  };

  /** Wrap each tribute's description ahead of the layout, so a long one grows its card. */
  const measureCards = (tributes: readonly TributePanelRow[]): TributeCard[] =>
    tributes.map((tribute) => {
      const text = tribute.text ?? `${messages().hud.tribute} ${tribute.slot}`;
      const description = ctx.makeParagraph(text, 'white', ROW_PX, tributeTextWidth(scale));
      layers.container.addChild(description.container);
      paragraphs.push(description);
      return {
        tribute,
        description,
        spec: {
          slot: tribute.slot,
          payable: tribute.payable,
          descriptionH: description.height,
          lines: tribute.demands.length,
        },
      };
    });

  /** One card per tribute: the description over one line per demand, each with what the stores
   *  hold, a note when the stores hold it all but no single one does, and the pay button lit only
   *  while the viewer could pay. */
  const paintTributes = (built: DiplomacyWindowLayout, cards: readonly TributeCard[]): void => {
    const inStores = ctx.uiString('miscwindow', IN_STORES_STRING_ID, messages().hud.tributeInStores);
    const { width: rw, height: rh } = ctx.screen();
    const onLine = (run: TextRun, at: { readonly x: number; readonly y: number }): void =>
      run.place(at.x, at.y, scale, rw, rh);
    built.tributes.forEach((rect, i) => {
      const card = cards[i];
      if (card === undefined) return;
      paintRowCard(layers, rect.card);
      card.description.place(rect.text.x, rect.text.y);
      const lines = card.tribute.demands.map((d) => `${d.amount} ${d.label} (${d.onHand} ${inStores})`);
      lines.forEach((line, l) => {
        const at = rect.lines[l];
        if (at !== undefined) onLine(addRun(layers, line, 'dimmed', ROW_PX), at);
      });
      paintPlate(layers, rect.pay, rect.payable);
      centreRun(
        layers,
        addRun(layers, messages().hud.tributePay, rect.payable ? 'white' : 'dimmed', ROW_PX),
        rect.pay,
      );
    });
  };

  return {
    measureCards,
    paint: (
      built: DiplomacyWindowLayout,
      row: DiplomacyPanelRow | undefined,
      cards: readonly TributeCard[],
    ) => {
      if (row !== undefined) {
        paintBody(built, row);
        paintStances(built);
        paintTributes(built, cards);
      } else {
        const line = built.bodyLines[0];
        if (line !== undefined) {
          const card = paintRowCard(layers, line);
          placeOnCard(layers, addRun(layers, messages().hud.diplomacyNoneMet, 'dimmed', ROW_PX), card);
        }
      }
    },
    clear: () => {
      for (const paragraph of paragraphs) paragraph.destroy();
      paragraphs.length = 0;
    },
  };
}
