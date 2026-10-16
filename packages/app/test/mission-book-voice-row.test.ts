import type { BriefingVoice } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import type { BookPage } from '../src/hud/dom/mission-book/page-segments.js';
import {
  type BriefingVoicePlayer,
  chapterVoice,
  clockText,
  voiceRowView,
} from '../src/hud/dom/mission-book/voice-row.js';

/** The briefing page's narration player: shown only for a page whose voice the map ships, and showing
 *  the line of its own clip. */

const VOICE: BriefingVoice = { lang: 'pol', id: 1 };

function page(...callbacks: BookPage['callbacks']): BookPage {
  return { title: null, segments: [], callbacks };
}

function player(shipped: readonly number[]): BriefingVoicePlayer {
  return {
    has: (voice) => shipped.includes(voice.id),
    play: () => undefined,
    stop: () => undefined,
    toggle: () => undefined,
    seek: () => undefined,
    state: () => ({ voice: null, status: 'idle', positionS: 0, durationS: 0 }),
  };
}

describe('chapterVoice', () => {
  it('gives a page`s shipped voice clip, and none for a page without one', () => {
    const voiced = page({ before: 0, args: [1000, 5, 6] }, { before: 1, args: [2000, 1, 0] });
    expect(chapterVoice(voiced, 'pol', player([1]))).toEqual(VOICE);
    expect(chapterVoice(page({ before: 0, args: [1000, 5, 6] }), 'pol', player([1]))).toBeNull();
    expect(chapterVoice(page(), 'pol', player([1]))).toBeNull();
  });

  it('shows no player for a clip the map does not ship, a page in no map language or a silent book', () => {
    const voiced = page({ before: 0, args: [2000, 1, 0] });
    expect(chapterVoice(voiced, 'pol', player([2]))).toBeNull();
    expect(chapterVoice(voiced, null, player([1]))).toBeNull();
    expect(chapterVoice(voiced, 'pol', null)).toBeNull();
  });
});

describe('voiceRowView', () => {
  it('follows its own clip`s line, and reads another clip`s or a page-turn`s stop as not started', () => {
    expect(voiceRowView({ voice: VOICE, status: 'playing', positionS: 3, durationS: 12 }, VOICE)).toEqual({
      playing: true,
      positionS: 3,
      durationS: 12,
      at: 0.25,
    });
    expect(
      voiceRowView({ voice: VOICE, status: 'paused', positionS: 6, durationS: 12 }, VOICE),
    ).toMatchObject({
      playing: false,
      at: 0.5,
    });
    expect(
      voiceRowView({ voice: VOICE, status: 'waiting', positionS: 0, durationS: 0 }, VOICE),
    ).toMatchObject({
      playing: true,
      at: 0,
    });
    const other = { voice: { lang: 'pol', id: 2 }, status: 'playing', positionS: 5, durationS: 9 } as const;
    expect(voiceRowView(other, VOICE)).toEqual({ playing: false, positionS: 0, durationS: 0, at: 0 });
    expect(voiceRowView({ voice: null, status: 'idle', positionS: 0, durationS: 0 }, VOICE).playing).toBe(
      false,
    );
  });

  it('writes the time as m:ss, an unknown length as dashes', () => {
    expect(clockText(0)).toBe('0:00');
    expect(clockText(61.79)).toBe('1:01');
    expect(clockText(null)).toBe('–:––');
  });
});
