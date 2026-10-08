import type { AssistantCounterKind } from '../../components/assistant.js';

/** Commands that configure the per-player settlement assistant. */
export type AssistantCommand =
  | AssistantGrantCommand
  | AssistantGrantAudienceCommand
  | AssistantWeaponVetoCommand
  | AssistantCounterCommand
  | AssistantPostGraduatesCommand
  | AssistantMoveFlagsCommand;

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

type AssistantGrantAudienceCommand = {
  /**
   * Keep one wearable good of `player`'s assistant hand-out for fighters alone, or hand it to everyone
   * again, held on the per-player `AssistantSoldierOnlyGrants` carrier. Independent of the grant itself:
   * the limit waits for the good to be granted and survives its revocation.
   */
  readonly kind: 'setAssistantGrantAudience';
  /** The player slot (`[0, MAX_PLAYERS)`); an out-of-range slot skips the command. */
  readonly player: number;
  /** The content good type id; a good with no `equip` class is skipped. */
  readonly goodType: number;
  readonly soldiersOnly: boolean;
};

type AssistantWeaponVetoCommand = {
  /**
   * Veto or allow one weapon good in `player`'s recruit arming, held on the per-player
   * `AssistantWeaponVetoes` carrier. A vetoed good is never handed to a recruit; his class takes the next
   * allowed weapon or waits for one.
   */
  readonly kind: 'setAssistantWeaponVeto';
  /** The player slot (`[0, MAX_PLAYERS)`); an out-of-range slot skips the command. */
  readonly player: number;
  /** The content good type id; a good that arms no class is skipped. */
  readonly goodType: number;
  readonly vetoed: boolean;
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

type AssistantPostGraduatesCommand = {
  /**
   * Switch `player`'s "send graduates to work" on or off, held on the per-player `AssistantPostsGraduates`
   * carrier. While on, a settler finishing a school course is bound to a free workplace slot in its trade.
   */
  readonly kind: 'setAssistantPostGraduates';
  /** The player slot (`[0, MAX_PLAYERS)`); an out-of-range slot skips the command. */
  readonly player: number;
  readonly enabled: boolean;
};

type AssistantMoveFlagsCommand = {
  /**
   * Switch `player`'s "gatherers move their flags" on or off, held on the per-player `AssistantMovesFlags`
   * carrier. While on, a flag gatherer's flag is kept within 3-5 tiles of a resource he can work.
   */
  readonly kind: 'setAssistantMoveFlags';
  /** The player slot (`[0, MAX_PLAYERS)`); an out-of-range slot skips the command. */
  readonly player: number;
  readonly enabled: boolean;
};
