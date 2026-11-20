import {
  applyMapVariantBriefing,
  applyMapVariantEntities,
  applyMapVariantScript,
  applyMapVariantStrings,
  findMapVariant,
  type MapBriefing,
  type MapScript,
  type MapStrings,
  type MapVariant,
  type MapVariantKind,
  type TerrainMapFile,
} from '@open-northland/data';
import type { ResourceYieldFactor, SessionRules, SessionWorld } from '@open-northland/lockstep';
import { resourceYieldFactor } from '../match/session-rules.js';
import type { MapScriptWorld } from '../world/build.js';

/** `?variant=<kind>`: which committed variant of the map a launch plays; absent plays it as authored. */
export const MAP_VARIANT_PARAM = 'variant';

/** The variant `?variant=` names for `mapId`; null when it names none the map ships. */
export function mapVariantParam(params: URLSearchParams, mapId: string | null): MapVariantKind | null {
  const kind = params.get(MAP_VARIANT_PARAM);
  if (kind === null || mapId === null) return null;
  return findMapVariant(mapId, kind)?.kind ?? null;
}

/** Map variants are a developer preview: only a dev server lets a person choose one. A variant that a
 *  room, a peer or a save names still plays, so every peer assembles the same world. */
export function mapVariantsSelectable(devServer: boolean = import.meta.env.DEV): boolean {
  return devServer;
}

/** The variant a person's launch search chooses: {@link mapVariantParam} where variants are selectable,
 *  else none. */
export function chosenMapVariantParam(
  params: URLSearchParams,
  mapId: string | null,
  selectable: boolean = mapVariantsSelectable(),
): MapVariantKind | null {
  return selectable ? mapVariantParam(params, mapId) : null;
}

/** The variant a session's world is built under. Throws on a variant this build does not ship, because a
 *  peer or save naming it describes a world this client cannot assemble. */
export function sessionMapVariant(world: SessionWorld): MapVariant | null {
  if (world.kind !== 'map' || world.variant === undefined) return null;
  const variant = findMapVariant(world.mapId, world.variant);
  if (variant === null) throw new Error(`map ${world.mapId} ships no variant ${world.variant}`);
  return variant;
}

/** The map's script as the session's world plays it. */
export function variantMapScript(script: MapScript, world: SessionWorld): MapScript;
export function variantMapScript(script: MapScript | null, world: SessionWorld): MapScript | null;
export function variantMapScript(script: MapScript | null, world: SessionWorld): MapScript | null {
  const variant = sessionMapVariant(world);
  return script === null || variant === null ? script : applyMapVariantScript(script, variant);
}

/** The map's briefing as the session's world tells it. */
export function variantBriefing(briefing: MapBriefing | null, world: SessionWorld): MapBriefing | null {
  const variant = sessionMapVariant(world);
  return briefing === null || variant === null ? briefing : applyMapVariantBriefing(briefing, variant);
}

/** The map's string table as the session's world names things, its escalation heroes included. */
export function variantStrings(strings: MapStrings | null, world: SessionWorld): MapStrings | null {
  const variant = sessionMapVariant(world);
  return variant === null ? strings : applyMapVariantStrings(strings, variant);
}

/** The map's placements as the session's world starts them. */
export function variantMap(map: TerrainMapFile | null, world: SessionWorld): TerrainMapFile | null {
  const variant = sessionMapVariant(world);
  if (map?.entities === undefined || variant === null) return map;
  return { ...map, entities: applyMapVariantEntities(map.entities, variant, map) };
}

/** The script world with the session variant's escalation, which the build and every restore pass on. */
export function variantScriptWorld(script: MapScriptWorld, world: SessionWorld): MapScriptWorld {
  const escalation = sessionMapVariant(world)?.escalation;
  return escalation === undefined ? script : { ...script, escalation };
}

/** The map world a launch plays: `mapId` under `variant`, or as authored. */
export function mapSessionWorld(mapId: string, variant: string | null): SessionWorld {
  return variant === null ? { kind: 'map', mapId } : { kind: 'map', mapId, variant };
}

/** The ore richness choosing `variant` of `mapId` sets; null for no variant or one that sets none. */
export function variantOreYield(mapId: string, variant: string | null): ResourceYieldFactor | null {
  const found = variant === null ? null : findMapVariant(mapId, variant);
  return found?.oreYield === undefined ? null : resourceYieldFactor(found.oreYield);
}

/** The ore richness a session on `world` starts at by default: its variant's, else the authored stock. */
export function sessionOreYield(world: SessionWorld): ResourceYieldFactor | null {
  return world.kind === 'map' ? variantOreYield(world.mapId, world.variant ?? null) : null;
}

/** A lobby's ore richness after its variant changes from `from` to `to`, with the player's own choice
 *  (`own`) it gives back when the new variant brings none; a choice made over a variant's own is the
 *  player's too. */
export function oreYieldAcrossVariants(
  mapId: string,
  from: string | null,
  to: string | null,
  choice: { readonly oreYield: ResourceYieldFactor | null; readonly own: ResourceYieldFactor | null },
): { oreYield: ResourceYieldFactor | null; own: ResourceYieldFactor | null } {
  const fromOre = variantOreYield(mapId, from);
  const own = fromOre === null || choice.oreYield !== fromOre ? choice.oreYield : choice.own;
  return { oreYield: variantOreYield(mapId, to) ?? own, own };
}

/** A new room's `rules` with the ore richness its world's variant brings, where the launch names none. */
export function withVariantOreYield(rules: SessionRules, world: SessionWorld): SessionRules {
  return { ...rules, oreYield: rules.oreYield ?? sessionOreYield(world) };
}
