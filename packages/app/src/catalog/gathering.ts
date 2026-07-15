import { WOOD_CHOPS_TO_FELL, WOOD_YIELD_PER_NODE } from './felling.js';
import {
  CLAY_DEPOSIT_UNITS,
  GOLD_DEPOSIT_UNITS,
  IRON_DEPOSIT_UNITS,
  MINE_LEVELS,
  STONE_DEPOSIT_UNITS,
} from './mining.js';

/**
 * The clean-room gathering balance for one gathered good — the `gathering`-block fields that decide how the
 * good leaves the landscape: a tree's chops-to-fell + wood yield, a mineral deposit's unit count + shrink
 * levels, plus whether it sits on a bio landscape. The harvest/pickup/store atomic ids are NOT here (they
 * are the good's own atomics); this is only the felling/mining balance, sourced from `felling.ts`/`mining.ts`.
 */
export interface GatheringBalance {
  readonly bioLandscape: boolean;
  readonly chopsToFell?: number;
  readonly yieldPerNode?: number;
  readonly depositSize?: number;
  readonly depositLevels?: number;
}

/**
 * Clean-room felling/mining balance per gathered good, keyed by its stable string id. The ONE source both
 * the sandbox goods builder (`game/sandbox/content/catalog/goods.ts` `buildSandboxGoods`) and the
 * real-content overlay (`content/real-content.ts` `mergeRealContent`) read, so the two content bases can
 * never balance the same good differently. The original's `extractGoodGathering` emits 0 for these fields
 * (`felling.ts` — "the live game does not yet fell"); this table is the scene-and-real-content lever.
 */
export const GATHERING_BALANCE_BY_ID: Readonly<Record<string, GatheringBalance>> = {
  wood: { bioLandscape: true, chopsToFell: WOOD_CHOPS_TO_FELL, yieldPerNode: WOOD_YIELD_PER_NODE },
  stone: { bioLandscape: false, depositSize: STONE_DEPOSIT_UNITS, depositLevels: MINE_LEVELS },
  mud: { bioLandscape: false, depositSize: CLAY_DEPOSIT_UNITS, depositLevels: MINE_LEVELS },
  iron: { bioLandscape: false, depositSize: IRON_DEPOSIT_UNITS, depositLevels: MINE_LEVELS },
  gold: { bioLandscape: false, depositSize: GOLD_DEPOSIT_UNITS, depositLevels: MINE_LEVELS },
  mushroom: { bioLandscape: true },
};
