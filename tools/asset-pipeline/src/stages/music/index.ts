import { FNV_OFFSET_BASIS, fnvHex, fnvMixWord } from '@open-northland/data';
import { type ReadableVfs, readText, type Vfs, vjoin } from '@open-northland/vfs';
import { decodeSegmentAudiopath, decodeSegmentTiming, musicTimeToSeconds } from '../../decoders/sgt.js';
import { errorMessage } from '../../errors.js';
import type { StageItemReporter } from '../../progress.js';
import { findPathCaseInsensitive, type SourceRoots } from '../../roots.js';
import { writeJsonFile } from '../content-tree.js';
import { interpretSegment } from './interpret.js';
import { encodeOgg } from './ogg-encode.js';
import { applyWavesReverb } from './reverb.js';
import { type DlsBank, dlsFileNames, loadDlsBanks, synthesizeEvents } from './synthesize.js';

/**
 * Music stage: render the `DataX/DM2` DirectMusic segments to one ogg track each, a single
 * `mtLength` pass. The performance interpreter turns each segment into timed note/controller events;
 * spessasynth synthesizes them from the game's DLS banks. The authored Waves Reverb from each
 * segment's embedded audiopath applies to the whole mix.
 * Deviation: the audiopath's 22050 Hz port rate is a synth-port request, not an output format, and
 * is not applied - most DLS samples are 44.1 kHz, and a recording of the original carries unbroken
 * content past 11 kHz, so publishing at the synth rate keeps a band that halving would discard.
 * Approximation: the original repeats a segment's authored loop region without a break, which a
 * rendered file cannot join cleanly; playback parts whole passes with a fade and a gap instead, so
 * the segment's loop point is not published. Without `DataX/DM2` in the game copy the stage is
 * skipped and the app plays no music.
 */

/** Synth render parameters: 44.1 kHz stereo, encoder quality ~mid VBR. */
const SAMPLE_RATE = 44100;
const CHANNELS = 2;
const VBR_QUALITY = 3;
/** Headroom for the reverb's wet sum; uniform so relative track loudness survives. */
const MASTER_GAIN = 10 ** (-3 / 20);
/**
 * Bump when this stage's own synthesis or post-processing (event replay, reverb, publish rate,
 * master gain) changes rendered bytes: the source fingerprint cannot see a code change, so a stored
 * manifest with another version marks every ogg stale.
 */
const RENDER_VERSION = 13;
/** Synthesized headroom over the segment length, in whole seconds; trimmed away at encode. */
const RENDER_TAIL_S = 1;

export const MUSIC_DIR = 'music';
export const MUSIC_MANIFEST_NAME = 'manifest.json';

interface ManifestTrack {
  readonly file: string;
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

/**
 * What the stored oggs were rendered from: this stage's render version and the byte sizes of every
 * segment and bank under `DataX/DM2`. The Vfs seam exposes no mtime, so a swapped game copy is
 * recognised by input size rather than by time.
 */
interface RenderIdentity {
  readonly renderVersion: number;
  readonly sources: string;
}

/** FNV-1a over the input sizes, so the manifest carries one short token instead of a file list. */
async function sourcesFingerprint(fs: ReadableVfs, dm2: string, files: readonly string[]): Promise<string> {
  let hash = FNV_OFFSET_BASIS;
  for (const file of files) {
    const size = (await fs.stat(vjoin(dm2, file)))?.size ?? 0;
    const text = `${file.toLowerCase()}:${size};`;
    for (let i = 0; i < text.length; i++) hash = fnvMixWord(hash, text.charCodeAt(i));
  }
  return fnvHex(hash);
}

/** The identity the stored manifest carries, or a blank one when there is none to trust. */
async function storedIdentity(fs: ReadableVfs, musicDir: string): Promise<RenderIdentity> {
  try {
    const parsed: unknown = JSON.parse(await readText(fs, vjoin(musicDir, MUSIC_MANIFEST_NAME)));
    if (typeof parsed === 'object' && parsed !== null) {
      const { renderVersion, sources } = parsed as Record<string, unknown>;
      if (typeof renderVersion === 'number' && typeof sources === 'string') {
        return { renderVersion, sources };
      }
    }
  } catch {
    // No readable manifest: every ogg is stale.
  }
  return { renderVersion: 0, sources: '' };
}

/**
 * Render every `*.sgt` under the owned copy's `DataX/DM2` into `<outDir>/music/<stem>.ogg` plus the
 * track manifest. Incremental: oggs rendered from the same inputs by the same version are kept. A
 * segment that fails leaves the others alone.
 */
export async function renderMusicStage(
  fs: Vfs,
  roots: SourceRoots,
  outDir: string,
  onItem?: StageItemReporter,
): Promise<MusicStageResult> {
  const dm2 = await findPathCaseInsensitive(fs, roots.game, ['DataX', 'DM2']);
  if (dm2 === undefined) return { rendered: 0, kept: 0, failed: 0, skipped: 'no DataX/DM2 in the game copy' };
  const entries = await fs.readdir(dm2);
  const segments = entries
    .filter((entry) => entry.kind === 'file' && entry.name.toLowerCase().endsWith('.sgt'))
    .map((entry) => entry.name)
    .sort();
  if (segments.length === 0) return { rendered: 0, kept: 0, failed: 0, skipped: 'no segments in DataX/DM2' };

  const musicDir = vjoin(outDir, MUSIC_DIR);
  await fs.mkdir(musicDir);
  const sources = await sourcesFingerprint(fs, dm2, [...segments, ...(await dlsFileNames(fs, dm2))]);
  const stored = await storedIdentity(fs, musicDir);
  const sameInputs = stored.renderVersion === RENDER_VERSION && stored.sources === sources;

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
    const outPath = vjoin(musicDir, file);
    try {
      const segmentBytes = await fs.readFile(vjoin(dm2, segment));
      const timing = decodeSegmentTiming(segmentBytes);
      if (timing === undefined) throw new Error('no segh header');
      const totalS = musicTimeToSeconds(timing.lengthTicks, timing.tempos);
      manifest.set(stem, { file });
      if (sameInputs && (await fs.stat(outPath))?.kind === 'file') {
        kept++;
        return;
      }
      const renderS = Math.ceil(totalS) + RENDER_TAIL_S;
      const events = interpretSegment(segmentBytes, {
        sampleRate: SAMPLE_RATE,
        audioChannels: CHANNELS,
        renderSeconds: renderS,
      });
      if (banksPromise === undefined) banksPromise = loadDlsBanks(fs, dm2);
      const banks = await banksPromise;
      const synthesized = await synthesizeEvents(events, banks, SAMPLE_RATE, renderS * SAMPLE_RATE);
      const audiopath = decodeSegmentAudiopath(segmentBytes);
      if (audiopath?.reverb !== undefined) {
        applyWavesReverb(synthesized, SAMPLE_RATE, audiopath.reverb);
      }
      for (const channel of synthesized) {
        for (let i = 0; i < channel.length; i++) channel[i] = (channel[i] ?? 0) * MASTER_GAIN;
      }
      const frames = Math.min(Math.round(totalS * SAMPLE_RATE), synthesized[0]?.length ?? 0);
      await fs.writeFile(outPath, await encodeOgg(synthesized, frames, SAMPLE_RATE, VBR_QUALITY));
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
  await writeJsonFile(fs, outDir, vjoin(MUSIC_DIR, MUSIC_MANIFEST_NAME), {
    renderVersion: RENDER_VERSION,
    sources,
    tracks,
  });
  return { rendered, kept, failed };
}
