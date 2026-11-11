import { describe, expect, it } from 'vitest';
import { activeCue, movieSubtitles, parseSrt, subtitleTracks } from '../../src/campaign/subtitles.js';

const SAMPLE = `1
00:00:01,000 --> 00:00:03,500
First line.

2
00:00:04,000 --> 00:00:06,000
Second line, with a comma.

3
00:00:07.250 --> 00:00:08.000
Dot millis.
`;

describe('parseSrt', () => {
  it('reads cues with their timeline and keeps source line breaks', () => {
    const cues = parseSrt(SAMPLE);
    expect(cues).toEqual([
      { start: 1, end: 3.5, text: 'First line.' },
      { start: 4, end: 6, text: 'Second line, with a comma.' },
      { start: 7.25, end: 8, text: 'Dot millis.' },
    ]);
  });

  it('skips a leading index line and empty blocks', () => {
    const cues = parseSrt(`\n\n1\n00:00:00,000 --> 00:00:01,000\nOnly.\n\n`);
    expect(cues).toEqual([{ start: 0, end: 1, text: 'Only.' }]);
  });

  it('drops malformed blocks without a timecode or text', () => {
    expect(parseSrt('00:00:00,000 --> 00:00:01,000\n')).toEqual([]);
    expect(parseSrt('just text\nwith no timecode\n')).toEqual([]);
  });
});

describe('activeCue', () => {
  const cues = parseSrt(SAMPLE);

  it('returns the cue spanning the time, and nothing before or after', () => {
    expect(activeCue(cues, 0)).toBeUndefined();
    expect(activeCue(cues, 2)).toEqual({ start: 1, end: 3.5, text: 'First line.' });
    expect(activeCue(cues, 3.5)).toBeUndefined();
    expect(activeCue(cues, 9)).toBeUndefined();
  });

  it('finds the last-starting cue on overlap', () => {
    const overlapping = [
      { start: 0, end: 10, text: 'wide' },
      { start: 5, end: 6, text: 'narrow' },
    ];
    expect(activeCue(overlapping, 5.5)).toEqual({ start: 5, end: 6, text: 'narrow' });
  });
});

describe('subtitleTracks', () => {
  const urls = {
    eng: '/campaigns/x/films/eng/intro.srt',
    chs: '/campaigns/x/films/chs/intro.srt',
  };

  it('lists requested languages in preference order', () => {
    expect(subtitleTracks(urls, ['eng', 'chs'])).toEqual([
      { language: 'eng', url: urls.eng },
      { language: 'chs', url: urls.chs },
    ]);
  });

  it('deduplicates repeated languages', () => {
    expect(subtitleTracks(urls, ['eng', 'eng'])).toEqual([{ language: 'eng', url: urls.eng }]);
  });

  it('drops a language the film carries no subtitle for', () => {
    expect(subtitleTracks({ eng: urls.eng }, ['eng', 'chs'])).toEqual([{ language: 'eng', url: urls.eng }]);
    expect(subtitleTracks(urls, ['ger', 'chs'])).toEqual([{ language: 'chs', url: urls.chs }]);
  });

  it('skips an unknown language and an absent subtitle map', () => {
    expect(subtitleTracks(urls, [undefined, 'chs'])).toEqual([{ language: 'chs', url: urls.chs }]);
    expect(subtitleTracks(undefined, ['eng', 'chs'])).toEqual([]);
  });
});

describe('subtitle defaults', () => {
  const urls = { eng: '/en.srt', pol: '/pl.srt', ger: '/de.srt', rus: '/ru.srt', chs: '/zh.srt' };
  it.each([
    ['eng', 'eng', false],
    ['rus', 'rus', true],
    ['cht', 'chs', true],
  ] as const)('defaults %s to %s with visibility %s', (ui, selected, visible) => {
    const result = movieSubtitles(urls, ui);
    expect(result.visible).toBe(visible);
    expect(result.tracks[0]?.language).toBe(selected);
  });
  it('shows Italian subtitles only where a film has them, since only unnarrated films do', () => {
    const subtitled = movieSubtitles({ ...urls, ita: '/it.srt' }, 'ita');
    expect(subtitled.visible).toBe(true);
    expect(subtitled.tracks[0]?.language).toBe('ita');
    expect(movieSubtitles(urls, 'ita').visible).toBe(false);
  });
  it('falls back to English if the preferred subtitles are missing', () => {
    expect(movieSubtitles({ eng: '/en.srt', pol: '/pl.srt' }, 'cht').tracks[0]?.language).toBe('eng');
  });
});
