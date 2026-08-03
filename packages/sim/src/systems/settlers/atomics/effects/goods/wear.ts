import type { EquipmentSlot } from '../../../../../components/index.js';
import { fx } from '../../../../../core/fixed.js';

/** Whether a worn unit has any use on it: the destroy-instead-of-stow trigger of the take-off rule. */
export function isUsed(slot: EquipmentSlot): boolean {
  return slot.degreeOfUse > fx.fromInt(0);
}
