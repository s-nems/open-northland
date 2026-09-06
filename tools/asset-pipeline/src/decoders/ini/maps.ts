/**
 * Map metadata from a map `.cif` header. The `StaticObjects` placements are in `static-objects.ts`.
 */
import { MapInfo, type MapProvenance } from '@open-northland/data';
import type { RuleSection } from './grammar.js';
import { makeSource, type SourceRef } from './ir-fields.js';
import { findProp, getInt } from './props.js';

/**
 * Reduces one decoded `map.cif`'s logic header into a validated {@link MapInfo}: the `logiccontrol`
 * section's `mapsize <w> <h>` and `mapguid <16 bytes>`, plus the optional `misc_maptype`/`misc_mapname`
 * scalars. `id` comes from the caller (the map folder name) because the header carries no
 * human-readable map id, and so does `provenance`, which the header cannot know.
 */
export function extractMapInfo(
  sections: readonly RuleSection[],
  id: string,
  src: SourceRef,
  provenance: MapProvenance,
): MapInfo {
  const logic = sections.find((s) => s.name === 'logiccontrol');
  if (logic === undefined) {
    throw new Error(`ini: map ${src.file} has no [logiccontrol] section`);
  }
  const size = findProp(logic, 'mapsize')?.values;
  const width = Number.parseInt(size?.[0] ?? '', 10);
  const height = Number.parseInt(size?.[1] ?? '', 10);
  if (Number.isNaN(width) || Number.isNaN(height)) {
    throw new Error(`ini: map ${src.file} has no valid \`mapsize <w> <h>\``);
  }
  const guidRaw = findProp(logic, 'mapguid')?.values ?? [];
  const guid = guidRaw.map((v) => Number.parseInt(v, 10));
  if (guid.length !== 16 || guid.some((b) => Number.isNaN(b) || b < 0 || b > 255)) {
    throw new Error(`ini: map ${src.file} has no valid 16-byte \`mapguid\``);
  }

  const mapType = sections.find((s) => s.name === 'misc_maptype');
  const mapName = sections.find((s) => s.name === 'misc_mapname');
  const info: {
    id: string;
    width: number;
    height: number;
    guid: number[];
    mapType?: number;
    campaign?: { campaignId: number; missionId: number };
    nameStringId?: number;
    descriptionStringId?: number;
    source: { file: string; block: string; layer: 'base' | 'mod' };
    provenance: MapProvenance;
  } = {
    provenance,
    id,
    width,
    height,
    guid,
    source: makeSource(src, 'logiccontrol'),
  };
  const type = mapType !== undefined ? getInt(mapType, 'maptype') : undefined;
  if (type !== undefined) info.mapType = type;
  const campaign = mapType !== undefined ? findProp(mapType, 'mapcampaignid')?.values : undefined;
  if (campaign !== undefined) {
    const campaignId = Number.parseInt(campaign[0] ?? '', 10);
    const missionId = Number.parseInt(campaign[1] ?? '', 10);
    if (!Number.isNaN(campaignId) && !Number.isNaN(missionId)) info.campaign = { campaignId, missionId };
  }
  const nameStringId = mapName !== undefined ? getInt(mapName, 'mapnamestringid') : undefined;
  if (nameStringId !== undefined) info.nameStringId = nameStringId;
  const descriptionStringId = mapName !== undefined ? getInt(mapName, 'mapdescriptionstringid') : undefined;
  if (descriptionStringId !== undefined) info.descriptionStringId = descriptionStringId;

  return MapInfo.parse(info);
}
