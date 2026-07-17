import { z } from 'zod';
import { Provenance } from '../record.js';

/**
 * A map's decoded scripting payload — the `playerdata`/`playermisc`/`MissionData` sections of its
 * `map.cif` `CStringArray` (or the plaintext `player.inc`/`mission.inc` twins the unpacked mod maps
 * ship). The player roster and diplomacy matrix are fully typed; the mission triggers keep their
 * goal/result opcodes lossless (opcode + raw args) so consumers can interpret the vocabulary
 * incrementally. Numeric codes follow the original's `Data/GameSourceIncludes/logicdefines.inc`
 * `#define` tables — the file the plaintext `#PLAYER_TYPE_*`/`#TRIBE_TYPE_*`/`#PLAYER_COLOR_ID_*`
 * macros resolve through (packed `map.cif`s store the resolved numbers).
 */

/** How many player-colour ids the original defines (`PLAYER_COLOR_ID_MAXIMUM`): ids are `0..9`. */
export const MAP_PLAYER_COLOR_COUNT = 10;

/**
 * One `player <slot> <type> <tribe> <colorId>` roster row. `type` decides menu eligibility: a
 * `human` slot is one a person may take (`PLAYER_TYPE_HUMAN 1`); an `ai` slot is script-driven
 * (`PLAYER_TYPE_AI 2`). `tribeId` is the `TRIBE_TYPE_HUMAN_*` code (1 viking … 7 egypt) and
 * `colorId` the `PLAYER_COLOR_ID_*` code (0 blue … 9 black) — both resolve against the same tables
 * the LUT/tribe content uses.
 */
export const MapPlayerSlot = z.strictObject({
  /** 0-based player slot id — the same key `StaticObjects` placements and diplomacy rows use. */
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
 *  Directed — maps author both directions and they can differ. */
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
 * One `[multiplayer]` `playeroption <slot> <type…>` row — which player types the multiplayer lobby
 * offers for the slot (`PLAYER_TYPE_*`: human seatable, ai, none = closed). This is the original's
 * seat-eligibility table: a slot authored `ai` in `playerdata` is still human-seatable when its
 * options include `human` (e.g. the packed multiplayer specials).
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
 * One `MissionData` trigger (maps repeat the section, one per trigger). The scalar header keys are
 * typed; each `goal`/`result` keeps its quoted opcode + raw args verbatim (28 observed result arg
 * shapes — interpretation is a consumer concern). Lines outside that grammar land in `other`.
 */
export const MapMission = z.strictObject({
  /** The author's `debuginfo` label — the trigger's working name, useful for cross-referencing. */
  debugName: z.string().optional(),
  /** `description <stringId>` — the goal text shown to the player (`-1` = none). */
  descriptionStringId: z.number().int().optional(),
  active: z.boolean().optional(),
  visible: z.boolean().optional(),
  /** `successfullif <n>` — how many of the trigger's goals must hold. */
  successfullIf: z.number().int().optional(),
  goals: z.array(MapScriptLine).default([]),
  results: z.array(MapScriptLine).default([]),
  other: z.array(MapScriptLine).default([]),
});
export type MapMission = z.infer<typeof MapMission>;

/** The whole decoded script: roster + diplomacy typed, `playermisc`/unknown `playerdata` lines kept
 *  lossless in `misc`, and the mission triggers in authored order. */
export const MapScript = z.strictObject({
  players: z.array(MapPlayerSlot).default([]),
  diplomacy: z.array(MapDiplomacy).default([]),
  /** The `[multiplayer]` lobby table, when the map ships one (the multiplayer-capable minority). */
  multiplayer: MapMultiplayer.optional(),
  misc: z.array(MapScriptLine).default([]),
  missions: z.array(MapMission).default([]),
  source: Provenance.optional(),
});
export type MapScript = z.infer<typeof MapScript>;
