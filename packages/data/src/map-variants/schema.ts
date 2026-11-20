import { z } from 'zod';
import { LANGUAGES } from '../languages.js';
import { HypertextBlock } from '../schema/gui/hypertext.js';
import { MapAiTask, MapMultiplayerSlot, MapScriptLine } from '../schema/maps/script.js';
import { MapEscalation } from './escalation.js';

/** The kinds of variant a map can ship. A kind is also the variant's id within its map, the value the
 *  `variant` launch param and the session descriptor carry, and the key its lobby label is looked up by. */
export const MapVariantKind = z.enum(['ragnarok']);
export type MapVariantKind = z.infer<typeof MapVariantKind>;

/** Result lines added to the end of one authored mission, named by its `debuginfo` label. */
export const MapVariantMissionResults = z.strictObject({
  mission: z.string().min(1),
  results: z.array(MapScriptLine).min(1),
});
export type MapVariantMissionResults = z.infer<typeof MapVariantMissionResults>;

/** `[AIData]` tasks added after one seat's authored tasks, so every authored task keeps its index. */
export const MapVariantAiTasks = z.strictObject({
  player: z.number().int().nonnegative(),
  tasks: z.array(MapAiTask).min(1),
});
export type MapVariantAiTasks = z.infer<typeof MapVariantAiTasks>;

/**
 * What the variant changes in the map's decoded script before the world is built. Missions are named
 * by `debuginfo` label and neutralised in place, never removed: `ActivateMission <n>` addresses a
 * mission by its index, so every other mission keeps its number.
 */
export const MapVariantScriptPatch = z.strictObject({
  /** `[multiplayer]` `playeroption` rows that replace the authored row for the same seat. */
  slotOptions: z.array(MapMultiplayerSlot).default([]),
  /** Missions that keep their index but lose every goal and result and start inactive and hidden. */
  neutralizedMissions: z.array(z.string().min(1)).default([]),
  appendedResults: z.array(MapVariantMissionResults).default([]),
  /** The house mission object ids whose `tradeagreement` rows the variant drops. */
  droppedTradeHouses: z.array(z.number().int()).default([]),
  appendedAiTasks: z.array(MapVariantAiTasks).default([]),
});
export type MapVariantScriptPatch = z.infer<typeof MapVariantScriptPatch>;

/** A harvestable landscape object the variant places after the map's own: a `[GfxLandscape]` EditName a
 *  gatherer works (a tree, a deposit), anchored at a half-cell node, at its 1-based growth level; absent,
 *  full-grown. */
export const MapVariantLandscapeObject = z.strictObject({
  object: z.string().min(1),
  hx: z.number().int().nonnegative(),
  hy: z.number().int().nonnegative(),
  level: z.number().int().min(1).optional(),
});
export type MapVariantLandscapeObject = z.infer<typeof MapVariantLandscapeObject>;

/** A seat that starts as another one does: `from`'s authored settlers in place of its own, each shifted by
 *  (`dx`, `dy`) half-cell nodes, and `from`'s starting papers and diplomacy locks in place of its own. */
export const MapVariantStartSeat = z
  .strictObject({
    player: z.number().int().nonnegative(),
    from: z.number().int().nonnegative(),
    dx: z.number().int(),
    dy: z.number().int(),
  })
  .refine((row) => row.player !== row.from, 'a seat starts as itself');
export type MapVariantStartSeat = z.infer<typeof MapVariantStartSeat>;

/** Briefing pages the variant tells in its own words, by `PlayCutscene` id, each per map text language;
 *  a page in a language the variant lacks takes the language a reader of it falls back to. */
export const MapVariantBriefingPages = z.record(
  z.string().regex(/^\d+$/),
  z.partialRecord(z.enum(LANGUAGES), z.array(HypertextBlock).min(1)),
);
export type MapVariantBriefingPages = z.infer<typeof MapVariantBriefingPages>;

/**
 * One committed variant of one map: our own authored rules over the map's decoded data, never a copy
 * of it. Every map-specific number lives here, so the systems that read it stay generic.
 */
export const MapVariant = z.strictObject({
  mapId: z.string().min(1),
  kind: MapVariantKind,
  script: MapVariantScriptPatch,
  /** The seats whose start the variant copies from another seat's. A copied settler is placed as if the
   *  map authored it, so an absent seat's stay out too. */
  startSeats: z.array(MapVariantStartSeat).default([]),
  /** The ore richness a lobby sets when the variant is chosen, a session `oreYield` factor; absent leaves
   *  the rule as the lobby holds it. */
  oreYield: z.number().int().min(2).optional(),
  /** Placed at world assembly after every authored object, so authored nodes keep their entity ids; their
   *  stock takes the session's yield like the map's own. */
  landscapeObjects: z.array(MapVariantLandscapeObject).default([]),
  /** The briefing pages the variant replaces, to tell what it changes. */
  briefingPages: MapVariantBriefingPages.optional(),
  /** The siege the simulation runs over the map; absent for a variant that only patches the map. */
  escalation: MapEscalation.optional(),
});
export type MapVariant = z.infer<typeof MapVariant>;
export type MapVariantInput = z.input<typeof MapVariant>;
