import { z } from 'zod';
import { HypertextBlock } from '../gui/hypertext.js';
import { MAP_TEXT_LANGUAGES, type MapTextLanguage } from './strings.js';

/**
 * A map's `maps/<id>.briefing.json` sidecar: the mission-window pages its `PlayCutscene <id>` results
 * name, rendered from `text/<lang>/briefings/`, keyed by language (`pol`, `eng`, `ger`, `rus`) then by cutscene id.
 */
export const MapBriefing = z.strictObject({
  texts: z.record(z.string(), z.record(z.string(), z.array(HypertextBlock))),
});
export type MapBriefing = z.infer<typeof MapBriefing>;

/** `<onscreencallback:2000,a,_>` speaks the map's `sfx/<lang>/<a as 4 digits>.wav` (readable `.hlt`
 *  pages and the shipped per-map `sfx/` folders). */
export const BRIEFING_VOICE_CALLBACK = 2000;
const VOICE_FILE_DIGITS = 4;

/** One spoken line a briefing names: the page language's `sfx/<lang>/` folder and the clip number. */
export interface BriefingVoice {
  readonly lang: MapTextLanguage;
  readonly id: number;
}

/** The clip's file name inside `sfx/<lang>/`, `%4.4d.wav`. */
export function briefingVoiceFile(id: number): string {
  return `${String(id).padStart(VOICE_FILE_DIGITS, '0')}.wav`;
}

/** The suffix a converted map stores the clip under, after its map id: `.voice-<lang>-NNNN.wav`. */
export function briefingVoiceSuffix({ lang, id }: BriefingVoice): string {
  return `.voice-${lang}-${briefingVoiceFile(id)}`;
}

export const BRIEFING_VOICE_SUFFIX = new RegExp(
  `^\\.voice-(${MAP_TEXT_LANGUAGES.join('|')})-\\d{${VOICE_FILE_DIGITS},}\\.wav$`,
);

const isMapTextLanguage = (lang: string): lang is MapTextLanguage =>
  (MAP_TEXT_LANGUAGES as readonly string[]).includes(lang);

/** The languages whose narration the listed voice `suffixes` carry, in `MAP_TEXT_LANGUAGES` order. */
export function narratedLanguages(suffixes: readonly string[] | undefined): MapTextLanguage[] {
  const spoken = new Set(suffixes?.map((suffix) => BRIEFING_VOICE_SUFFIX.exec(suffix)?.[1]));
  return MAP_TEXT_LANGUAGES.filter((lang) => spoken.has(lang));
}

/** The clip a callback speaks in `lang`, or null for another callback kind or language. */
export function callbackVoice(
  lang: string | null,
  [kind, id]: readonly [number, number, number],
): BriefingVoice | null {
  if (kind !== BRIEFING_VOICE_CALLBACK || id < 0 || lang === null || !isMapTextLanguage(lang)) return null;
  return { lang, id };
}

/** Every clip the briefing's pages speak, once each, by language then page order. */
export function briefingVoices(briefing: MapBriefing): BriefingVoice[] {
  const voices = new Map<string, BriefingVoice>();
  for (const [lang, pages] of Object.entries(briefing.texts)) {
    for (const blocks of Object.values(pages)) {
      for (const block of blocks) {
        const voice = block.kind === 'callback' ? callbackVoice(lang, block.args) : null;
        if (voice !== null) voices.set(briefingVoiceSuffix(voice), voice);
      }
    }
  }
  return [...voices.values()];
}
