import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { decodeSegmentAudiopath, decodeSegmentTiming, musicTimeToSeconds } from '../../decoders/sgt.js';
import { errorMessage } from '../../errors.js';
import type { StageItemReporter } from '../../progress.js';
import { findPathCaseInsensitive, type SourceRoots } from '../../roots.js';
import { parseEventDump } from './events.js';
import { encodeOgg } from './ogg-encode.js';
import { decimateByTwo } from './resample.js';
import { applyWavesReverb } from './reverb.js';
import { type DlsBank, loadDlsBanks, synthesizeEvents } from './synthesize.js';

/**
 * Music stage: render the `DataX/DM2` DirectMusic segments to looping ogg tracks - one `mtLength`
 * pass per segment, with the loop-back point in the manifest (loop semantics: `decoders/sgt.ts`).
 * dmrender interprets the segment and dumps timed note/controller events (`-e`); spessasynth
 * synthesizes them from the game's DLS banks. Each segment's embedded audiopath then shapes the
 * render: the authored Waves Reverb applies to the whole mix and a 22050 Hz port rate halves the
 * published rate (the synth itself renders oversampled at 44.1 kHz).
 * `Theme_Viking_Hostile` alone authors `repeats: 1`; looping it like its 63 infinite siblings is an
 * approximation. Rendering needs the locally built dmrender binary (`scripts/build-dmrender.sh`);
 * without it, or without `DataX/DM2`, the stage is skipped and the app plays no music.
 */

const execFileAsync = promisify(execFile);

/** Synth render parameters: 44.1 kHz stereo, encoder quality ~mid VBR. */
const SAMPLE_RATE = 44100;
const CHANNELS = 2;
const VBR_QUALITY = 3;
/** Headroom for the reverb's wet sum; uniform so relative track loudness survives. */
const MASTER_GAIN = 10 ** (-3 / 20);
/**
 * Bump when this stage's own synthesis or post-processing (event replay, reverb, decimation,
 * master gain) changes rendered bytes: source mtimes cannot see code changes, so a stored manifest
 * with another version marks every ogg stale.
 */
const RENDER_VERSION = 4;
/** Synthesized headroom over the loop length; trimmed away at encode. dmrender takes whole seconds. */
const RENDER_TAIL_S = 1;
/** Concurrent renders; the event dumps overlap while synthesis serializes on the JS thread. */
const RENDER_POOL = 4;
/** One render must finish within this budget; a hung tool must not wedge the whole pipeline. */
const RENDER_TIMEOUT_MS = 10 * 60 * 1000;

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

/** The dmrender binary: an explicit override, or the build script's committed output path. */
function resolveDmrender(): string | undefined {
  const override = process.env.OPEN_NORTHLAND_DMRENDER;
  if (override !== undefined && override.length > 0) return existsSync(override) ? override : undefined;
  const vendored = fileURLToPath(new URL('../../../vendor/dmrender', import.meta.url));
  return existsSync(vendored) ? vendored : undefined;
}

/** The ogg is current only if it is newer than every render input (segment, banks, renderer). */
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

/** Latest mtime of the shared render inputs: the DLS banks and the dmrender binary itself. */
async function sharedInputsMtimeMs(dm2: string, dmrender: string): Promise<number> {
  let latest = (await stat(dmrender)).mtimeMs;
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
  const dmrender = resolveDmrender();
  if (dmrender === undefined) {
    const override = process.env.OPEN_NORTHLAND_DMRENDER;
    return {
      rendered: 0,
      kept: 0,
      failed: 0,
      skipped:
        override !== undefined && override.length > 0
          ? `OPEN_NORTHLAND_DMRENDER points at a missing file (${override})`
          : 'dmrender not built (tools/asset-pipeline/scripts/build-dmrender.sh)',
    };
  }
  const segments = (await readdir(dm2)).filter((f) => f.toLowerCase().endsWith('.sgt')).sort();
  if (segments.length === 0) return { rendered: 0, kept: 0, failed: 0, skipped: 'no segments in DataX/DM2' };

  const musicDir = join(outDir, MUSIC_DIR);
  await mkdir(musicDir, { recursive: true });
  const inputsMtimeMs = await sharedInputsMtimeMs(dm2, dmrender);
  const sameRenderVersion = (await storedRenderVersion(musicDir)) === RENDER_VERSION;
  // dmrender resolves the segments' DLS references against its working directory.
  const workDir = await mkdtemp(join(tmpdir(), 'dmrender-'));
  for (const entry of await readdir(dm2)) {
    await symlink(join(dm2, entry), join(workDir, entry));
  }

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
      const eventsPath = join(workDir, `${stem}.events.jsonl`);
      await execFileAsync(
        dmrender,
        ['-e', eventsPath, '-l', String(renderS), '-s', String(SAMPLE_RATE), '-c', String(CHANNELS), segment],
        { cwd: workDir, timeout: RENDER_TIMEOUT_MS, maxBuffer: 1 << 20 },
      );
      const events = parseEventDump(await readFile(eventsPath, 'utf8'));
      await rm(eventsPath, { force: true });
      if (banksPromise === undefined) banksPromise = loadDlsBanks(dm2);
      const banks = await banksPromise;
      const synthesized = await synthesizeEvents(events, banks, SAMPLE_RATE, renderS * SAMPLE_RATE);
      const audiopath = decodeSegmentAudiopath(segmentBytes);
      if (audiopath?.reverb !== undefined) {
        applyWavesReverb(synthesized, SAMPLE_RATE, audiopath.reverb);
      }
      let channels = synthesized;
      let outRate = SAMPLE_RATE;
      if (audiopath?.sampleRate !== undefined && audiopath.sampleRate * 2 === SAMPLE_RATE) {
        channels = channels.map(decimateByTwo);
        outRate = audiopath.sampleRate;
      } else if (audiopath?.sampleRate !== undefined && audiopath.sampleRate !== SAMPLE_RATE) {
        console.warn(
          `[pipeline] music: ${segment} authors a ${audiopath.sampleRate} Hz port; publishing at ${SAMPLE_RATE} Hz`,
        );
      }
      for (const channel of channels) {
        for (let i = 0; i < channel.length; i++) channel[i] = (channel[i] ?? 0) * MASTER_GAIN;
      }
      const frames = Math.min(Math.round(totalS * outRate), channels[0]?.length ?? 0);
      await writeFile(outPath, await encodeOgg(channels, frames, outRate, VBR_QUALITY));
      rendered++;
    } catch (err) {
      manifest.delete(stem);
      failed++;
      console.warn(`[pipeline] music: ${segment} failed: ${errorMessage(err)}`);
    }
  };

  try {
    const queue = [...segments];
    await Promise.all(
      Array.from({ length: Math.min(RENDER_POOL, queue.length) }, async () => {
        for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
          await renderOne(next);
        }
      }),
    );
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }

  const tracks = Object.fromEntries([...manifest.entries()].sort(([a], [b]) => a.localeCompare(b)));
  await writeFile(
    join(musicDir, MUSIC_MANIFEST_NAME),
    `${JSON.stringify({ renderVersion: RENDER_VERSION, tracks }, null, 2)}\n`,
  );
  return { rendered, kept, failed };
}
