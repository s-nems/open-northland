import type { Campaign } from '@open-northland/data';

export interface CampaignProgress {
  readonly unlocked: readonly string[];
}

type ProgressStorage = Pick<Storage, 'getItem' | 'setItem'>;
const PREFIX = 'open-northland:campaign:v2:';
const MAX_PROGRESS_BYTES = 65536;

/** One progress per campaign, whatever language or civilization its missions were played in. */
export function campaignProgressKey(campaign: Pick<Campaign, 'id'>): string {
  return `${PREFIX}${campaign.id}`;
}

/** First stage is available even after storage loss. Malformed state cannot unlock arbitrary maps. */
export function readCampaignProgress(campaign: Campaign, storage: ProgressStorage): CampaignProgress {
  const initial = campaign.stages[0]?.mapId;
  const allowed = new Set(campaign.stages.map((stage) => stage.mapId));
  const unlocked = new Set(initial === undefined ? [] : [initial]);
  const raw = storage.getItem(campaignProgressKey(campaign));
  if (raw !== null && raw.length <= MAX_PROGRESS_BYTES) {
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      value = null;
    }
    if (value !== null && typeof value === 'object' && 'unlocked' in value && Array.isArray(value.unlocked)) {
      for (const id of value.unlocked) if (typeof id === 'string' && allowed.has(id)) unlocked.add(id);
    }
  }
  return { unlocked: [...unlocked] };
}

/** Merge with the latest stored grants before writing. Storage failures reach the UI. */
export function grantCampaignMaps(
  campaign: Campaign,
  maps: readonly { readonly campaignId: number; readonly mapId: number }[],
  storage: ProgressStorage,
): CampaignProgress {
  const progress = readCampaignProgress(campaign, storage);
  const unlocked = new Set(progress.unlocked);
  for (const grant of maps) {
    if (grant.campaignId !== campaign.campaignId) continue;
    const map = campaign.maps.find((map) => map.missionId === grant.mapId);
    if (map !== undefined && campaign.stages.some((stage) => stage.mapId === map.id)) unlocked.add(map.id);
  }
  const next = { unlocked: [...unlocked] };
  storage.setItem(campaignProgressKey(campaign), JSON.stringify(next));
  return next;
}

/** Alpha recovery unlocks one next stage; it does not forge a mission outcome or alter a save. */
export function nextCampaignStage(campaign: Campaign, progress: CampaignProgress): string | undefined {
  return campaign.stages.find((stage) => !progress.unlocked.includes(stage.mapId))?.mapId;
}

export function skipCampaignStage(campaign: Campaign, storage: ProgressStorage): CampaignProgress {
  const next = nextCampaignStage(campaign, readCampaignProgress(campaign, storage));
  const map = campaign.maps.find((map) => map.id === next);
  return grantCampaignMaps(
    campaign,
    map === undefined ? [] : [{ campaignId: campaign.campaignId, mapId: map.missionId }],
    storage,
  );
}
