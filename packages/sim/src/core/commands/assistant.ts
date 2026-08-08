import type { AssistantCounterKind } from '../../components/assistant.js';

/** Commands that configure the per-player settlement assistant. */
export type AssistantCommand = AssistantGrantCommand | AssistantCounterCommand;

type AssistantGrantCommand = {
  /**
   * Grant or revoke one wearable good type in `player`'s assistant hand-out list, held on the
   * per-player `AssistantGrants` carrier. While granted, the auto-equip pass sends settlers with a
   * matching free slot to fetch the good from a reachable store or pile.
   */
  readonly kind: 'setAssistantGrant';
  /** The player slot (`[0, MAX_PLAYERS)`); an out-of-range slot skips the command. */
  readonly player: number;
  /** The content good type id; a good with no `equip` class is skipped (only wearables are grantable). */
  readonly goodType: number;
  readonly enabled: boolean;
};

/**
 * Set one assistant production counter to an absolute state, absolute rather than a delta so a replayed
 * or re-sent command cannot drift the value. The handler clamps `value` into
 * `[ASSISTANT_COUNTER_MIN, ASSISTANT_COUNTER_MAX]` and drops `infinite` on a kind outside
 * `INFINITE_COUNTER_KINDS`.
 */
type AssistantCounterCommand = {
  readonly kind: 'setAssistantCounter';
  /** The player slot (`[0, MAX_PLAYERS)`); an out-of-range slot skips the command. */
  readonly player: number;
  readonly counter: AssistantCounterKind;
  readonly value: number;
  readonly infinite: boolean;
};
