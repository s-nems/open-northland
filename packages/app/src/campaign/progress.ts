import type { Campaign } from '@open-northland/data';

export interface CampaignProgress {
  readonly unlocked: readonly string[];
  /** The last stage was won or skipped past, which opens the finale for replay. */
  readonly completed: boolean;
}

type ProgressStorage = Pick<Storage, 'getItem' | 'setItem'>;
const PREFIX = 'open-northland:campaign:v2:';
const MAX_PROGRESS_BYTES = 65536;

/** One progress per campaign, whatever language or civilization its missions were played in. */
export function campaignProgressKey(campaign: Pick<Campaign, 'id'>): string {
  return `${PREFIX}${campaign.id}`;
}

/**
 * First stage is available even after storage loss. Malformed state cannot unlock arbitrary maps, and
 * anything but a literal `true` reads as not completed.
 */
export function readCampaignProgress(campaign: Campaign, storage: ProgressStorage): CampaignProgress {
  const initial = campaign.stages[0]?.mapId;
  const allowed = new Set(campaign.stages.map((stage) => stage.mapId));
  const unlocked = new Set(initial === undefined ? [] : [initial]);
  let completed = false;
  const raw = storage.getItem(campaignProgressKey(campaign));
  if (raw !== null && raw.length <= MAX_PROGRESS_BYTES) {
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      value = null;
    }
    if (value !== null && typeof value === 'object') {
      if ('unlocked' in value && Array.isArray(value.unlocked))
        for (const id of value.unlocked) if (typeof id === 'string' && allowed.has(id)) unlocked.add(id);
      completed = 'completed' in value && value.completed === true;
    }
  }
  return { unlocked: [...unlocked], completed };
}

function writeProgress(
  campaign: Campaign,
  progress: CampaignProgress,
  storage: ProgressStorage,
): CampaignProgress {
  storage.setItem(campaignProgressKey(campaign), JSON.stringify(progress));
  return progress;
}

/** The stage whose win completes the campaign: the last one in campaign order. */
export function isFinalCampaignStage(campaign: Campaign, mapId: string | undefined): boolean {
  return mapId !== undefined && campaign.stages.at(-1)?.mapId === mapId;
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
  return writeProgress(campaign, { unlocked: [...unlocked], completed: progress.completed }, storage);
}

/** Merges with the latest stored grants; storage failures reach the caller. */
export function completeCampaign(campaign: Campaign, storage: ProgressStorage): CampaignProgress {
  const progress = readCampaignProgress(campaign, storage);
  return writeProgress(campaign, { ...progress, completed: true }, storage);
}

/** Alpha recovery unlocks one next stage; it does not forge a mission outcome or alter a save. */
export function nextCampaignStage(campaign: Campaign, progress: CampaignProgress): string | undefined {
  return campaign.stages.find((stage) => !progress.unlocked.includes(stage.mapId))?.mapId;
}

/** Unlocks the next stage, or past the last one completes the campaign; a completed campaign has none. */
export function skipCampaignStage(campaign: Campaign, storage: ProgressStorage): CampaignProgress {
  const progress = readCampaignProgress(campaign, storage);
  const next = nextCampaignStage(campaign, progress);
  if (next === undefined) return progress.completed ? progress : completeCampaign(campaign, storage);
  const map = campaign.maps.find((map) => map.id === next);
  return grantCampaignMaps(
    campaign,
    map === undefined ? [] : [{ campaignId: campaign.campaignId, mapId: map.missionId }],
    storage,
  );
}

/** Whether the alpha recovery has anything left to do: a locked stage, or an unfinished last one. */
export function canSkipCampaignStage(campaign: Campaign, progress: CampaignProgress): boolean {
  return nextCampaignStage(campaign, progress) !== undefined || !progress.completed;
}
