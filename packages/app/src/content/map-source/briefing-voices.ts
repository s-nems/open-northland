import type { BriefingVoice } from '@open-northland/data';
import { diag } from '../../diag/log.js';
import { isMapId } from '../transfer/documents.js';
import { mapFilePath, voiceFileSuffix } from './files.js';
import { mapFetch } from './sources.js';

/** One briefing clip's wav bytes, or null when the map ships none. */
export type BriefingVoiceLoader = (voice: BriefingVoice) => Promise<Uint8Array | null>;

/** Where a narration line plays: the sound driver. */
export interface NarrationSink {
  narrate(wav: Uint8Array): void;
  stopNarration(): void;
}

/** Loads `mapId`'s briefing voices through the fetch that serves its files, installed maps included,
 *  each clip at most once per world. */
export function mapBriefingVoices(mapId: string | null, fetchFor = mapFetch): BriefingVoiceLoader {
  const clips = new Map<string, Promise<Uint8Array | null>>();
  return (voice) => {
    if (mapId === null || !isMapId(mapId)) return Promise.resolve(null);
    const suffix = voiceFileSuffix(voice);
    let clip = clips.get(suffix);
    if (clip === undefined) {
      clip = loadClip(mapId, mapFilePath(mapId, suffix), fetchFor);
      clips.set(suffix, clip);
    }
    return clip;
  };
}

async function loadClip(
  mapId: string,
  path: string,
  fetchFor: (mapId: string) => Promise<typeof fetch>,
): Promise<Uint8Array | null> {
  try {
    const response = await (await fetchFor(mapId))(path);
    return response.ok ? new Uint8Array(await response.arrayBuffer()) : null;
  } catch (error) {
    diag.warn('content', 'briefing voice unreadable', { path, error: String(error) });
    return null;
  }
}

/** Speaks one clip at a time into `sink`: a clip that loads after a later play or a stop stays silent. */
export function briefingVoicePlayer(load: BriefingVoiceLoader, sink: NarrationSink) {
  let turn = 0;
  return {
    play(voice: BriefingVoice): void {
      const mine = ++turn;
      sink.stopNarration();
      void load(voice)
        .then((wav) => {
          if (wav !== null && mine === turn) sink.narrate(wav);
        })
        .catch((error: unknown) =>
          diag.warn('content', 'briefing voice unplayable', { error: String(error) }),
        );
    },
    stop(): void {
      turn++;
      sink.stopNarration();
    },
  };
}
