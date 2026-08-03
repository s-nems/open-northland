import { WOOD_CHOPS_TO_FELL, WOOD_YIELD_PER_NODE } from './felling.js';
import {
  CLAY_DEPOSIT_UNITS,
  GOLD_DEPOSIT_UNITS,
  IRON_DEPOSIT_UNITS,
  MINE_LEVELS,
  STONE_DEPOSIT_UNITS,
} from './mining.js';

/**
 * The gathering balance for one gathered good: the `gathering`-block fields deciding how it leaves the
 * landscape, sourced from `felling.ts` and `mining.ts`. A good's atomic ids are not here.
 *
 * `bioLandscape` is the exception: real content extracts it, so this value serves the sandbox builder
 * only and the real-content overlay preserves the extracted one.
 */
export interface GatheringBalance {
  readonly bioLandscape: boolean;
  readonly chopsToFell?: number;
  readonly yieldPerNode?: number;
  readonly depositSize?: number;
  readonly depositLevels?: number;
}

/**
 * Felling and mining balance per gathered good, keyed by its stable string id: the one source both
 * content bases read, so neither can balance the same good differently. Extraction emits 0 for these
 * fields, so this table is the only lever.
 */
export const GATHERING_BALANCE_BY_ID: Readonly<Record<string, GatheringBalance>> = {
  wood: { bioLandscape: true, chopsToFell: WOOD_CHOPS_TO_FELL, yieldPerNode: WOOD_YIELD_PER_NODE },
  stone: { bioLandscape: false, depositSize: STONE_DEPOSIT_UNITS, depositLevels: MINE_LEVELS },
  mud: { bioLandscape: false, depositSize: CLAY_DEPOSIT_UNITS, depositLevels: MINE_LEVELS },
  iron: { bioLandscape: false, depositSize: IRON_DEPOSIT_UNITS, depositLevels: MINE_LEVELS },
  gold: { bioLandscape: false, depositSize: GOLD_DEPOSIT_UNITS, depositLevels: MINE_LEVELS },
  mushroom: { bioLandscape: true },
};
