/** Commands that configure the per-player settlement assistant. */
export type AssistantCommand = {
  /**
   * Grant (or revoke) one wearable good type in `player`'s assistant hand-out list - the per-player
   * {@link import('../../components/assistant.js').AssistantGrants} carrier, so the list hashes and
   * replays like any component. While granted, the auto-equip pass sends settlers with a matching
   * free slot to fetch the good from a reachable store or pile
   * (`systems/agents/assistant-grants.ts`). An out-of-range `player` or a good with no content
   * `equip` class is recoverable bad input - skipped, still logged.
   */
  readonly kind: 'setAssistantGrant';
  /** The player slot (`[0, MAX_PLAYERS)`). */
  readonly player: number;
  /** The content good type id; must carry an `equip` class (only wearables are grantable). */
  readonly goodType: number;
  readonly enabled: boolean;
};
