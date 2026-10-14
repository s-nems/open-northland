import { type Campaign, CampaignIndex } from '@open-northland/data';
import { fetchJsonOrNull } from '../content/net.js';

export async function loadCampaigns(fetchImpl: typeof fetch = fetch): Promise<readonly Campaign[]> {
  const value = await fetchJsonOrNull<unknown>('/campaigns-index.json', fetchImpl);
  if (value === null) return [];
  return CampaignIndex.parse(value).campaigns;
}

export function campaignForMap(campaigns: readonly Campaign[], mapId: string): Campaign | undefined {
  return campaigns.find((campaign) => campaign.maps.some((map) => map.id === mapId));
}
