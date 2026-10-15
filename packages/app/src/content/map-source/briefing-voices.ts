import type { BriefingVoice } from '@open-northland/data';
import { diag } from '../../diag/log.js';
import { mapFilePath, voiceFileSuffix } from './files.js';
import { findMapSource, type MapSource } from './sources.js';

/** One briefing clip's wav bytes, or null when the map ships none. */
export type BriefingVoiceLoader = (voice: BriefingVoice) => Promise<Uint8Array | null>;

/** Where a narration line plays: the sound driver. */
export interface NarrationSink {
  narrate(wav: Uint8Array): void;
  stopNarration(): void;
}

const SILENT: BriefingVoiceLoader = async () => null;

/** `mapId`'s briefing voices: only the clips its listing declares, so a map that ships none asks for
 *  nothing. A map awaiting a rebuild or download has none. */
export async function mapBriefingVoices(
  mapId: string | null,
  find: (mapId: string) => Promise<MapSource | null> = findMapSource,
): Promise<BriefingVoiceLoader> {
  if (mapId === null) return SILENT;
  const source = await find(mapId);
  if (source === null || source.stale) return SILENT;
  return declaredVoices(source.entry.id, source.entry.voices ?? [], source.fetch);
}

/** Loads the `declared` clips through `files`, each at most once per world. */
function declaredVoices(
  mapId: string,
  declared: readonly string[],
  files: typeof fetch,
): BriefingVoiceLoader {
  const listed = new Set(declared);
  const clips = new Map<string, Promise<Uint8Array | null>>();
  return (voice) => {
    const suffix = voiceFileSuffix(voice);
    if (!listed.has(suffix)) return Promise.resolve(null);
    let clip = clips.get(suffix);
    if (clip === undefined) {
      clip = loadClip(mapFilePath(mapId, suffix), files);
      clips.set(suffix, clip);
    }
    return clip;
  };
}

async function loadClip(path: string, files: typeof fetch): Promise<Uint8Array | null> {
  try {
    const response = await files(path);
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
