import { Campaign, CampaignIndex } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { movieSize } from '../src/campaign/movie.js';
import {
  campaignProgressKey,
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
    expect(readCampaignProgress({ ...campaign, language: 'eng' }, storage).unlocked).toEqual(['first']);
    expect(readCampaignProgress({ ...campaign, id: 'other' }, storage).unlocked).toEqual(['first']);
  });
  it('recovers corrupt progress and unlocks the next stage once', () => {
    const campaign = campaignFixture();
    const storage = memoryStorage();
    storage.setItem(campaignProgressKey(campaign), '{broken');
    expect(skipCampaignStage(campaign, storage).unlocked).toEqual(['first', 'second']);
    expect(skipCampaignStage(campaign, storage).unlocked).toEqual(['first', 'second']);
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
      CampaignIndex.safeParse({ version: 1, campaigns: [campaign, { ...campaign, id: 'other' }] }).success,
    ).toBe(false);
    expect(
      Campaign.safeParse({ ...campaign, stages: [{ mapId: 'missing', title: 'Missing', x: 0, y: 0 }] })
        .success,
    ).toBe(false);
  });
});

describe('movie sizing', () => {
  it('keeps native size on modern screens', () =>
    expect(movieSize(640, 480, 1920, 1080)).toEqual({ width: 640, height: 480 }));
  it('fits smaller screens without changing aspect ratio', () =>
    expect(movieSize(640, 480, 320, 400)).toEqual({ width: 320, height: 240 }));
});
