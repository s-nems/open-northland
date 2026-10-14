import { defineComponent, type World } from '../ecs/world.js';
import { defineWorldSingleton } from '../ecs/world-singleton.js';

export interface CampaignMapUnlock {
  readonly campaignId: number;
  readonly mapId: number;
}

/** Durable script output. The host owns profile persistence and resolves ids within the map's pack. */
const campaign = defineWorldSingleton<{
  unlockedMaps: CampaignMapUnlock[];
  video: number | undefined;
}>('MissionCampaign', 'players', () => ({ unlockedMaps: [], video: undefined }));

export const MissionCampaign = campaign.component;

/** A repeated grant leaves state and its change stamp alone. */
export function unlockCampaignMap(world: World, campaignId: number, mapId: number): boolean {
  if (
    campaign
      .read(world)
      .unlockedMaps.some((entry) => entry.campaignId === campaignId && entry.mapId === mapId)
  )
    return false;
  campaign.write(world, (state) => {
    state.unlockedMaps.push({ campaignId, mapId });
  });
  return true;
}

export function requestCampaignVideo(world: World, sequence: number): void {
  if (campaign.read(world).video === sequence) return;
  campaign.write(world, (state) => {
    state.video = sequence;
  });
}

/** Original behavior: ten individually switchable landscape slots; unconfirmed on the running original. */
export const HOUSE_LANDSCAPE_OVERLAY_SLOTS = 10;

/** Explicit script overrides; an absent slot retains the content-defined initial state. */
export const HouseLandscapeOverlays = defineComponent<{
  slots: Map<number, boolean>;
}>('HouseLandscapeOverlays', 'economy');
