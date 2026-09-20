// Worn-equipment effects and wear - a leaf module (imports only components/core/stores) so movement,
// production, and the settler drives can all read worn bonuses and spend items without an import cycle.

export {
  draughtRestores,
  isCraftingOperator,
  toolProductionBonus,
  tryDeathSaveDraught,
} from './effects.js';
export { applyEquipWear, wearStepOf, wearWornBoots, wearWornTool } from './wear.js';
