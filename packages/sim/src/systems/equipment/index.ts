// Worn-equipment effects and wear - a leaf module (imports only components/core/stores) so movement,
// production, and the settler drives can all read worn bonuses and spend items without an import cycle.

export {
  draughtFor,
  spendSip,
  woundBearer,
} from './draughts.js';
export {
  BARE_HANDS_WORK_FACTOR_PCT,
  carriedStepTicksSaved,
  damageDealtBy,
  damageTakenBy,
  isCraftingOperator,
  toolProductionBonusPct,
  toolWorkFactorPct,
} from './effects.js';
export { applyEquipWear, wearStepOf, wearWornBoots, wearWornTool } from './wear.js';
