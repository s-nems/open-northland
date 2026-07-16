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
 * The settler action menu's content — the command buttons and their icon bindings, kept as plain data
 * apart from the geometry engine (`action-ring-layout.ts`) so a warrior/scout variant is a new table, not
 * new code. The command→icon binding here was read off the running original by the user,
 * clockwise from the top-left button (source basis "settler action menu"); the frame names are glyph
 * descriptions from the montage, so a command's icon name needn't match its label. Only `open-jobs` fires
 * today; every other button is an inert placeholder.
 */

/**
 * The default order-button gfx. The user placed frame 0x6b in the last bottom slot, so it draws here too;
 * exact command-to-frame bindings remain provisional until checked in the running original.
 */
const ACTION_ICON_FALLBACK = 'order_icon_fallback';

/**
 * The "change profession" button — the one live default-menu button (opens the profession list window). Its
 * icon is the original's two-screws glyph (frame `order_change_profession`, user-identified off the running game).
 */
const CHANGE_JOB: ActionButton = {
  kind: 'open-jobs',
  id: 'changeProfession',
  icon: 'order_change_profession',
};

/** Build an inert default-menu button. Every button below is a module-level singleton: the view's
 *  retained visuals are keyed by button object identity, so a per-call fresh object would never match
 *  its baked icon and the button would silently not draw. */
const placeholder = (id: string, icon: ActionIconFrame): ActionButton => ({
  kind: 'placeholder',
  id,
  icon,
});

// The inert default-menu buttons, one stable instance each (see the identity note on `placeholder`).
const BUILD = placeholder('build', 'order_construct');
const ALERT = placeholder('alert', 'order_alert');
const QUERY = placeholder('query', 'order_query');
const ATTACK = placeholder('attack', 'order_spearman');
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

/** The live "find a partner" button (the sim `marry` order). */
const MARRY: ActionButton = { kind: 'marry', id: 'marry', icon: 'order_marry' };

/** The live "assign home" button (arms the click-a-house pick mode). */
const ASSIGN_HOUSE: ActionButton = { kind: 'assign-house', id: 'assign_house', icon: 'order_house' };

/** The live "make a son" / "make a daughter" pair (the sim `makeChild` order). */
const MAKE_SON: ActionButton = { kind: 'make-child', id: 'make_son', sex: 'male', icon: 'order_male' };
const MAKE_DAUGHTER: ActionButton = {
  kind: 'make-child',
  id: 'make_daughter',
  sex: 'female',
  icon: 'order_female',
};

/**
 * The scout's "Erect Signpost" button — the original's scout action ("Erect Signpost" gui string; it
 * replaces the civilian's alert/query pair in the top-right slots). Icon: frame 111 (`order_mine`,
 * the pickaxe glyph) — user-identified against the running original.
 */
const ERECT_SIGNPOST: ActionButton = {
  kind: 'erect-signpost',
  id: 'erectSignpost',
  icon: 'order_mine',
};

/**
 * What of the selected settler's state the menu depends on — computed by the view from the snapshot
 * (a single selected settler; a multi-selection shows the static default menu).
 */
export interface SettlerMenuState {
  /** An adult man may change trade — women keep the woman role for life and a child's stage is the
   *  GrowthSystem's, so both hide the button (the sim guards `setJob` the same way). */
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

/** The static default state — every family button hidden (multi-selection, no snapshot state); the
 *  change-profession button stays (a mixed selection may still re-trade its men — the sim filters). */
export const DEFAULT_MENU_STATE: SettlerMenuState = {
  canChangeJob: true,
  canMarry: false,
  canAssignHouse: false,
  canOrderChild: false,
  erectSignpost: false,
};

/**
 * The default menu of a civilian human for a given settler `state`, arm by arm, in the frame binding the
 * user read off the running game. Per-state buttons appear/vanish: `marry` shows only while the settler
 * may seek a partner (it hides for life once married), `assign_house` for adults, the make-son /
 * make-daughter pair only for a married woman without a growing child, and a scout's top-right
 * alert/query pair gives way to the erect-signpost button. The menu stays plain data.
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
    // Right column, top→bottom (0x81, 0x60, 0x7f, 0x65) — the four "house assignment" buttons.
    { group: RIGHT_ARM, buttons: [HOUSE_A, HOUSE_B, HOUSE_C, HOUSE_D] },
  ];
}

/**
 * The static default menu (every dynamic button visible, the civilian top row) — the multi-selection
 * face. The view bakes its retained icon visuals from {@link ALL_MENU_BUTTONS}, which also carries the
 * scout-variant button this face omits.
 */
export const HUMAN_DEFAULT_MENU: readonly ActionGroup[] = menuForSettler({
  canChangeJob: true,
  canMarry: true,
  canAssignHouse: true,
  canOrderChild: true,
  erectSignpost: false,
});

/** Every button any menu state can show — the superset the view bakes its retained visuals from
 *  (visuals key by button object identity, so this must enumerate the singletons, not rebuild them). */
export const ALL_MENU_BUTTONS: readonly ActionButton[] = [
  ...HUMAN_DEFAULT_MENU.flatMap((g) => g.buttons),
  ERECT_SIGNPOST,
];

