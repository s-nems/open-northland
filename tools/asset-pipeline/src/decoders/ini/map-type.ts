/**
 * `[misc_maptype]` reducer: the `maptype` codes and the `mapmultiplayeronly` flag that decide which
 * menus list a map, and the `mapcampaignid` pair a sub-mission is found by. Codes from the owned
 * copy's `Data/GameSourceIncludes/logicdefines.inc`.
 */
import { MAP_TYPE, MAP_TYPE_LIMIT, type MapMeta } from '@open-northland/data';
import type { RuleSection } from './grammar.js';
import { codeOf } from './props.js';

/** `CLEAN_MAP_TYPE_*` macros; keys are upper-cased because the corpus spells macros in mixed case. */
const MAP_TYPE_CODES: Readonly<Record<string, number>> = Object.fromEntries(
  Object.entries(MAP_TYPE).map(([name, code]) => [`CLEAN_MAP_TYPE_${name}`, code]),
);

export interface MapTypeHeader {
  /** Distinct valid codes in file order; empty when every line is malformed. */
  readonly types: readonly number[];
  readonly multiplayerOnly: boolean;
  readonly campaign?: MapMeta['campaign'];
}

/** The `mapcampaignid <campaign> <mission>` pair, or undefined when absent or malformed. */
function campaignOf(section: RuleSection): MapMeta['campaign'] {
  const values = section.props.find((p) => p.key === 'mapcampaignid')?.values;
  if (values?.length !== 2) return undefined;
  const campaignId = Number(values[0]);
  const missionId = Number(values[1]);
  return Number.isSafeInteger(campaignId) && Number.isSafeInteger(missionId)
    ? { campaignId, missionId }
    : undefined;
}

/**
 * The `[misc_maptype]` listing header, or undefined without the section. Accepts the plaintext macro
 * skin and the packed `map.cif` skin carrying the code already resolved; like the original, a code
 * outside 1..6 is skipped rather than failing the map.
 */
export function extractMapTypes(sections: readonly RuleSection[]): MapTypeHeader | undefined {
  const section = sections.find((s) => s.name === 'misc_maptype');
  if (section === undefined) return undefined;
  const types: number[] = [];
  for (const prop of section.props) {
    if (prop.key !== 'maptype') continue;
    const code = codeOf(prop.values[0], MAP_TYPE_CODES);
    if (code === undefined || code < 1 || code >= MAP_TYPE_LIMIT || types.includes(code)) continue;
    types.push(code);
  }
  const campaign = campaignOf(section);
  return {
    types,
    multiplayerOnly: section.props.some((p) => p.key === 'mapmultiplayeronly'),
    ...(campaign === undefined ? {} : { campaign }),
  };
}
