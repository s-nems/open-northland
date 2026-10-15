import { Campaign, CampaignIndex } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { movieSize } from '../src/campaign/movie.js';
import {
  campaignProgressKey,
  canSkipCampaignStage,
  completeCampaign,
  grantCampaignMaps,
  readCampaignProgress,
  skipCampaignStage,
} from '../src/campaign/progress.js';
import { campaignFixture, memoryStorage } from './support/campaign.js';

describe('campaign progression', () => {
  it('starts at the authored first stage and persists only main-stage grants in this campaign', () => {
    const campaign = campaignFixture();
    const storage = memoryStorage();
    expect(readCampaignProgress(campaign, storage).unlocked).toEqual(['first']);
    grantCampaignMaps(
      campaign,
      [
        { campaignId: 9, mapId: 20 },
        { campaignId: 3, mapId: 11 },
      ],
      storage,
    );
    expect(readCampaignProgress(campaign, storage).unlocked).toEqual(['first']);
    grantCampaignMaps(
      campaign,
      [
        { campaignId: 3, mapId: 20 },
        { campaignId: 3, mapId: 20 },
      ],
      storage,
    );
    expect(readCampaignProgress(campaign, storage).unlocked).toEqual(['first', 'second']);
    expect(readCampaignProgress({ ...campaign, languages: ['eng'] }, storage).unlocked).toEqual([
      'first',
      'second',
    ]);
    expect(readCampaignProgress({ ...campaign, id: 'other' }, storage).unlocked).toEqual(['first']);
  });
  it('keys progress by campaign alone', () => {
    expect(campaignProgressKey(campaignFixture())).toBe('open-northland:campaign:v2:test');
  });
  it('recovers corrupt progress and unlocks the next stage once', () => {
    const campaign = campaignFixture();
    const storage = memoryStorage();
    storage.setItem(campaignProgressKey(campaign), '{broken');
    expect(skipCampaignStage(campaign, storage).unlocked).toEqual(['first', 'second']);
    expect(skipCampaignStage(campaign, storage).unlocked).toEqual(['first', 'second']);
  });
  it('completes the campaign once the skip passes the last stage, keeping its grants', () => {
    const campaign = campaignFixture();
    const storage = memoryStorage();
    expect(readCampaignProgress(campaign, storage).completed).toBe(false);
    skipCampaignStage(campaign, storage);
    const last = readCampaignProgress(campaign, storage);
    expect(last).toEqual({ unlocked: ['first', 'second'], completed: false });
    expect(canSkipCampaignStage(campaign, last)).toBe(true);
    const done = skipCampaignStage(campaign, storage);
    expect(done).toEqual({ unlocked: ['first', 'second'], completed: true });
    expect(readCampaignProgress(campaign, storage)).toEqual(done);
    expect(canSkipCampaignStage(campaign, done)).toBe(false);
    grantCampaignMaps(campaign, [{ campaignId: 3, mapId: 20 }], storage);
    expect(readCampaignProgress(campaign, storage).completed).toBe(true);
  });
  it('reads anything but a literal true as not completed', () => {
    const campaign = campaignFixture();
    const storage = memoryStorage();
    for (const completed of ['true', 1, null, {}]) {
      storage.setItem(campaignProgressKey(campaign), JSON.stringify({ unlocked: ['second'], completed }));
      expect(readCampaignProgress(campaign, storage)).toEqual({
        unlocked: ['first', 'second'],
        completed: false,
      });
    }
    storage.setItem(campaignProgressKey(campaign), JSON.stringify({ unlocked: 'gone', completed: true }));
    expect(readCampaignProgress(campaign, storage)).toEqual({ unlocked: ['first'], completed: true });
    expect(completeCampaign(campaign, memoryStorage())).toEqual({ unlocked: ['first'], completed: true });
  });
  it('surfaces write failures', () => {
    expect(() =>
      skipCampaignStage(campaignFixture(), {
        getItem: () => null,
        setItem: () => {
          throw new Error('quota');
        },
      }),
    ).toThrow('quota');
  });
  it('rejects ambiguous map ownership and invalid stage references', () => {
    const campaign = campaignFixture();
    expect(
      CampaignIndex.safeParse({ version: 3, campaigns: [campaign, { ...campaign, id: 'other', order: 1 }] })
        .success,
    ).toBe(false);
    expect(
      Campaign.safeParse({
        ...campaign,
        stages: [{ mapId: 'missing', title: { eng: 'Missing' }, x: 0, y: 0 }],
      }).success,
    ).toBe(false);
  });
});

describe('movie sizing', () => {
  it('keeps native size on modern screens', () =>
    expect(movieSize(640, 480, 1920, 1080)).toEqual({ width: 640, height: 480 }));
  it('fits smaller screens without changing aspect ratio', () =>
    expect(movieSize(640, 480, 320, 400)).toEqual({ width: 320, height: 240 }));
});
