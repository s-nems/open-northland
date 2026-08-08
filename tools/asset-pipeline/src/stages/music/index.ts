import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createOggEncoder } from 'wasm-media-encoders';
import { decodeSegmentTiming, musicTimeToSeconds } from '../../decoders/sgt.js';
import { errorMessage } from '../../errors.js';
import type { StageItemReporter } from '../../progress.js';
import { findPathCaseInsensitive, type SourceRoots } from '../../roots.js';
import { decodePcm16Wav } from './wav.js';

/**
 * Music stage: render the `DataX/DM2` DirectMusic segments to looping ogg tracks. Each segment's
 * intro plays once and its `[mtLoopStart, mtLength]` region loops (the `segh` evidence: play start
 * 0, infinite repeats), so the emitted file is exactly one `mtLength` pass and the manifest carries
 * the loop-back point in seconds. Rendering needs the locally built dmrender binary
 * (`scripts/build-dmrender.sh`); without it, or without `DataX/DM2`, the stage is skipped and the
 * app plays no music.
 */

const execFileAsync = promisify(execFile);

/** Rendered track parameters: 44.1 kHz stereo, encoder quality ~mid VBR. */
const SAMPLE_RATE = 44100;
const CHANNELS = 2;
const VBR_QUALITY = 3;
/** Rendered wav headroom over the loop length; trimmed away at encode. dmrender takes whole seconds. */
const RENDER_TAIL_S = 1;
/** Concurrent dmrender processes; renders are CPU-bound and independent. */
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

async function isUpToDate(outPath: string, sourcePath: string): Promise<boolean> {
  try {
    const [out, source] = await Promise.all([stat(outPath), stat(sourcePath)]);
    return out.mtimeMs > source.mtimeMs;
  } catch {
    return false;
  }
}

/** Interleave planar float channels, trim to `frames`, encode to ogg/vorbis bytes. */
async function encodeOgg(channels: readonly Float32Array[], frames: number): Promise<Uint8Array> {
  const encoder = await createOggEncoder();
  encoder.configure({ channels: CHANNELS, sampleRate: SAMPLE_RATE, vbrQuality: VBR_QUALITY });
  const parts: Uint8Array[] = [];
  // Encode in bounded slices so the wasm side never sees the whole track at once.
  const SLICE_FRAMES = 1 << 20;
  for (let start = 0; start < frames; start += SLICE_FRAMES) {
    const end = Math.min(frames, start + SLICE_FRAMES);
    const slice = channels.map((c) => c.subarray(start, end)) as [Float32Array, Float32Array];
    parts.push(encoder.encode(slice));
  }
  parts.push(encoder.finalize());
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
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
    return {
      rendered: 0,
      kept: 0,
      failed: 0,
      skipped: 'dmrender not built (tools/asset-pipeline/scripts/build-dmrender.sh)',
    };
  }
  const segments = (await readdir(dm2)).filter((f) => f.toLowerCase().endsWith('.sgt')).sort();
  if (segments.length === 0) return { rendered: 0, kept: 0, failed: 0, skipped: 'no segments in DataX/DM2' };

  const musicDir = join(outDir, MUSIC_DIR);
  await mkdir(musicDir, { recursive: true });
  // dmrender resolves the segments' DLS references against its working directory.
  const workDir = await mkdtemp(join(tmpdir(), 'dmrender-'));
  for (const entry of await readdir(dm2)) {
    await symlink(join(dm2, entry), join(workDir, entry));
  }

  const manifest = new Map<string, ManifestTrack>();
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
      const timing = decodeSegmentTiming(await readFile(sourcePath));
      if (timing === undefined) throw new Error('no segh header');
      const loopStartS = musicTimeToSeconds(timing.loopStartTicks, timing.tempos);
      const totalS = musicTimeToSeconds(timing.lengthTicks, timing.tempos);
      manifest.set(stem, loopStartS > 0 ? { file, loopStartS } : { file });
      if (await isUpToDate(outPath, sourcePath)) {
        kept++;
        return;
      }
      const wavPath = join(workDir, `${stem}.wav`);
      await execFileAsync(
        dmrender,
        [
          '-l',
          String(Math.ceil(totalS) + RENDER_TAIL_S),
          '-s',
          String(SAMPLE_RATE),
          '-c',
          String(CHANNELS),
          segment,
          wavPath,
        ],
        { cwd: workDir, timeout: RENDER_TIMEOUT_MS, maxBuffer: 1 << 20 },
      );
      const wav = decodePcm16Wav(await readFile(wavPath));
      await rm(wavPath, { force: true });
      if (wav.sampleRate !== SAMPLE_RATE || wav.channels.length !== CHANNELS) {
        throw new Error(`unexpected render format ${wav.sampleRate}Hz/${wav.channels.length}ch`);
      }
      const frames = Math.min(Math.round(totalS * SAMPLE_RATE), wav.channels[0]?.length ?? 0);
      await writeFile(outPath, await encodeOgg(wav.channels, frames));
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
  await writeFile(join(musicDir, MUSIC_MANIFEST_NAME), `${JSON.stringify({ tracks }, null, 2)}\n`);
  return { rendered, kept, failed };
}
