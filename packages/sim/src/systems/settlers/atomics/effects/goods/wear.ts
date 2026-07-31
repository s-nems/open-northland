import type { EquipmentSlot } from '../../../../../components/index.js';
import { fx } from '../../../../../core/fixed.js';

/**
 * Whether a worn unit has any use on it - the destroy-instead-of-stow trigger of the take-off rule
 * (see ./equip.ts's module note). A leaf on purpose: the trade-change path reads it without touching
 * the equip effect, which now depends on the trade change itself (the good→class transform).
 */
export function isUsed(slot: EquipmentSlot): boolean {
  return slot.degreeOfUse > fx.fromInt(0);
}
