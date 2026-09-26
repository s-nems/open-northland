import type { TraderView } from '@open-northland/sim';
import { formatMessage, messages } from '../../../i18n/index.js';
import { goodLabel, type UnitPanelModelContext } from './context.js';

/** "Handcart: 3 wood" for the cart the trader commands, or the line saying it has none. */
function cartLine(ctx: UnitPanelModelContext, view: TraderView): string {
  const hud = messages().hud;
  if (view.cart === null) return hud.tradeNoCart;
  const cargo =
    view.cargo.length === 0
      ? hud.tradeCartEmpty
      : view.cargo.map((line) => `${line.amount} ${goodLabel(ctx, line.good)}`).join(', ');
  const vehicle = ctx.vehicleLabel?.(view.cart.vehicleType) ?? hud.tradeCart;
  return formatMessage(hud.tradeCartLoad, { vehicle, cargo });
}

/** The vehicle window's Handel status lines: the cart and its load, then what the route still lacks
 *  or how far the running exchange has come. */
export function tradeStatusLines(ctx: UnitPanelModelContext, view: TraderView): string[] {
  const hud = messages().hud;
  const status: string[] = [cartLine(ctx, view)];
  const foreign = view.stops.find((stop) => stop.foreign);
  if (view.stops.length < 2) status.push(hud.tradeNoRoute);
  else if (foreign === undefined) {
    if (view.stops.every((stop) => stop.imports.length === 0)) status.push(hud.tradeNoImports);
  } else {
    const chosen = foreign.offers.find((offer) => offer.index === view.agreement);
    if (chosen === undefined) status.push(hud.tradeNoAgreement);
    else if (!view.agreementHolds) status.push(hud.tradeNotFriends);
    else {
      status.push(
        formatMessage(hud.tradeExchange, {
          given: view.given,
          giveAmount: chosen.giveAmount,
          received: view.received,
          takeAmount: chosen.takeAmount,
        }),
      );
    }
  }
  return status;
}
