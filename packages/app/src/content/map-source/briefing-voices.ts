import { NARRATION_IDLE, type NarrationState, type SoundDriver } from '@open-northland/audio';
import type { BriefingVoice } from '@open-northland/data';
import { diag } from '../../diag/log.js';
import { mapFilePath, voiceFileSuffix } from './files.js';
import { findMapSource, type MapSource } from './sources.js';

/** A map's briefing clips: which it ships, and each one's wav bytes, or null when it ships none. */
export interface BriefingVoiceLoader {
  has(voice: BriefingVoice): boolean;
  load(voice: BriefingVoice): Promise<Uint8Array | null>;
}

/** Where a narration line plays: the sound driver's narration transport. */
export type NarrationSink = Pick<
  SoundDriver,
  'narrate' | 'pauseNarration' | 'resumeNarration' | 'seekNarration' | 'stopNarration' | 'narrationState'
>;

const SILENT: BriefingVoiceLoader = { has: () => false, load: async () => null };

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
  return {
    has: (voice) => listed.has(voiceFileSuffix(voice)),
    load(voice) {
      const suffix = voiceFileSuffix(voice);
      if (!listed.has(suffix)) return Promise.resolve(null);
      let clip = clips.get(suffix);
      if (clip === undefined) {
        clip = loadClip(mapFilePath(mapId, suffix), files);
        clips.set(suffix, clip);
      }
      return clip;
    },
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

const sameVoice = (a: BriefingVoice, b: BriefingVoice): boolean => a.lang === b.lang && a.id === b.id;

/** Speaks one clip at a time into `sink`: a clip that loads after a later play or a stop stays silent. */
export function briefingVoicePlayer(voices: BriefingVoiceLoader, sink: NarrationSink) {
  let turn = 0;
  /** The clip the player stands on; its bytes once loaded. */
  let current: { readonly voice: BriefingVoice; wav: Uint8Array | null } | null = null;

  const start = (voice: BriefingVoice): void => {
    const mine = ++turn;
    const line: { readonly voice: BriefingVoice; wav: Uint8Array | null } = { voice, wav: null };
    current = line;
    sink.stopNarration();
    void voices
      .load(voice)
      .then((wav) => {
        if (mine !== turn) return;
        if (wav === null) {
          current = null;
          return;
        }
        line.wav = wav;
        sink.narrate(wav);
      })
      .catch((error: unknown) => diag.warn('content', 'briefing voice unplayable', { error: String(error) }));
  };

  return {
    has: (voice: BriefingVoice): boolean => voices.has(voice),
    play: start,
    stop(): void {
      turn++;
      current = null;
      sink.stopNarration();
    },
    toggle(voice: BriefingVoice): void {
      if (current === null || !sameVoice(current.voice, voice)) {
        start(voice);
        return;
      }
      if (current.wav === null) return;
      const { status } = sink.narrationState();
      if (status === 'playing' || status === 'waiting') sink.pauseNarration();
      else if (status === 'idle') sink.narrate(current.wav);
      else sink.resumeNarration();
    },
    seek(voice: BriefingVoice, atS: number): void {
      if (current !== null && sameVoice(current.voice, voice) && current.wav !== null)
        sink.seekNarration(atS);
    },
    state(): NarrationState & { readonly voice: BriefingVoice | null } {
      if (current === null) return { voice: null, ...NARRATION_IDLE };
      if (current.wav === null)
        return { voice: current.voice, status: 'waiting', positionS: 0, durationS: 0 };
      return { voice: current.voice, ...sink.narrationState() };
    },
  };
}
