import type { AssistantCounterKind } from '../../components/assistant.js';

/** Commands that configure the per-player settlement assistant. */
export type AssistantCommand = AssistantGrantCommand | AssistantCounterCommand;

type AssistantGrantCommand = {
  /**
   * Grant or revoke one wearable good type in `player`'s assistant hand-out list, held on the
   * per-player `AssistantGrants` carrier so it hashes and replays like any component. While granted,
   * the auto-equip pass sends settlers with a matching free slot to fetch the good from a reachable
   * store or pile. An out-of-range `player` or a good with no content `equip` class is skipped.
   */
  readonly kind: 'setAssistantGrant';
  /** The player slot (`[0, MAX_PLAYERS)`). */
  readonly player: number;
  /** The content good type id; must carry an `equip` class (only wearables are grantable). */
  readonly goodType: number;
  readonly enabled: boolean;
};

/**
 * Set one assistant production counter to an absolute state, absolute rather than a delta so a replayed
 * or re-sent command cannot drift the value. The handler clamps `value` into
 * `[ASSISTANT_COUNTER_MIN, ASSISTANT_COUNTER_MAX]` and drops `infinite` on a kind outside
 * `INFINITE_COUNTER_KINDS`. An out-of-range `player` is skipped.
 */
type AssistantCounterCommand = {
  readonly kind: 'setAssistantCounter';
  /** The player slot (`[0, MAX_PLAYERS)`). */
  readonly player: number;
  readonly counter: AssistantCounterKind;
  readonly value: number;
  readonly infinite: boolean;
};
