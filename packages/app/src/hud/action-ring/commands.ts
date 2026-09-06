import type { GuiFrameName } from '../../content/gui-atlas-map.js';
import { type ActionArm, BOTTOM_ARM, INNER_LEFT_ARM, LEFT_ARM, RIGHT_ARM, TOP_ARM } from './layout.js';

/**
 * The settler action menu's content: which orders the ring offers, on which arm, in which drawn order,
 * under which icon. Arm, order and icon follow the original, whose action rows were read off the running
 * game; each icon is the sheet frame that order's button draws.
 */

/** The orders the view issues to the simulation; the profession change opens the ring's own list. */
export type ActionOrderId =
  | 'haveGirl'
  | 'haveBoy'
  | 'marry'
  | 'goTo'
  | 'assignWorkArea'
  | 'erectSignpost'
  | 'assignBuildingSite'
  | 'assignLearningPlace'
  | 'removeWorkPlace'
  | 'assignWorkPlace'
  | 'removeHome'
  | 'assignHome'
  | 'attackInhabitants'
  | 'attackBuilding'
  | 'attackPosition'
  | 'attackMode'
  | 'defenceMode'
  | 'ignorantMode';

/** Orders the original offers that the simulation has no mechanic for: drawn where the original draws
 *  them, and inert when clicked. */
const PENDING_ACTION_IDS = [
  'eat',
  'sleep',
  'talk',
  'pray',
  'changeEquipment',
  'showWorkArea',
  'explore',
  'removeBuildingSite',
  'removeLearningPlace',
  'assignVehicle',
  'attackAnimal',
  'attackVehicle',
  'allowRegeneration',
  'prohibitRegeneration',
] as const;

export type PendingActionId = (typeof PENDING_ACTION_IDS)[number];

export type ActionCommandId = ActionOrderId | 'changeProfession' | PendingActionId;

export interface ActionCommand {
  readonly id: ActionCommandId;
  readonly arm: ActionArm;
  readonly icon: GuiFrameName;
  /** Whether a selection of several settlers still offers it; the rest are single-settler orders. */
  readonly multi: boolean;
}

/**
 * Every order the ring can draw, arm by arm and within an arm in drawn order: left to right on the two
 * rows, top to bottom on the three columns. A menu is this table filtered to what the selection allows,
 * so the relative order never depends on which orders survive.
 */
export const ACTION_COMMANDS: readonly ActionCommand[] = [
  { id: 'haveGirl', arm: BOTTOM_ARM, icon: 'order_female', multi: true },
  { id: 'haveBoy', arm: BOTTOM_ARM, icon: 'order_male', multi: true },
  { id: 'marry', arm: BOTTOM_ARM, icon: 'order_marry', multi: true },
  { id: 'pray', arm: BOTTOM_ARM, icon: 'order_pray', multi: true },
  { id: 'talk', arm: BOTTOM_ARM, icon: 'order_talk', multi: true },
  { id: 'sleep', arm: BOTTOM_ARM, icon: 'order_sleep', multi: true },
  { id: 'eat', arm: BOTTOM_ARM, icon: 'order_eat', multi: true },
  { id: 'goTo', arm: BOTTOM_ARM, icon: 'order_go_to', multi: false },

  { id: 'changeProfession', arm: TOP_ARM, icon: 'order_change_profession', multi: true },
  { id: 'changeEquipment', arm: TOP_ARM, icon: 'order_change_equipment', multi: true },
  { id: 'assignWorkArea', arm: TOP_ARM, icon: 'order_assign_work_area', multi: false },
  { id: 'showWorkArea', arm: TOP_ARM, icon: 'order_show_work_area', multi: false },
  { id: 'erectSignpost', arm: TOP_ARM, icon: 'order_erect_signpost', multi: false },
  { id: 'explore', arm: TOP_ARM, icon: 'order_explore', multi: false },

  { id: 'removeBuildingSite', arm: RIGHT_ARM, icon: 'order_remove_building_site', multi: false },
  { id: 'assignBuildingSite', arm: RIGHT_ARM, icon: 'order_assign_building_site', multi: false },
  { id: 'removeLearningPlace', arm: RIGHT_ARM, icon: 'order_remove_learning_place', multi: false },
  { id: 'assignLearningPlace', arm: RIGHT_ARM, icon: 'order_assign_learning_place', multi: false },
  { id: 'removeWorkPlace', arm: RIGHT_ARM, icon: 'order_remove_work_place', multi: false },
  { id: 'assignWorkPlace', arm: RIGHT_ARM, icon: 'order_assign_work_place', multi: false },
  { id: 'assignVehicle', arm: RIGHT_ARM, icon: 'order_assign_vehicle', multi: false },
  { id: 'removeHome', arm: RIGHT_ARM, icon: 'order_remove_home', multi: false },
  { id: 'assignHome', arm: RIGHT_ARM, icon: 'order_assign_home', multi: false },

  { id: 'attackInhabitants', arm: LEFT_ARM, icon: 'order_attack_inhabitants', multi: true },
  { id: 'attackBuilding', arm: LEFT_ARM, icon: 'order_attack_building', multi: true },
  { id: 'attackAnimal', arm: LEFT_ARM, icon: 'order_attack_animal', multi: true },
  { id: 'attackVehicle', arm: LEFT_ARM, icon: 'order_attack_vehicle', multi: true },
  { id: 'attackPosition', arm: LEFT_ARM, icon: 'order_attack_position', multi: true },

  { id: 'attackMode', arm: INNER_LEFT_ARM, icon: 'order_attack_mode', multi: true },
  { id: 'defenceMode', arm: INNER_LEFT_ARM, icon: 'order_defence_mode', multi: true },
  { id: 'ignorantMode', arm: INNER_LEFT_ARM, icon: 'order_ignorant_mode', multi: true },
  { id: 'allowRegeneration', arm: INNER_LEFT_ARM, icon: 'order_allow_regeneration', multi: true },
  { id: 'prohibitRegeneration', arm: INNER_LEFT_ARM, icon: 'order_prohibit_regeneration', multi: true },
];

const PENDING_ACTIONS: ReadonlySet<ActionCommandId> = new Set<ActionCommandId>(PENDING_ACTION_IDS);

export function isPendingAction(id: ActionCommandId): id is PendingActionId {
  return PENDING_ACTIONS.has(id);
}
