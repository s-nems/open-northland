import {
  briefingVoiceFile,
  briefingVoiceSuffix,
  briefingVoices,
  type MapBriefing,
} from '@open-northland/data';
import { isWav } from '@open-northland/formats/wav';
import type { MapFolder } from './folder.js';
import { VOICE_DIR } from './layout.js';

/** The clips the briefing's pages speak that the folder ships under `sfx/<lang>/`, by stored suffix.
 *  A clip the folder lacks is left out: its callback stays silent. */
export function resolveBriefingVoices(folder: MapFolder, briefing: MapBriefing): Map<string, Uint8Array> {
  const voices = new Map<string, Uint8Array>();
  for (const voice of briefingVoices(briefing)) {
    const file = briefingVoiceFile(voice.id);
    const bytes = folder.read([VOICE_DIR, voice.lang, file]);
    if (bytes === undefined) continue;
    if (isWav(bytes)) voices.set(briefingVoiceSuffix(voice), bytes);
    else folder.warn(`${VOICE_DIR}/${voice.lang}/${file} is not a wav`);
  }
  return voices;
}
