import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { decodeSegmentAudiopath, decodeSegmentTiming, musicTimeToSeconds } from '../../decoders/sgt.js';
import { errorMessage } from '../../errors.js';
import type { StageItemReporter } from '../../progress.js';
import { findPathCaseInsensitive, type SourceRoots } from '../../roots.js';
import { interpretSegment } from './interpret.js';
import { eventsThroughEnd, foldLoopTail } from './loop.js';
import { encodeOgg } from './ogg-encode.js';
import { applyWavesReverb } from './reverb.js';
import { type DlsBank, loadDlsBanks, synthesizeEvents } from './synthesize.js';

/**
 * Music stage: render the `DataX/DM2` DirectMusic segments to looping ogg tracks - one `mtLength`
 * pass per segment, with the loop-back point in the manifest (loop semantics: `decoders/sgt.ts`).
 * The performance interpreter turns each segment into timed note/controller events; spessasynth
 * synthesizes them from the game's DLS banks. The authored Waves Reverb from each segment's
 * embedded audiopath applies to the whole mix.
 * Deviation: the audiopath's 22050 Hz port rate is a synth-port request, not an output format, and
 * is not applied - most DLS samples are 44.1 kHz, and a recording of the original carries unbroken
 * content past 11 kHz, so publishing at the synth rate keeps a band that halving would discard.
 * `Theme_Viking_Hostile` alone authors `repeats: 1`; looping it like its 63 infinite siblings is an
 * approximation. Without `DataX/DM2` in the game copy the stage is skipped and the app plays no
 * music.
 */

/** Synth render parameters: 44.1 kHz stereo, encoder quality ~mid VBR. */
const SAMPLE_RATE = 44100;
const CHANNELS = 2;
const VBR_QUALITY = 3;
/** Headroom for the reverb's wet sum; uniform so relative track loudness survives. */
const MASTER_GAIN = 10 ** (-3 / 20);
/**
 * Bump when this stage's own synthesis or post-processing (event replay, reverb, publish rate,
 * master gain) changes rendered bytes: source mtimes cannot see code changes, so a stored manifest
 * with another version marks every ogg stale.
 */
const RENDER_VERSION = 9;
/** Synthesized headroom over the loop length, in whole seconds. Folded back over the loop region
 *  ({@link foldLoopTail}) before the encode trims it. */
const RENDER_TAIL_S = 1;

export const MUSIC_DIR = 'music';
export const MUSIC_MANIFEST_NAME = 'manifest.json';

interface ManifestTrack {
  readonly file: string;
  readonly loopStartS?: number;
}

export interface MusicStageResult {
  /** Segments rendered this run. */
  readonly rendered: number;
  /** Segments whose up-to-date ogg was kept. */
  readonly kept: number;
  /** Segments that failed to decode or render (logged individually). */
  readonly failed: number;
  /** Why the stage did nothing, when it was skipped entirely. */
  readonly skipped?: string;
}

/** The ogg is current only if it is newer than every render input (segment and banks). */
async function isUpToDate(outPath: string, sourcePath: string, inputsMtimeMs: number): Promise<boolean> {
  try {
    const [out, source] = await Promise.all([stat(outPath), stat(sourcePath)]);
    return out.mtimeMs > source.mtimeMs && out.mtimeMs > inputsMtimeMs;
  } catch {
    return false;
  }
}

/** The render version the stored manifest carries, or 0 when there is none to trust. */
async function storedRenderVersion(musicDir: string): Promise<number> {
  try {
    const parsed: unknown = JSON.parse(await readFile(join(musicDir, MUSIC_MANIFEST_NAME), 'utf8'));
    if (typeof parsed === 'object' && parsed !== null && 'renderVersion' in parsed) {
      const version = (parsed as { renderVersion: unknown }).renderVersion;
      if (typeof version === 'number') return version;
    }
  } catch {
    // No readable manifest: every ogg is stale.
  }
  return 0;
}

/** Latest mtime of the shared render inputs: the DLS banks. */
async function sharedInputsMtimeMs(dm2: string): Promise<number> {
  let latest = 0;
  for (const entry of await readdir(dm2)) {
    if (!entry.toLowerCase().endsWith('.dls')) continue;
    const { mtimeMs } = await stat(join(dm2, entry));
    if (mtimeMs > latest) latest = mtimeMs;
  }
  return latest;
}

