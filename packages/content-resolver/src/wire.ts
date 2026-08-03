/**
 * The JSON shapes the content routes serve. Types only: this module stays free of `node:` imports so
 * the app can import it without pulling a builtin into its bundle.
 */

/** One map player slot, lifted from the `<id>.script.json` sidecar's roster. */
export interface MapsIndexPlayerSlot {
  /** 0-based player slot id. */
  readonly player: number;
  /** The authored `[playerdata]` type. */
  readonly type: 'human' | 'ai';
  /** `TRIBE_TYPE_HUMAN_*` code (1 viking … 7 egypt). */
  readonly tribeId: number;
  /** `PLAYER_COLOR_ID_*` code (0 blue … 9 black). */
  readonly colorId: number;
  readonly name?: string;
  /** Whether a person may take this seat: the authored type is `human`, or the map's `[multiplayer]`
   *  `playeroption` row offers `human` for the slot. */
  readonly claimable: boolean;
  /** `[multiplayer]` `playerhideinmenu` - the original lobby never lists this slot. */
  readonly hidden: boolean;
  /** Whether the seat may auto-play when vacant: its `playeroption` row offers `ai`, or the map ships
   *  no row for it. */
  readonly aiAllowed: boolean;
}

/** One `/maps-index` entry: a decoded map's stem id + the pipeline's optional menu sidecars. */
export interface MapsIndexEntry {
  readonly id: string;
  readonly name?: string;
  readonly description?: string;
  /** Whether the minimap thumbnail `/maps/<id>.png` exists. */
  readonly minimap: boolean;
  /** Absent when the map ships no decodable `playerdata`. */
  readonly players?: readonly MapsIndexPlayerSlot[];
  /** `[multiplayer]` `playerfixcolors` - the map locks its authored team colours. */
  readonly fixedColors?: boolean;
  /** The script sidecar ships a `[multiplayer]` lobby table. Emitted only when true. */
  readonly multiplayer?: boolean;
}

/** One `/bobs-index` entry: a viewable atlas stem and its base-set / palette-variant split. */
export interface BobsIndexEntry {
  /** Names the `/bobs/<stem>.png` + `/bobs/<stem>.atlas.json` pair. */
  readonly stem: string;
  /** The base sprite set: the stem up to the first dot, e.g. `ls_houses_viking`. */
  readonly base: string;
  /** The palette variant: the stem after the first dot, or `''` when it has none. */
  readonly variant: string;
}
