import type { AiDecisionSource } from '../../core/commands/envelope.js';
import { defineComponent } from '../../ecs/world.js';

/** Provenance of an AI-issued movement/attack order. Replaced when another controller takes over. */
export interface AiOrderOrigin {
  readonly player: number;
  readonly source: AiDecisionSource;
}
export const AiOrder = defineComponent<AiOrderOrigin>('AiOrder', 'players', { simOnly: true });
