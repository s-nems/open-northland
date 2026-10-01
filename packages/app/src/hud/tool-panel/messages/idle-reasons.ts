import type { WorkStatus } from '@open-northland/sim';
import type { IdleReason } from './types.js';

/**
 * The reason an idle worker's note names, read off the sim's diagnosis of the worker, as the settler
 * panel words it; null when the diagnosis names none the note can put in words: no answer yet, nothing
 * in the way, a search too large to finish or a workplace it does not diagnose.
 */
export function idleReasonOf(status: WorkStatus | undefined): IdleReason | null {
  switch (status?.kind) {
    case 'waitingInput': {
      const stranded = status.missingInputs.find((input) => input.outOfReach);
      if (stranded !== undefined) return { kind: 'inputOutOfReach', goodType: stranded.goodType };
      return { kind: 'missingInput', goodType: status.missingInputs[0]?.goodType ?? null };
    }
    case 'outputFull':
      return { kind: 'outputFull', goodType: status.outputs[0]?.goodType ?? null };
    case 'noOutputDestination':
      if (status.reason === 'unknown') return null;
      return {
        kind: status.reason === 'outOfReach' ? 'outputOutOfReach' : 'noStorage',
        goodType: status.goodType,
      };
    case 'productsLocked':
      return { kind: 'productsLocked', goodType: status.goodTypes[0] ?? null };
    case 'noEligibleResource':
      return {
        kind: status.scope === 'workArea' ? 'noResourceInArea' : 'noResource',
        goodType: status.goodTypes[0] ?? null,
      };
    case 'resourceRouteBlocked':
      return { kind: 'resourceRouteBlocked', goodType: status.goodTypes[0] ?? null };
    case 'nothingSelected':
    case 'noWorkplace':
    case 'noTool':
    case 'noJob':
      return { kind: status.kind, goodType: null };
    case 'crafting':
    case 'workplaceUnderConstruction':
    case 'unknown':
    case undefined:
      return null;
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}
