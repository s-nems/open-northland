import type { WorkStatus } from '@open-northland/sim';
import { type IdleReason, type IdleReasonKind, USER_MESSAGE_TYPE, type UserMessageType } from './types.js';

const NO_GOODS: readonly number[] = [];

/**
 * The reason an idle worker's note names, read off the sim's diagnosis of the worker, as the settler
 * panel words it; null when the diagnosis names none the note can put in words: nothing in the way, a
 * search too large to finish or a workplace it does not diagnose. A craft operator's gates (inputs,
 * shelves, locked products) never reach the note, since a resting workshop's operators leave it to the
 * stall note, nor do a missing workplace or trade, since the note needs a finished workplace, nor a store
 * carrier's empty round, which is no blocker, nor a workplace beyond signpost reach, which the lost note
 * names; the sim reports no missing tool.
 */
export function idleReasonOf(status: WorkStatus | undefined): IdleReason | null {
  switch (status?.kind) {
    case 'noOutputDestination':
      if (status.reason === 'unknown') return null;
      return {
        kind: status.reason === 'outOfReach' ? 'outputOutOfReach' : 'noStorage',
        goodTypes: [status.goodType],
      };
    case 'nothingSelected':
      return { kind: 'nothingSelected', goodTypes: NO_GOODS };
    case 'noEligibleResource':
      return {
        kind: status.scope === 'workArea' ? 'noResourceInArea' : 'noResource',
        goodTypes: status.goodTypes,
      };
    case 'resourceRouteBlocked':
      return { kind: 'resourceRouteBlocked', goodTypes: status.goodTypes };
    case 'nothingAtFlag':
    case 'noGame':
    case 'gameOutOfReach':
    case 'noConstructionSite':
    case 'noFish':
      return { kind: status.kind, goodTypes: NO_GOODS };
    case 'constructionShort':
      return { kind: 'constructionShort', goodTypes: status.goodTypes };
    case 'nothingToCarry':
    case 'waitingInput':
    case 'herdNotReady':
    case 'outputFull':
    case 'productsLocked':
    case 'noWorkplace':
    case 'noTool':
    case 'noJob':
    case 'crafting':
    case 'workplaceUnderConstruction':
    case 'workplaceOutOfReach':
    case 'unknown':
    case undefined:
      return null;
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}

/** The trades whose work ran out, as the dedicated note words the lead: game, fish or gathered goods. */
export type ShortageTrade = 'game' | 'fish' | 'goods';

const SHORTAGE_TRADE: Partial<Readonly<Record<IdleReasonKind, ShortageTrade>>> = {
  noResourceInArea: 'goods',
  noResource: 'goods',
  resourceRouteBlocked: 'goods',
  noGame: 'game',
  gameOutOfReach: 'game',
  noFish: 'fish',
};

/** The trade whose resource `reason` says ran out or lies out of reach, or null for any other reason. */
export function shortageTradeOf(reason: IdleReason | null): ShortageTrade | null {
  return reason === null ? null : (SHORTAGE_TRADE[reason.kind] ?? null);
}

/** The two notes an idle worker's reason picks between. */
export const IDLE_NOTE_TYPES: ReadonlySet<UserMessageType> = new Set([
  USER_MESSAGE_TYPE.nothingToDo,
  USER_MESSAGE_TYPE.cannotFindGood,
]);

/** The note an idle worker's `reason` raises: the original's "cannot find the good" note when its trade
 *  finds nothing to work, else the nothing-to-do note. */
export function idleNoteType(reason: IdleReason | null): UserMessageType {
  return shortageTradeOf(reason) === null ? USER_MESSAGE_TYPE.nothingToDo : USER_MESSAGE_TYPE.cannotFindGood;
}
