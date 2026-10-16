import { describe, expect, it } from 'vitest';
import {
  BRIEFING_VOICE_SUFFIX,
  briefingVoiceFile,
  briefingVoiceSuffix,
  briefingVoices,
  callbackVoice,
  type HypertextBlock,
  type MapBriefing,
  narratedLanguages,
} from '../src/index.js';

describe('briefing voices', () => {
  it('maps a 2000 callback in a map text language to its sfx clip, and nothing else', () => {
    expect(callbackVoice('pol', [2000, 15, 0])).toEqual({ lang: 'pol', id: 15 });
    expect(callbackVoice('pol', [1000, 15, 0])).toBeNull();
    expect(callbackVoice('pol', [2000, -1, 0])).toBeNull();
    expect(callbackVoice('fra', [2000, 15, 0])).toBeNull();
    expect(callbackVoice(null, [2000, 15, 0])).toBeNull();
  });

  it('names the clip %4.4d.wav and stores it under a suffix the store accepts', () => {
    expect(briefingVoiceFile(1)).toBe('0001.wav');
    expect(briefingVoiceFile(12345)).toBe('12345.wav');
    const suffix = briefingVoiceSuffix({ lang: 'eng', id: 16 });
    expect(suffix).toBe('.voice-eng-0016.wav');
    expect(BRIEFING_VOICE_SUFFIX.test(suffix)).toBe(true);
    expect(BRIEFING_VOICE_SUFFIX.test('.voice-eng-16.wav')).toBe(false);
  });

  it('lists every spoken clip once, per language', () => {
    const say = (id: number): HypertextBlock => ({ kind: 'callback', args: [2000, id, 0] });
    const briefing: MapBriefing = {
      texts: { pol: { '0': [say(1)], '9': [say(2), say(1)] }, eng: { '0': [say(1)] } },
    };
    expect(briefingVoices(briefing)).toEqual([
      { lang: 'pol', id: 1 },
      { lang: 'pol', id: 2 },
      { lang: 'eng', id: 1 },
    ]);
  });

  it('reads the narrated languages off the listed suffixes, in map text language order', () => {
    expect(narratedLanguages(undefined)).toEqual([]);
    expect(narratedLanguages([])).toEqual([]);
    expect(narratedLanguages(['.voice-pol-0001.wav', '.voice-pol-0002.wav'])).toEqual(['pol']);
    expect(
      narratedLanguages([
        '.voice-rus-0001.wav',
        '.voice-eng-0001.wav',
        '.voice-pol-0001.wav',
        '.voice-ger-0003.wav',
      ]),
    ).toEqual(['pol', 'eng', 'ger', 'rus']);
    expect(narratedLanguages(['.voice-fra-0001.wav', '.png'])).toEqual([]);
  });
});
