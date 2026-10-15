import { Campaign } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { RECOMMENDED_CAMPAIGN_TRIBE } from '../src/campaign/launch.js';
import {
  initialCampaign,
  launchTribe,
  readChosenCampaign,
  readRevealedRoutes,
  rememberChosenCampaign,
  rememberRevealedRoute,
  routeToReveal,
  unlockedStages,
} from '../src/entries/main-menu/campaign/model.js';
import { campaignFixture, memoryStorage } from './support/campaign.js';

const ROUTE = { url: '/campaigns/test/route-2.png', x: 0.2, y: 0.3, width: 0.3, height: 0.3 };
const withRoute = (): Campaign => {
  const campaign = campaignFixture();
  return Campaign.parse({
    ...campaign,
    stages: campaign.stages.map((stage, index) => (index === 1 ? { ...stage, route: ROUTE } : stage)),
  });
};
const throwing: Pick<Storage, 'getItem' | 'setItem'> = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
};

describe('campaign screen stages', () => {
  it('lists only unlocked stages, numbered by their place in the campaign', () => {
    const campaign = campaignFixture();
    expect(unlockedStages(campaign, { unlocked: ['second'] })).toEqual([
      { stage: campaign.stages[1], number: 2 },
    ]);
    expect(unlockedStages(campaign, { unlocked: ['first', 'second'] }).map(({ number }) => number)).toEqual([
      1, 2,
    ]);
  });

  it('draws the route into the newest stage once per viewer', () => {
    const campaign = withRoute();
    const storage = memoryStorage();
    const stages = unlockedStages(campaign, { unlocked: ['first', 'second'] });
    expect(routeToReveal(stages, readRevealedRoutes(storage, campaign))).toBe('second');
    rememberRevealedRoute(storage, campaign, 'second');
    expect(routeToReveal(stages, readRevealedRoutes(storage, campaign))).toBeUndefined();
  });

  it('has nothing to draw for a stage without a route', () => {
    const campaign = campaignFixture();
    expect(routeToReveal(unlockedStages(campaign, { unlocked: ['first', 'second'] }), [])).toBeUndefined();
  });

  it('keeps only the campaign stages in the drawn-route record and survives bad storage', () => {
    const campaign = withRoute();
    const storage = memoryStorage();
    storage.setItem('open-northland.campaignScreen.routes.test', '["gone", 3]');
    rememberRevealedRoute(storage, campaign, 'second');
    expect(readRevealedRoutes(storage, campaign)).toEqual(['second']);
    storage.setItem('open-northland.campaignScreen.routes.test', '{broken');
    expect(readRevealedRoutes(storage, campaign)).toEqual([]);
    expect(readRevealedRoutes(throwing, campaign)).toEqual([]);
    expect(() => rememberRevealedRoute(throwing, campaign, 'second')).not.toThrow();
  });
});

describe('campaign screen choice', () => {
  const first = campaignFixture();
  const second = Campaign.parse({
    ...first,
    id: 'other',
    order: 1,
    maps: [{ id: 'other-1', missionId: 1 }],
    stages: [{ mapId: 'other-1', title: { eng: 'Other' }, x: 0.5, y: 0.5 }],
  });

  it('opens the URL campaign, else the remembered one, else the first', () => {
    expect(initialCampaign([first, second], 'other', 'test')).toBe(second);
    expect(initialCampaign([first, second], null, 'other')).toBe(second);
    expect(initialCampaign([first, second], 'missing', 'gone')).toBe(first);
    expect(initialCampaign([], null, null)).toBeUndefined();
  });

  it('remembers the chosen campaign where storage allows', () => {
    const storage = memoryStorage();
    rememberChosenCampaign(storage, 'other');
    expect(readChosenCampaign(storage)).toBe('other');
    expect(readChosenCampaign(throwing)).toBeNull();
    expect(() => rememberChosenCampaign(throwing, 'other')).not.toThrow();
  });

  it('passes a tribe to the launch only when it differs from the recommended one', () => {
    expect(launchTribe(RECOMMENDED_CAMPAIGN_TRIBE)).toBeUndefined();
    const other = RECOMMENDED_CAMPAIGN_TRIBE + 1;
    expect(launchTribe(other)).toBe(other);
  });
});
