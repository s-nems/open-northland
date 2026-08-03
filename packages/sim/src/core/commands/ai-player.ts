import type { AiModuleEnables } from '../../components/ai-player.js';

/** Commands that attach or detach the strategic AI player on a seat. */
export type AiPlayerCommand = {
  /**
   * Flag `player`'s seat as AI-driven, or hand it back: sets the per-player `AiPlayer` carrier, which
   * `enabled: false` removes, so the flag hashes and replays like any component. `modules` narrows
   * which AI concerns run for the seat; an omitted module defaults to enabled, matching the original's
   * empty `[AIData]`. An out-of-range `player` is skipped.
   */
  readonly kind: 'setPlayerAi';
  /** The player slot (`[0, MAX_PLAYERS)`). */
  readonly player: number;
  readonly enabled: boolean;
  readonly modules?: Partial<AiModuleEnables>;
};
