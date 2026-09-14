import { z } from 'zod';
import { Provenance } from '../record.js';

/**
 * A map's decoded scripting payload: the `playerdata`/`playermisc`/`MissionData` sections of its
 * `map.cif` `CStringArray`, or the plaintext `player.inc`/`mission.inc` twins the unpacked mod maps
 * ship. Numeric codes follow the original's `Data/GameSourceIncludes/logicdefines.inc` `#define`
 * tables, which the plaintext `#PLAYER_TYPE_*`/`#TRIBE_TYPE_*`/`#PLAYER_COLOR_ID_*` macros resolve
 * through; packed `map.cif`s store the resolved numbers.
 */

/** How many player-colour ids the original defines (`PLAYER_COLOR_ID_MAXIMUM`): ids are `0..9`. */
export const MAP_PLAYER_COLOR_COUNT = 10;

/**
 * One `player <slot> <type> <tribe> <colorId>` roster row. `type` is `PLAYER_TYPE_HUMAN 1` (a seat a
 * person may take) or `PLAYER_TYPE_AI 2` (script-driven); `tribeId` is the `TRIBE_TYPE_HUMAN_*` code
 * (1 viking … 7 egypt) and `colorId` the `PLAYER_COLOR_ID_*` code (0 blue … 9 black).
 */
export const MapPlayerSlot = z.strictObject({
  /** 0-based player slot id - the same key `StaticObjects` placements and diplomacy rows use. */
  player: z.number().int().nonnegative(),
  type: z.enum(['human', 'ai']),
  tribeId: z.number().int().positive(),
  colorId: z
    .number()
    .int()
    .min(0)
    .max(MAP_PLAYER_COLOR_COUNT - 1),
  /** The slot's authored display name (`playermisc` `nametribe` string id resolved against the map's
   *  string table), when the map ships one. */
  name: z.string().optional(),
});
export type MapPlayerSlot = z.infer<typeof MapPlayerSlot>;

/** One `diplomacy <from> <to> <state>` row (`DIPLOMACY_STATE_*`: 1 friend, 2 neutral, 3 enemy).
 *  Directed - maps author both directions and they can differ. */
export const MapDiplomacy = z.strictObject({
  from: z.number().int().nonnegative(),
  to: z.number().int().nonnegative(),
  state: z.enum(['friend', 'neutral', 'enemy']),
});
export type MapDiplomacy = z.infer<typeof MapDiplomacy>;

/** One raw script line kept lossless: its key/opcode and the raw value tokens, file order preserved. */
export const MapScriptLine = z.strictObject({
  key: z.string(),
  values: z.array(z.string()).default([]),
});
export type MapScriptLine = z.infer<typeof MapScriptLine>;

/**
 * One `[multiplayer]` `playeroption <slot> <type…>` row: which `PLAYER_TYPE_*` values the lobby
 * offers for the slot (`none` = closed). This is the seat-eligibility table, so a slot authored `ai`
 * in `playerdata` is still human-seatable when its options include `human`.
 */
export const MapMultiplayerSlot = z.strictObject({
  player: z.number().int().nonnegative(),
  allowed: z.array(z.enum(['human', 'ai', 'none'])),
});
export type MapMultiplayerSlot = z.infer<typeof MapMultiplayerSlot>;

/** The `[multiplayer]` section: per-slot lobby options, `playerhideinmenu` slots the lobby never
 *  lists, and `playerfixcolors` locking the authored colours. Unknown lines stay lossless in `other`. */
export const MapMultiplayer = z.strictObject({
  slotOptions: z.array(MapMultiplayerSlot).default([]),
  hiddenSlots: z.array(z.number().int().nonnegative()).default([]),
  fixedColors: z.boolean().optional(),
  other: z.array(MapScriptLine).default([]),
});
export type MapMultiplayer = z.infer<typeof MapMultiplayer>;

/**
 * One `MissionData` trigger; maps repeat the section, one per trigger. Each `goal`/`result` keeps its
 * quoted opcode and raw args verbatim, and lines outside that grammar land in `other`.
 */
export const MapMission = z.strictObject({
  /** The author's `debuginfo` label, the trigger's working name. */
  debugName: z.string().optional(),
  /** `description <stringId>` - the goal text shown to the player (`-1` = none). */
  descriptionStringId: z.number().int().optional(),
  /** That goal text, resolved against the map's string table when the id names a string. */
  description: z.string().optional(),
  active: z.boolean().optional(),
  visible: z.boolean().optional(),
  /** `successfullif <n>` - how many of the trigger's goals must hold. */
  successfullIf: z.number().int().optional(),
  goals: z.array(MapScriptLine).default([]),
  results: z.array(MapScriptLine).default([]),
  other: z.array(MapScriptLine).default([]),
});
export type MapMission = z.infer<typeof MapMission>;

/** How many special-item kinds the engine names (`SPECIAL_ITEM_TYPE_MAXIMUM`): kinds are `1..7`. */
export const MAP_SPECIAL_ITEM_KIND_COUNT = 7;

/**
 * One `[specialItems]` `add <player> <kind> [<houseType>]` row: a paper the player starts the map with.
 * `kind` is the `SPECIAL_ITEM_TYPE_*` code as the shipped `logicdefines.inc` resolves it (1 indulgence,
 * 2 place any house, 3 place the named house); `param` is the `HOUSE_TYPE_*` code a kind names, 0 otherwise.
 */
export const MapSpecialItem = z.strictObject({
  player: z.number().int().nonnegative(),
  kind: z.number().int().min(1).max(MAP_SPECIAL_ITEM_KIND_COUNT),
  param: z.number().int().nonnegative().default(0),
});
export type MapSpecialItem = z.infer<typeof MapSpecialItem>;

/** The whole decoded script: `misc` keeps `playermisc` and unrecognised `playerdata` lines lossless,
 *  and `missions` stays in authored order. */
export const MapScript = z.strictObject({
  players: z.array(MapPlayerSlot).default([]),
  diplomacy: z.array(MapDiplomacy).default([]),
  /** The `[multiplayer]` lobby table, when the map ships one. */
  multiplayer: MapMultiplayer.optional(),
  /** The `[specialItems]` starting papers, in authored order. */
  specialItems: z.array(MapSpecialItem).default([]),
  misc: z.array(MapScriptLine).default([]),
  missions: z.array(MapMission).default([]),
  source: Provenance.optional(),
});
export type MapScript = z.infer<typeof MapScript>;
