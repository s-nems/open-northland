import { Campaign } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { RECOMMENDED_CAMPAIGN_TRIBE } from '../src/campaign/launch.js';
import {
  campaignFilms,
  initialCampaign,
  launchTribe,
  readChosenCampaign,
  readRevealedRoutes,
  rememberChosenCampaign,
  rememberRevealedRoute,
  routeToReveal,
  unlockedStages,
} from '../src/entries/main-menu/campaign/model.js';
import { NOT_ON_ROUTE, routeOrder } from '../src/entries/main-menu/campaign/route-order.js';
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
    expect(unlockedStages(campaign, { unlocked: ['second'], completed: false })).toEqual([
      { stage: campaign.stages[1], number: 2 },
    ]);
    expect(
      unlockedStages(campaign, { unlocked: ['first', 'second'], completed: false }).map(
        ({ number }) => number,
      ),
    ).toEqual([1, 2]);
  });

  it('draws the route into the newest stage once per viewer', () => {
    const campaign = withRoute();
    const storage = memoryStorage();
    const stages = unlockedStages(campaign, { unlocked: ['first', 'second'], completed: false });
    expect(routeToReveal(stages, readRevealedRoutes(storage, campaign))).toBe('second');
    rememberRevealedRoute(storage, campaign, 'second');
    expect(routeToReveal(stages, readRevealedRoutes(storage, campaign))).toBeUndefined();
  });

  it('has nothing to draw for a stage without a route', () => {
    const campaign = campaignFixture();
    expect(
      routeToReveal(unlockedStages(campaign, { unlocked: ['first', 'second'], completed: false }), []),
    ).toBeUndefined();
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

describe('campaign screen films', () => {
  const INTRO = { url: '/campaigns/test/pol/intro.webm', width: 640, height: 480 };
  const FINALE = { url: '/campaigns/test/pol/video-0.webm', width: 640, height: 480, sequence: 0 };
  const withFilms = (): Campaign => {
    const campaign = campaignFixture();
    return Campaign.parse({
      ...campaign,
      movies: { ...campaign.movies, pol: { intro: INTRO, videos: [FINALE] } },
    });
  };

  it('offers the intro whenever there is one, the finale only once completed', () => {
    const campaign = withFilms();
    expect(campaignFilms(campaign, 'pol', { unlocked: ['first'], completed: false })).toEqual({
      intro: INTRO,
      finale: undefined,
    });
    expect(campaignFilms(campaign, 'pol', { unlocked: ['first'], completed: true })).toEqual({
      intro: INTRO,
      finale: FINALE,
    });
  });

  it('offers nothing where the language has no films', () => {
    expect(campaignFilms(campaignFixture(), 'eng', { unlocked: ['first'], completed: true })).toEqual({
      intro: undefined,
      finale: undefined,
    });
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

describe('campaign route drawing order', () => {
  // A dotted hook: right along the top row, down the right edge, then back left along the bottom,
  // so its far end lies right under its start.
  const SIZE = 12;
  const STEP = 3;
  const hook: { x: number; y: number }[] = [];
  for (let x = 0; x <= 9; x += STEP) hook.push({ x, y: 0 });
  for (let y = STEP; y <= 9; y += STEP) hook.push({ x: 9, y });
  for (let x = 9 - STEP; x >= 0; x -= STEP) hook.push({ x, y: 9 });
  const rgba = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (const { x, y } of hook) rgba[(y * SIZE + x) * 4 + 3] = 255;
  const order = routeOrder({ width: SIZE, height: SIZE, rgba }, { x: 0, y: 0 });
  const at = ({ x, y }: { x: number; y: number }): number => order[y * SIZE + x] ?? NOT_ON_ROUTE;

  it('walks the dots from the start, even where the route bends back past it', () => {
    const places = hook.map(at);
    expect(places[0]).toBe(0);
    expect(places.at(-1)).toBe(1);
    for (const [index, place] of places.entries())
      if (index > 0) expect(place).toBeGreaterThan(places[index - 1] ?? 0);
  });

  it('leaves transparent pixels off the route', () => {
    expect(at({ x: 1, y: 1 })).toBe(NOT_ON_ROUTE);
  });
});
