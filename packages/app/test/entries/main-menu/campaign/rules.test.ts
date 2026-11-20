import { describe, expect, it } from 'vitest';
import { campaignMissionQuery } from '../../../../src/campaign/launch.js';
import {
  CAMPAIGN_ORE_YIELD,
  readCampaignRules,
  rememberCampaignRules,
} from '../../../../src/entries/main-menu/campaign/rules.js';
import { type LobbyOptions, lobbyRules } from '../../../../src/entries/main-menu/lobby/model.js';
import { memoryStorage } from '../../../support/campaign.js';

describe('the campaign rules', () => {
  it('start with doubled ore deposits and the authored stock of everything else', () => {
    const rules = readCampaignRules(memoryStorage());
    expect([rules.basicYield, rules.oreYield, rules.peace]).toEqual([null, CAMPAIGN_ORE_YIELD, null]);
    expect(readCampaignRules(undefined).oreYield).toBe(CAMPAIGN_ORE_YIELD);
  });

  it("keep the viewer's choice, the authored ore stock included, for the next visit", () => {
    const storage = memoryStorage();
    const chosen: LobbyOptions = {
      ...readCampaignRules(storage),
      oreYield: null,
      basicYield: 3,
      settlerNeeds: false,
    };
    rememberCampaignRules(storage, chosen);
    expect(lobbyRules(readCampaignRules(storage))).toEqual(lobbyRules(chosen));
  });

  it('launch a mission under them', () => {
    const query = campaignMissionQuery({
      mapId: 'asgard-campaign_01_01',
      language: 'pol',
      rules: lobbyRules(readCampaignRules(undefined)),
    });
    expect(new URLSearchParams(query).get('oreyield')).toBe(String(CAMPAIGN_ORE_YIELD));
    expect(new URLSearchParams(query).has('basicyield')).toBe(false);
  });
});
