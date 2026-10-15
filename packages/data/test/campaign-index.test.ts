import { describe, expect, it } from 'vitest';
import { Campaign, CampaignIndex } from '../src/index.js';

const campaign = {
  id: 'wonder',
  campaignId: 3,
  order: 2,
  title: { pol: 'Ósmy cud świata', eng: '8th Wonder of the World' },
  languages: ['pol'],
  maps: [
    { id: 'wonder-1', missionId: 10 },
    { id: 'wonder-1-sub', missionId: 11 },
  ],
  stages: [{ mapId: 'wonder-1', title: { pol: 'Początek' }, x: 0.2, y: 0.3 }],
  background: '/campaigns/wonder/map.png',
  logo: { pol: '/campaigns/wonder/logo-pol.png', eng: '/campaigns/wonder/logo-eng.png' },
  movies: {
    pol: {
      intro: {
        url: '/campaigns/wonder/video/intro.webm',
        audio: '/campaigns/wonder/pol/intro.webm',
        width: 640,
        height: 480,
      },
      videos: [
        {
          url: '/campaigns/wonder/video/video-1.webm',
          audio: '/campaigns/wonder/pol/video-1.webm',
          width: 640,
          height: 480,
          sequence: 1,
        },
      ],
    },
  },
};

describe('campaign index', () => {
  it('accepts one campaign per original game with per-language texts and films', () => {
    expect(CampaignIndex.parse({ version: 3, campaigns: [campaign] }).campaigns[0]?.languages).toEqual([
      'pol',
    ]);
  });
  it('rejects the previous format version', () => {
    expect(CampaignIndex.safeParse({ version: 2, campaigns: [campaign] }).success).toBe(false);
  });
  it('requires each film to name its language sound track beside the shared picture', () => {
    const picture = { url: '/campaigns/wonder/pol/intro.webm', width: 640, height: 480 };
    expect(Campaign.safeParse({ ...campaign, movies: { pol: { intro: picture, videos: [] } } }).success).toBe(
      false,
    );
    expect(
      Campaign.safeParse({
        ...campaign,
        movies: { pol: { intro: { ...picture, audio: '/elsewhere/intro.webm' }, videos: [] } },
      }).success,
    ).toBe(false);
  });
  it('rejects empty texts and logos, missing languages and unknown stages', () => {
    expect(Campaign.safeParse({ ...campaign, title: {} }).success).toBe(false);
    expect(Campaign.safeParse({ ...campaign, logo: {} }).success).toBe(false);
    expect(Campaign.safeParse({ ...campaign, logo: '/campaigns/wonder/logo.png' }).success).toBe(false);
    expect(Campaign.safeParse({ ...campaign, languages: [] }).success).toBe(false);
    expect(Campaign.safeParse({ ...campaign, languages: ['pol', 'pol'] }).success).toBe(false);
    expect(
      Campaign.safeParse({ ...campaign, stages: [{ mapId: 'missing', title: { eng: 'x' }, x: 0, y: 0 }] })
        .success,
    ).toBe(false);
  });
  it('rejects a repeated video sequence within one language', () => {
    const video = {
      url: '/campaigns/wonder/video/video-1.webm',
      audio: '/campaigns/wonder/pol/video-1.webm',
      width: 640,
      height: 480,
      sequence: 1,
    };
    expect(Campaign.safeParse({ ...campaign, movies: { pol: { videos: [video, video] } } }).success).toBe(
      false,
    );
  });
  it('keeps campaign ids, orders and map ownership unique across the index', () => {
    const saga = {
      ...campaign,
      id: 'saga',
      order: 3,
      maps: [{ id: 'saga-1', missionId: 1 }],
      stages: [{ mapId: 'saga-1', title: { eng: 'One' }, x: 0, y: 0 }],
    };
    expect(CampaignIndex.safeParse({ version: 3, campaigns: [campaign, saga] }).success).toBe(true);
    expect(
      CampaignIndex.safeParse({ version: 3, campaigns: [campaign, { ...saga, id: 'wonder' }] }).success,
    ).toBe(false);
    expect(
      CampaignIndex.safeParse({ version: 3, campaigns: [campaign, { ...saga, order: 2 }] }).success,
    ).toBe(false);
    expect(
      CampaignIndex.safeParse({
        version: 3,
        campaigns: [campaign, { ...saga, maps: [...saga.maps, campaign.maps[0]] }],
      }).success,
    ).toBe(false);
  });
});
