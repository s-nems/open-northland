import { type MapTextLanguage, RECOMMENDED_CIVILIZATION_TRIBE } from '@open-northland/data';
import type { SessionRules } from '@open-northland/lockstep';
import { writeSessionRuleParams } from '../game/match/session-url.js';
import { HUMAN_TRIBE_PARAM } from '../view/params.js';

export const RECOMMENDED_CAMPAIGN_TRIBE = RECOMMENDED_CIVILIZATION_TRIBE;

export interface CampaignMissionLaunch {
  readonly mapId: string;
  readonly language: MapTextLanguage;
  /** The civilization of the person's seat; the map's own when omitted. Map AIs keep theirs. */
  readonly tribe?: number;
  /** The rules the person chose for the campaign; the map's own where omitted. */
  readonly rules?: SessionRules;
}

/** The entry search that starts a campaign mission; the menu layers carried settings over it. */
export function campaignMissionQuery({ mapId, language, tribe, rules }: CampaignMissionLaunch): string {
  const params = new URLSearchParams({ map: mapId, missions: 'on', lang: language });
  if (tribe !== undefined) params.set(HUMAN_TRIBE_PARAM, String(tribe));
  if (rules !== undefined) writeSessionRuleParams(params, rules);
  return `?${params}`;
}
