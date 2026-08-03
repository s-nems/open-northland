import {
  type ActionButton,
  type ActionGroup,
  type ActionIconFrame,
  BOTTOM_ARM,
  LEFT_ARM,
  RIGHT_ARM,
  TOP_ARM,
} from './action-ring-layout.js';

/**
 * The settler action menu's content as plain data. The command-to-icon binding is an observation of the
 * running original, read clockwise from the top-left button; the frame names are glyph descriptions, so a
 * command's icon name needn't match its label.
 */

/** The default order-button gfx: frame 0x6b, observed in the last bottom slot. Command-to-frame
 *  bindings stay provisional until checked in the running original. */
const ACTION_ICON_FALLBACK = 'order_icon_fallback';

/** Opens the profession list window. Its icon is the original's two-screws glyph (observation). */
const CHANGE_JOB: ActionButton = {
  kind: 'open-jobs',
  id: 'changeProfession',
  icon: 'order_change_profession',
};

/** Build an inert default-menu button. Every button below is a module-level singleton: retained visuals
 *  are keyed by button object identity, so a fresh per-call object would never match its baked icon. */
const placeholder = (id: string, icon: ActionIconFrame): ActionButton => ({
  kind: 'placeholder',
  id,
  icon,
});

const BUILD = placeholder('build', 'order_construct');
const ALERT = placeholder('alert', 'order_alert');
const QUERY = placeholder('query', 'order_query');
const ANIMAL = placeholder('animal', 'order_animal');
const VEHICLE = placeholder('vehicle', 'order_transport');
const PRAY = placeholder('pray', 'order_pray');
const TALK = placeholder('talk', 'order_figure_hand');
const SLEEP = placeholder('sleep', 'unknown_108');
const EAT = placeholder('eat', 'order_assign_work');
const BOTTOM_LAST = placeholder('bottom_last', ACTION_ICON_FALLBACK);
const HOUSE_A = placeholder('house_a', 'order_house_repair');
const HOUSE_B = placeholder('house_b', 'order_build');
const HOUSE_C = placeholder('house_c', 'order_crest');
const HOUSE_D = placeholder('house_d', 'order_house_enter');

/** The original's `misclogic/48` order. */
const ATTACK: ActionButton = { kind: 'attack-move', id: 'attack', icon: 'order_spearman' };

const MARRY: ActionButton = { kind: 'marry', id: 'marry', icon: 'order_marry' };

const ASSIGN_HOUSE: ActionButton = { kind: 'assign-house', id: 'assign_house', icon: 'order_house' };

const MAKE_SON: ActionButton = { kind: 'make-child', id: 'make_son', sex: 'male', icon: 'order_male' };
const MAKE_DAUGHTER: ActionButton = {
  kind: 'make-child',
  id: 'make_daughter',
  sex: 'female',
  icon: 'order_female',
};

/**
 * The scout's "Erect Signpost" gui string, replacing the civilian's alert/query pair in the top-right
 * slots. Icon frame 111 (`order_mine`, the pickaxe glyph), observed in the running original.
 */
const ERECT_SIGNPOST: ActionButton = {
  kind: 'erect-signpost',
  id: 'erectSignpost',
  icon: 'order_mine',
};

/** The selected settler's state the menu depends on, computed by the view from the snapshot. */
export interface SettlerMenuState {
  /** Only an adult man may change trade; the sim guards `setJob` the same way. */
  readonly canChangeJob: boolean;
  /** An unmarried, not-yet-marrying eligible adult (not a soldier/scout) may seek a partner. */
  readonly canMarry: boolean;
  /** Any adult settler may be assigned a home. */
  readonly canAssignHouse: boolean;
  /** A married woman with no growing child may order a son/daughter. */
  readonly canOrderChild: boolean;
  /** A scout swaps the top-right alert/query pair for "Erect Signpost" (observed original). */
  readonly erectSignpost: boolean;
}

/** The multi-selection state: every family button hidden, change-profession kept because a mixed
 *  selection may still re-trade its men and the sim filters. */
export const DEFAULT_MENU_STATE: SettlerMenuState = {
  canChangeJob: true,
  canMarry: false,
  canAssignHouse: false,
  canOrderChild: false,
  erectSignpost: false,
};

/**
 * The default civilian menu for a settler `state`, arm by arm, in the frame binding observed in the
 * running original.
 */
export function menuForSettler(state: SettlerMenuState): readonly ActionGroup[] {
  return [
    // Top row, left→right (0x70 change-profession, 0x86 hammer, 0x6e "!", 0x63 "?").
    {
      group: TOP_ARM,
      buttons: [
        ...(state.canChangeJob ? [CHANGE_JOB] : []),
        BUILD,
        ...(state.erectSignpost ? [ERECT_SIGNPOST] : [ALERT, QUERY]),
      ],
    },
    // Left column, top→bottom (0x76 attack, 0x77 house, 0x78 animal, 0x79 vehicle).
    {
      group: LEFT_ARM,
      buttons: [ATTACK, ...(state.canAssignHouse ? [ASSIGN_HOUSE] : []), ANIMAL, VEHICLE],
    },
    // Bottom row, left→right (0x68 marry, 0x7e pray, 0x7d talk, 0x6c sleep, 0x7b eat, 0x6b fallback/last).
    {
      group: BOTTOM_ARM,
      buttons: [
        ...(state.canMarry ? [MARRY] : []),
        ...(state.canOrderChild ? [MAKE_SON, MAKE_DAUGHTER] : []),
        PRAY,
        TALK,
        SLEEP,
        EAT,
        BOTTOM_LAST,
      ],
    },
    // Right column, top→bottom (0x81, 0x60, 0x7f, 0x65): the four "house assignment" buttons.
    { group: RIGHT_ARM, buttons: [HOUSE_A, HOUSE_B, HOUSE_C, HOUSE_D] },
  ];
}

/**
 * Every dynamic button on: the layout superset the geometry tests pin, not what any live selection
 * renders.
 */
export const HUMAN_DEFAULT_MENU: readonly ActionGroup[] = menuForSettler({
  canChangeJob: true,
  canMarry: true,
  canAssignHouse: true,
  canOrderChild: true,
  erectSignpost: false,
});

/** Every button any menu state can show; the view bakes its retained visuals from these singletons. */
export const ALL_MENU_BUTTONS: readonly ActionButton[] = [
  ...HUMAN_DEFAULT_MENU.flatMap((g) => g.buttons),
  ERECT_SIGNPOST,
];
