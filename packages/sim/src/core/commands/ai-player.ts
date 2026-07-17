import type { AiModuleEnables } from '../../components/ai-player.js';

/** Commands that attach or detach the strategic AI player on a seat. */
export type AiPlayerCommand = {
  /**
   * Flag `player`'s seat as AI-driven (or hand it back): sets/updates the per-player
   * {@link import('../../components/ai-player.js').AiPlayer} carrier (`enabled: false` removes it), so the
   * flag hashes and replays like any component and the save/replay log stays complete. `modules` narrows
   * which AI concerns run for the seat (an omitted module defaults to enabled — the original's empty
   * `[AIData]` = full HAI); the AiPlayerSystem consults it each decision. An out-of-range `player` is
   * recoverable bad input — skipped, still logged.
   */
  readonly kind: 'setPlayerAi';
  /** The player slot (`[0, MAX_PLAYERS)`). */
  readonly player: number;
  readonly enabled: boolean;
  readonly modules?: Partial<AiModuleEnables>;
};
