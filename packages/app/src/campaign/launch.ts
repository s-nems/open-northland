import {
  CIVILIZATION_TRIBES,
  type MapTextLanguage,
  RECOMMENDED_CIVILIZATION_TRIBE,
} from '@open-northland/data';
import { HUMAN_TRIBE_PARAM } from '../view/params.js';

/** The civilizations a mission launch offers the person, the lobby's own tribe picker list. */
export const CAMPAIGN_TRIBES = CIVILIZATION_TRIBES;
export const RECOMMENDED_CAMPAIGN_TRIBE = RECOMMENDED_CIVILIZATION_TRIBE;

export interface CampaignMissionLaunch {
  readonly mapId: string;
  readonly language: MapTextLanguage;
  /** The civilization of the person's seat; the map's own when omitted. Map AIs keep theirs. */
  readonly tribe?: number;
}

/** The entry search that starts a campaign mission; the menu layers carried settings over it. */
export function campaignMissionQuery({ mapId, language, tribe }: CampaignMissionLaunch): string {
  const params = new URLSearchParams({ map: mapId, missions: 'on', lang: language });
  if (tribe !== undefined) params.set(HUMAN_TRIBE_PARAM, String(tribe));
  return `?${params}`;
}
