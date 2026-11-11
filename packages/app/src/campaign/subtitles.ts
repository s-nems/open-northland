import { LANGUAGES, type MapTextLanguage } from '@open-northland/data';

/** One subtitle line shown for its language; `text` may hold several source lines joined by newlines. */
export interface SubtitleCue {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/** A subtitle track the player fetches and renders, named by the language it displays. */
export interface SubtitleTrack {
  readonly language: MapTextLanguage;
  readonly url: string;
}

export interface MovieSubtitles {
  readonly tracks: readonly SubtitleTrack[];
  readonly visible: boolean;
}

/** Narrated UI languages start with captions off; Chinese and Russian start with captions on. Italian
 *  subtitles exist only for films without Italian narration, so an Italian track starts on. */
export function movieSubtitles(
  subtitles: Partial<Record<MapTextLanguage, string>> | undefined,
  uiLanguage: MapTextLanguage,
): MovieSubtitles {
  return {
    tracks: subtitleTracks(subtitles, [uiLanguage === 'cht' ? 'chs' : uiLanguage, 'eng', ...LANGUAGES]),
    visible:
      uiLanguage === 'rus' ||
      uiLanguage === 'chs' ||
      uiLanguage === 'cht' ||
      (uiLanguage === 'ita' && subtitles?.ita !== undefined),
  };
}

/** Available tracks in preference order, omitting missing and duplicate languages. */
export function subtitleTracks(
  subtitles: Partial<Record<MapTextLanguage, string>> | undefined,
  languages: readonly (MapTextLanguage | undefined)[],
): SubtitleTrack[] {
  const tracks: SubtitleTrack[] = [];
  for (const language of languages) {
    if (language === undefined) continue;
    const url = subtitles?.[language];
    if (url === undefined) continue;
    if (tracks.some((track) => track.language === language)) continue;
    tracks.push({ language, url });
  }
  return tracks;
}

function parseTime(code: string): number | undefined {
  const match = /^(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})$/.exec(code.trim());
  if (match === null) return undefined;
  const hours = Number(match[1] ?? '0');
  const minutes = Number(match[2] ?? '0');
  const seconds = Number(match[3] ?? '0');
  const millis = Number((match[4] ?? '0').padEnd(3, '0'));
  return hours * 3600 + minutes * 60 + seconds + millis / 1000;
}

/** Parses an SRT document into cues ordered by start; malformed blocks and stray lines are skipped. */
export function parseSrt(text: string): readonly SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    const lines = block.split(/\r?\n/).filter((line) => line.trim() !== '');
    if (lines.length === 0) continue;
    // An SRT block may open with a numeric index line we do not need.
    let body = 0;
    if (lines[0] !== undefined && /^\d+$/.test(lines[0].trim())) body = 1;
    const timeLine = lines[body];
    if (timeLine === undefined) continue;
    const arrow = timeLine.split('-->');
    const from = arrow[0];
    const to = arrow[1];
    if (from === undefined || to === undefined) continue;
    const start = parseTime(from);
    const end = parseTime(to);
    if (start === undefined || end === undefined) continue;
    const body2 = lines.slice(body + 1).join('\n');
    if (body2.trim() === '') continue;
    cues.push({ start, end, text: body2 });
  }
  cues.sort((a, b) => a.start - b.start);
  return cues;
}

/** The cue active at `time`, or undefined. `cues` must be start-sorted; overlaps resolve to the last start. */
export function activeCue(cues: readonly SubtitleCue[], time: number): SubtitleCue | undefined {
  let lo = 0;
  let hi = cues.length - 1;
  let at = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const cue = cues[mid];
    if (cue === undefined) break;
    if (cue.start <= time) {
      at = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  for (let i = at; i >= 0; i--) {
    const cue = cues[i];
    if (cue === undefined) break;
    if (cue.start > time) break;
    if (time < cue.end) return cue;
  }
  return undefined;
}
