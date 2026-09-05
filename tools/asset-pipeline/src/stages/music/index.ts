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
 * Music stage: render the `DataX/DM2` DirectMusic segments to one ogg track each. The performance
 * interpreter turns each segment into timed note/controller events; spessasynth synthesizes them
 * from the game's DLS banks. The authored Waves Reverb from each segment's embedded audiopath
 * applies to the whole mix (the engine creates the music audiopath from the segment's own config -
 * byte evidence: `the original` passes the loaded segment to the driver's create-audiopath slot;
 * deviation: it builds that path once, from the first segment played, where this render honours
 * each segment's own values).
 * The original plays a segment with infinite repeats and no break (byte evidence: the play call
 * passes repeat -1 into the driver's `an original routine`), so each track carries two
 * passes: the first opens from silence, the second starts under the first's decay tails, and the
 * published loop points ring-loop that second pass. Both points come from the interpreter's own
 * segment-end frames, so they cannot drift from the events.
 * Deviation: the audiopath's 22050 Hz port rate is a synth-port request, not an output format, and
 * is not applied - the owned install's `music_mode 3` initialises the synth at 44100 Hz, and most
 * DLS samples are 44.1 kHz. Without `DataX/DM2` in the game copy the stage is skipped and the app
 * plays no music.
 */

/** Synth render parameters: 44.1 kHz stereo, encoder quality ~mid VBR. */
const SAMPLE_RATE = 44100;
const CHANNELS = 2;
const VBR_QUALITY = 3;
/**
 * Brings the mix back inside full scale: 12 of the 64 segments peak above it once the reverb's wet
 * sum is added, and this scaling is what keeps them from clipping rather than a spare margin over
 * one. Uniform, so relative track loudness survives - the original applies no per-track gain
 * either (byte evidence: the engine's driver call surface carries only the master volume and the
 * jingle duck). The runtime music bus undoes this file headroom. Anything that raises levels here
 * lands on 0 dBFS.
 */
const MASTER_GAIN = 10 ** (-3 / 20);
/**
 * Bump when this stage's own synthesis or post-processing (event replay, reverb, publish rate,
 * master gain) changes rendered bytes: the source fingerprint cannot see a code change, so a stored
 * manifest with another version marks every ogg stale.
 */
const RENDER_VERSION = 15;
/** Synthesized headroom over the two rendered passes, in whole seconds; trimmed away at encode. */
const RENDER_TAIL_S = 1;
/**
 * Longest segment this stage will render. `mtLength` is four unvalidated bytes that size every buffer
 * downstream, so a corrupt or hostile header must be rejected here rather than allocating from it. The
 * owned corpus tops out near 128 s per pass.
 */
const MAX_SEGMENT_S = 300;

export const MUSIC_DIR = 'music';
export const MUSIC_MANIFEST_NAME = 'manifest.json';

interface ManifestTrack {
  readonly file: string;
  /** Seconds into the file the loop region opens (the first pass's end). */
  readonly loopStartS: number;
  /** Seconds into the file the loop region closes (the second pass's end, also the file's end). */
  readonly loopEndS: number;
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
 * recognised by input size rather than by time. A same-size edit therefore reads as unchanged, and
 * the synthesizer and encoder are pinned to exact versions in `package.json` because a caret bump
 * would change rendered bytes without changing anything this identity can see.
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

interface StoredManifest extends RenderIdentity {
  /** The stored per-track rows, re-used verbatim for a kept ogg (its loop points are not recomputed). */
  readonly tracks: ReadonlyMap<string, ManifestTrack>;
}

/** The identity and rows the stored manifest carries, or a blank one when there is none to trust. */
async function storedManifest(fs: ReadableVfs, musicDir: string): Promise<StoredManifest> {
  const tracks = new Map<string, ManifestTrack>();
  try {
    const parsed: unknown = JSON.parse(await readText(fs, vjoin(musicDir, MUSIC_MANIFEST_NAME)));
    if (typeof parsed === 'object' && parsed !== null) {
      const { renderVersion, sources, tracks: rows } = parsed as Record<string, unknown>;
      if (typeof rows === 'object' && rows !== null) {
        for (const [stem, row] of Object.entries(rows)) {
          const { file, loopStartS, loopEndS } = (row ?? {}) as Record<string, unknown>;
          if (typeof file === 'string' && typeof loopStartS === 'number' && typeof loopEndS === 'number') {
            tracks.set(stem, { file, loopStartS, loopEndS });
          }
        }
      }
      if (typeof renderVersion === 'number' && typeof sources === 'string') {
        return { renderVersion, sources, tracks };
      }
    }
  } catch {
    // No readable manifest: every ogg is stale.
  }
  return { renderVersion: 0, sources: '', tracks };
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
  const stored = await storedManifest(fs, musicDir);
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
      if (!(totalS > 0) || totalS > MAX_SEGMENT_S) {
        throw new Error(`segment length ${timing.lengthTicks} ticks is out of range`);
      }
      const storedTrack = stored.tracks.get(stem);
      if (sameInputs && storedTrack !== undefined && (await fs.stat(outPath))?.kind === 'file') {
        manifest.set(stem, storedTrack);
        kept++;
        return;
      }
      const renderS = Math.ceil(totalS * 2) + RENDER_TAIL_S;
      const events = interpretSegment(segmentBytes, {
        sampleRate: SAMPLE_RATE,
        audioChannels: CHANNELS,
        renderSeconds: renderS,
      });
      const [loopStartFrame, loopEndFrame] = events.segmentEndFrames;
      if (loopStartFrame === undefined || loopEndFrame === undefined) {
        throw new Error('the render window did not reach two segment ends');
      }
      // Equal ends mean the frame clock never ran: no band ever opened a performance channel.
      if (loopEndFrame <= loopStartFrame) throw new Error('the segment opened no performance channel');
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
      if (loopEndFrame > (synthesized[0]?.length ?? 0)) {
        throw new Error(`second segment end at frame ${loopEndFrame} lies past the synthesized buffer`);
      }
      manifest.set(stem, {
        file,
        loopStartS: loopStartFrame / SAMPLE_RATE,
        loopEndS: loopEndFrame / SAMPLE_RATE,
      });
      await fs.writeFile(outPath, await encodeOgg(synthesized, loopEndFrame, SAMPLE_RATE, VBR_QUALITY));
      rendered++;
    } catch (err) {
      manifest.delete(stem);
      // Drop any ogg an earlier version left here: the keep check tests existence, not provenance, so
      // a survivor would be adopted as this version's render on the next run.
      await fs.rm(outPath);
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
