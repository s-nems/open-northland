import type { AiModuleEnables } from '../../components/ai-player.js';

/** Commands that attach or detach the strategic AI player on a seat. */
export type AiPlayerCommand = {
  /**
   * Flag `player`'s seat as AI-driven, or hand it back through the per-player `AiPlayer` carrier.
   * `modules` narrows which AI concerns run for the seat; an omitted module defaults to enabled.
   */
  readonly kind: 'setPlayerAi';
  /** The player slot (`[0, MAX_PLAYERS)`); an out-of-range slot skips the command. */
  readonly player: number;
  readonly enabled: boolean;
  readonly modules?: Partial<AiModuleEnables>;
};