/**
 * Render every `*.sgt` under the owned copy's `DataX/DM2` into `<outDir>/music/<stem>.ogg` plus the
 * track manifest. Incremental: a segment whose ogg is newer than its source is kept. A segment that
 * fails leaves the others alone.
 */
export async function renderMusicStage(
  roots: SourceRoots,
  outDir: string,
  onItem?: StageItemReporter,
): Promise<MusicStageResult> {
  const dm2 = await findPathCaseInsensitive(roots.game, ['DataX', 'DM2']);
  if (dm2 === undefined) return { rendered: 0, kept: 0, failed: 0, skipped: 'no DataX/DM2 in the game copy' };
  const segments = (await readdir(dm2)).filter((f) => f.toLowerCase().endsWith('.sgt')).sort();
  if (segments.length === 0) return { rendered: 0, kept: 0, failed: 0, skipped: 'no segments in DataX/DM2' };

  const musicDir = join(outDir, MUSIC_DIR);
  await mkdir(musicDir, { recursive: true });
  const inputsMtimeMs = await sharedInputsMtimeMs(dm2);
  const sameRenderVersion = (await storedRenderVersion(musicDir)) === RENDER_VERSION;

  const manifest = new Map<string, ManifestTrack>();
  let banksPromise: Promise<Map<string, DlsBank>> | undefined;
  let rendered = 0;
  let kept = 0;
  let failed = 0;
  let processed = 0;

  const renderOne = async (segment: string): Promise<void> => {
    onItem?.(processed++, segments.length);
    const stem = segment.replace(/\.sgt$/i, '').toLowerCase();
    const file = `${stem}.ogg`;
    const sourcePath = join(dm2, segment);
    const outPath = join(musicDir, file);
    try {
      const segmentBytes = await readFile(sourcePath);
      const timing = decodeSegmentTiming(segmentBytes);
      if (timing === undefined) throw new Error('no segh header');
      const loopStartS = musicTimeToSeconds(timing.loopStartTicks, timing.tempos);
      const totalS = musicTimeToSeconds(timing.lengthTicks, timing.tempos);
      manifest.set(stem, loopStartS > 0 ? { file, loopStartS } : { file });
      if (sameRenderVersion && (await isUpToDate(outPath, sourcePath, inputsMtimeMs))) {
        kept++;
        return;
      }
      const renderS = Math.ceil(totalS) + RENDER_TAIL_S;
      const events = interpretSegment(segmentBytes, {
        sampleRate: SAMPLE_RATE,
        audioChannels: CHANNELS,
        renderSeconds: renderS,
      });
      if (banksPromise === undefined) banksPromise = loadDlsBanks(dm2);
      const banks = await banksPromise;
      const endFrame = Math.round(totalS * SAMPLE_RATE);
      const synthesized = await synthesizeEvents(
        { ...events, events: eventsThroughEnd(events.events, endFrame) },
        banks,
        SAMPLE_RATE,
        renderS * SAMPLE_RATE,
      );
      const audiopath = decodeSegmentAudiopath(segmentBytes);
      if (audiopath?.reverb !== undefined) {
        applyWavesReverb(synthesized, SAMPLE_RATE, audiopath.reverb);
      }
      for (const channel of synthesized) {
        for (let i = 0; i < channel.length; i++) channel[i] = (channel[i] ?? 0) * MASTER_GAIN;
      }
      foldLoopTail(synthesized, endFrame, Math.round(loopStartS * SAMPLE_RATE));
      const frames = Math.min(endFrame, synthesized[0]?.length ?? 0);
      await writeFile(outPath, await encodeOgg(synthesized, frames, SAMPLE_RATE, VBR_QUALITY));
      rendered++;
    } catch (err) {
      manifest.delete(stem);
      failed++;
      console.warn(`[pipeline] music: ${segment} failed: ${errorMessage(err)}`);
    }
  };

  // Interpretation, synthesis, and encoding are all main-thread CPU work; render sequentially.
  for (const segment of segments) {
    await renderOne(segment);
  }

  const tracks = Object.fromEntries([...manifest.entries()].sort(([a], [b]) => a.localeCompare(b)));
  await writeFile(
    join(musicDir, MUSIC_MANIFEST_NAME),
    `${JSON.stringify({ renderVersion: RENDER_VERSION, tracks }, null, 2)}\n`,
  );
  return { rendered, kept, failed };
}
