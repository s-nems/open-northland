import { formatMessage, messages } from '../../../i18n/index.js';
import { goodLabel, type SettlerWorkStatus, type UnitPanelModelContext } from './context.js';

/** Shared wording for the selected worker and the workplace's status strip. */
export function workStatusDetail(ctx: UnitPanelModelContext, status: SettlerWorkStatus): string | null {
  const copy = messages().hud.settlerPanel.idleReasons;
  switch (status.kind) {
    case 'waitingInput':
      return formatMessage(copy.waitingInput, {
        product: goodLabel(ctx, status.goodType),
        inputs: status.missingInputs
          .map((input) =>
            formatMessage(copy.inputAmount, {
              good: goodLabel(ctx, input.goodType),
              missing: input.missing,
              available: input.available,
              required: input.required,
            }),
          )
          .join(', '),
      });
    case 'outputFull':
      return formatMessage(copy.outputFull, {
        outputs: status.outputs
          .map((output) =>
            formatMessage(copy.outputAmount, {
              good: goodLabel(ctx, output.goodType),
              available: output.available,
              capacity: output.capacity,
              required: output.required,
            }),
          )
          .join(', '),
      });
    case 'productsLocked':
      return formatMessage(copy.productsLocked, {
        goods: status.goodTypes.map((good) => goodLabel(ctx, good)).join(', '),
      });
    case 'noEligibleResource':
      return formatMessage(status.scope === 'workArea' ? copy.noResourceInArea : copy.noEligibleResource, {
        goods: status.goodTypes.map((good) => goodLabel(ctx, good)).join(', '),
      });
    case 'resourceRouteBlocked':
      return formatMessage(copy.resourceRouteBlocked, {
        goods: status.goodTypes.map((good) => goodLabel(ctx, good)).join(', '),
      });
    case 'noOutputDestination':
      return formatMessage(copy.outputDestination[status.reason], { good: goodLabel(ctx, status.goodType) });
    case 'unknown':
      return copy.unknown;
    case 'nothingSelected':
    case 'noTool':
    case 'noJob':
    case 'noWorkplace':
      return copy[status.kind];
    case 'crafting':
    case 'workplaceUnderConstruction':
      return null;
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}
