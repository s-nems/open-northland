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

/** Build an inert default-menu button. */
const placeholder = (id: string, icon: ActionIconFrame): ActionButton => ({
  kind: 'placeholder',
  id,
  icon,
});

/**
 * The default menu of a civilian human, arm by arm, in the frame binding the user read off the running game.
 * {@link menuForJob} swaps per-profession variants (the scout's erect-signpost arm today); per-state buttons
 * (e.g. marriage hiding once married) remain a future filter over the stable button `id`s.
 */
export const HUMAN_DEFAULT_MENU: readonly ActionGroup[] = [
  // Top row, left→right (0x70 change-profession, 0x86 hammer, 0x6e "!", 0x63 "?").
  {
    group: TOP_ARM,
    buttons: [
      CHANGE_JOB,
      placeholder('build', 'order_construct'),
      placeholder('alert', 'order_alert'),
      placeholder('query', 'order_query'),
    ],
  },
  // Left column, top→bottom (0x76 attack, 0x77 house, 0x78 animal, 0x79 vehicle).
  {
    group: LEFT_ARM,
    buttons: [
      placeholder('attack', 'order_spearman'),
      placeholder('assign_house', 'order_house'),
      placeholder('animal', 'order_animal'),
      placeholder('vehicle', 'order_transport'),
    ],
  },
  // Bottom row, left→right (0x68 marry, 0x7e pray, 0x7d talk, 0x6c sleep, 0x7b eat, 0x6b fallback/last).
  {
    group: BOTTOM_ARM,
    buttons: [
      placeholder('marry', 'order_marry'),
      placeholder('pray', 'order_pray'),
      placeholder('talk', 'order_figure_hand'),
      placeholder('sleep', 'unknown_108'),
      placeholder('eat', 'order_assign_work'),
      placeholder('bottom_last', ACTION_ICON_FALLBACK),
    ],
  },
  // Right column, top→bottom (0x81, 0x60, 0x7f, 0x65) — the four "house assignment" buttons.
  {
    group: RIGHT_ARM,
    buttons: [
      placeholder('house_a', 'order_house_repair'),
      placeholder('house_b', 'order_build'),
      placeholder('house_c', 'order_crest'),
      placeholder('house_d', 'order_house_enter'),
    ],
  },
];

/** The scout job id (`jobtypes.ini` type 27) — mirrors `catalog/professions.ts`; kept local so the pure
 *  hud layer needs no catalog import. */
const SCOUT_JOB_TYPE = 27;

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
 * The scout's menu: the default arms with the top-right alert/query pair swapped for the erect-signpost
 * button (observed original: the scout's selection UI carries "Erect Signpost" in the top-right corner
 * instead of Alarm/Information).
 */
export const SCOUT_MENU: readonly ActionGroup[] = HUMAN_DEFAULT_MENU.map((g) =>
  g.group === TOP_ARM
    ? {
        group: TOP_ARM,
        buttons: g.buttons.flatMap((b) => {
          if (b.id === 'alert') return [ERECT_SIGNPOST];
          if (b.id === 'query') return [];
          return [b];
        }),
      }
    : g,
);

/** The action menu for a settler of `jobType` — the per-profession variant seam (data, not code). */
export function menuForJob(jobType: number | null | undefined): readonly ActionGroup[] {
  return jobType === SCOUT_JOB_TYPE ? SCOUT_MENU : HUMAN_DEFAULT_MENU;
}
