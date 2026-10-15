import { describe, expect, it } from 'vitest';
import { CAMPAIGN_TRIBES, campaignMissionQuery, RECOMMENDED_CAMPAIGN_TRIBE } from '../src/campaign/launch.js';
import { campaignLanguage, campaignMovies, localizedText } from '../src/campaign/locale.js';
import { mapSession } from '../src/game/session-url.js';
import { campaignFixture } from './support/campaign.js';

describe('campaign language', () => {
  const campaign = campaignFixture();
  it('plays in the UI language, else English, else the first one the campaign has', () => {
    expect(campaignLanguage(campaign, 'pol')).toBe('pol');
    expect(campaignLanguage(campaign, 'ger')).toBe('eng');
    expect(campaignLanguage({ languages: ['rus', 'pol'] }, 'ger')).toBe('rus');
  });
  it('falls back the same way for texts and films', () => {
    expect(localizedText({ pol: 'Kampania', eng: 'Campaign' }, 'pol')).toBe('Kampania');
    expect(localizedText({ pol: 'Kampania', eng: 'Campaign' }, 'rus')).toBe('Campaign');
    expect(localizedText({ ger: 'Feldzug', pol: 'Kampania' }, 'rus')).toBe('Kampania');
    expect(campaignMovies(campaign, 'ger').videos[0]?.url).toBe('/campaigns/test/eng/video-1.webm');
    expect(campaignMovies({ movies: {} }, 'pol').videos).toEqual([]);
  });
});

describe('campaign mission launch', () => {
  it('names the map, missions, language and the chosen civilization', () => {
    expect(campaignMissionQuery({ mapId: 'wonder-1', language: 'pol' })).toBe(
      '?map=wonder-1&missions=on&lang=pol',
    );
    expect(campaignMissionQuery({ mapId: 'wonder-1', language: 'eng', tribe: 2 })).toBe(
      '?map=wonder-1&missions=on&lang=eng&tribe=2',
    );
  });
  it('offers the lobby civilizations with viking recommended', () => {
    expect(CAMPAIGN_TRIBES).toContain(RECOMMENDED_CAMPAIGN_TRIBE);
  });
  it('changes only the person seat, leaving the map AI its tribe', () => {
    const roster = [
      { player: 0, colorId: 0, tribeId: 1, type: 'human', claimable: true },
      { player: 1, colorId: 1, tribeId: 1, type: 'ai', claimable: false },
    ] as const;
    const session = mapSession(
      new URLSearchParams(campaignMissionQuery({ mapId: 'm', language: 'pol', tribe: 2 })),
      roster,
    );
    expect(session.seats.map((seat) => [seat.player, seat.mode, seat.tribe])).toEqual([
      [0, 'human', 2],
      [1, 'map-ai', undefined],
    ]);
  });
  it('lets an explicit seat pair win and ignores a non-civilization tribe', () => {
    const roster = [{ player: 0, colorId: 0, tribeId: 1, type: 'human', claimable: true }] as const;
    expect(mapSession(new URLSearchParams('map=m&tribe=2&tribes=0:3'), roster).seats[0]?.tribe).toBe(3);
    expect(mapSession(new URLSearchParams('map=m&tribe=5'), roster).seats[0]?.tribe).toBeUndefined();
  });
});
