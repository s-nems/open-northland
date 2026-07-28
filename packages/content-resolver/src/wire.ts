/**
 * The JSON shapes the content routes serve, declared where both sides can read them: the node builders
 * here and the browser that fetches them. Types only — this module must stay free of `node:` imports so
 * the app can import it without pulling a builtin into its bundle.
 *
 * A shared type is a compile-time link, not a promise about what a host actually served: a browser
 * consumer still narrows the payload it receives.
 */

/** One map player slot as the menu needs it, lifted from the `<id>.script.json` sidecar's roster. */
export interface MapsIndexPlayerSlot {
  /** 0-based player slot id. */
  readonly player: number;
  /** The slot's authored `playerdata` type: `human` or script-driven `ai`. */
  readonly type: 'human' | 'ai';
  /** `TRIBE_TYPE_HUMAN_*` code (1 viking … 7 egypt). */
  readonly tribeId: number;
  /** `PLAYER_COLOR_ID_*` code (0 blue … 9 black) — the slot's authored team colour. */
  readonly colorId: number;
  /** The slot's authored display name, when the map ships one. */
  readonly name?: string;
  /**
   * Whether a person may take this seat: the authored type is `human`, or the map's `[multiplayer]`
   * `playeroption` row offers `human` for the slot (the original lobby's seat-eligibility table).
   */
  readonly claimable: boolean;
  /** `[multiplayer]` `playerhideinmenu` — the original lobby never lists this slot. */
  readonly hidden: boolean;
  /** Whether the seat may auto-play when vacant: its `playeroption` row offers `ai`, or the map
   *  ships no row for it (47 corpus rows are Human/Closed-only — no AI offer). */
  readonly aiAllowed: boolean;
}

/** One `/maps-index` entry: a decoded map's stem id + the pipeline's optional menu sidecars. */
export interface MapsIndexEntry {
  readonly id: string;
  readonly name?: string;
  readonly description?: string;
  /** Whether `/maps/<id>.png` (the decoded minimap thumbnail) exists. */
  readonly minimap: boolean;
  /** The map's player roster (absent when the map ships no decodable `playerdata`). */
  readonly players?: readonly MapsIndexPlayerSlot[];
  /** `[multiplayer]` `playerfixcolors` — the map locks its authored team colours. */
  readonly fixedColors?: boolean;
}

/** One `/bobs-index` entry: a viewable atlas stem and its base-set / palette-variant split. */
export interface BobsIndexEntry {
  /** The atlas stem — the `/bobs/<stem>.png` + `/bobs/<stem>.atlas.json` the gallery loads. */
  readonly stem: string;
  /** The base sprite set (the stem up to the first dot), e.g. `ls_gui_window`, `ls_houses_viking`. */
  readonly base: string;
  /** The palette variant (the stem after the first dot), e.g. `iconsleft`, `house01`; `''` if none. */
  readonly variant: string;
}
