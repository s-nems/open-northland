import {
  HOUSE_LANDSCAPE_OVERLAY_SLOTS,
  HouseLandscapeOverlays,
  requestCampaignVideo,
  unlockCampaignMap,
} from '../../../components/index.js';
import type { MissionPass } from '../pass.js';
import { missionHouses } from '../targets.js';

export function allowCampaignMap(
  pass: MissionPass,
  mission: number,
  campaignId: number,
  mapId: number,
): void {
  if (campaignId < 0 || mapId < 0) {
    pass.reportFailed(mission, 'AllowMap');
    return;
  }
  if (unlockCampaignMap(pass.world, campaignId, mapId)) {
    pass.ctx.events.emit({ kind: 'missionCampaignUnlock', campaignId, mapId });
  }
}

export function playCampaignVideo(pass: MissionPass, mission: number, sequence: number): void {
  if (sequence < 0) {
    pass.reportFailed(mission, 'Mission quit and play video');
    return;
  }
  requestCampaignVideo(pass.world, sequence);
  pass.ctx.events.emit({ kind: 'missionVideo', sequence });
}

export function setHouseLandscapeOverlay(
  pass: MissionPass,
  objectId: number,
  slot: number,
  active: boolean,
): void {
  if (slot < 0 || slot >= HOUSE_LANDSCAPE_OVERLAY_SLOTS) return;
  for (const entity of missionHouses(pass.world, objectId)) {
    const previous = pass.world.tryGet(entity, HouseLandscapeOverlays);
    if (previous?.slots.get(slot) === active) continue;
    if (previous === undefined) {
      pass.world.add(entity, HouseLandscapeOverlays, { slots: new Map([[slot, active]]) });
    } else {
      pass.world.mut(entity, HouseLandscapeOverlays).slots.set(slot, active);
    }
  }
}
