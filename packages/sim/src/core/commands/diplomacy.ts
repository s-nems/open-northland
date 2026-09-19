import type { DiplomacyState } from '../../components/rules.js';

/**
 * Set the stance the seat holds toward `other` (the original's human command 0x7f, which its diplomacy
 * window's three stance buttons send). Only the issuing seat's own direction changes; a pair a map or
 * script locked is refused.
 */
export type DiplomacyCommand = {
  readonly kind: 'declareDiplomacy';
  /** The declaring seat (`[0, MAX_PLAYERS)`), which the authority gate holds to the issuing seat. */
  readonly player: number;
  readonly other: number;
  readonly state: DiplomacyState;
};
