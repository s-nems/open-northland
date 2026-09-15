import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { statIfExists } from '../src/files.js';
import { MUSIC_DIR, MUSIC_MANIFEST_NAME, renderMusicStage } from '../src/stages/music/index.js';
import { bandTrack, segment, sequenceTrack, tempoTrack } from './segment-fixture.js';
import { type GameOutTemp, makeGameOutTemp } from './support/game-tree.js';

/**
 * The stage's incremental identity: the manifest it writes has to be the thing that decides whether
 * the next run keeps or re-renders. That decision rides entirely on a stored fingerprint of the input
 * sizes, and nothing else exercises the write→read→keep round trip.
 */

const DM2 = join('DataX', 'DM2');

function shortSegment(padding = 0): Uint8Array {
  // The band matters: the interpreter's frame clock (and so the loop points) only advances while a
  // performance channel exists, exactly like every real segment's.
  const bytes = segment(1, 96, [
    tempoTrack([{ time: 0, bpm: 120 }]),
    bandTrack([{ time: 0, instruments: [{ patch: 0, pChannel: 1, pan: 63, volume: 127 }] }]),
    sequenceTrack([{ time: 0, duration: 24, pChannel: 1, status: 0x90, byte1: 60, byte2: 90 }]),
  ]);
  if (padding === 0) return bytes;
  // Trailing bytes sit past the RIFF chunk, so the decode is unchanged and only the file size moves.
  const padded = new Uint8Array(bytes.length + padding);
  padded.set(bytes);
  return padded;
}

describe('music stage incremental identity', () => {
  let temp: GameOutTemp;
  let roots: { readonly mod: string };
  let manifestPath: string;

  beforeEach(async () => {
    temp = await makeGameOutTemp('music');
    roots = { mod: temp.game };
    manifestPath = join(temp.out, MUSIC_DIR, MUSIC_MANIFEST_NAME);
  });

  afterEach(() => temp.cleanup());

  async function stageWith(bytes: Uint8Array): Promise<void> {
    await temp.write(join(DM2, 'one.sgt'), bytes);
  }

  async function storedManifest(): Promise<Record<string, unknown>> {
    return JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
  }

  it('keeps a track whose inputs and render version still match the stored manifest', async () => {
    await stageWith(shortSegment());
    const first = await renderMusicStage(roots, temp.out);
    expect(first.rendered).toBe(1);
    expect(first.kept).toBe(0);
    const row = (await storedManifest()).tracks as Record<string, Record<string, unknown>>;

    const second = await renderMusicStage(roots, temp.out);
    expect(second).toMatchObject({ rendered: 0, kept: 1, failed: 0 });
    // The kept path re-uses the stored row, loop points included.
    expect(((await storedManifest()).tracks as Record<string, unknown>).one).toEqual(row.one);
  });

  it('publishes the loop region from the interpreter’s own pass ends', async () => {
    // One 96-tick pass at 120 bpm: DMUS_PPQ 768 ticks/quarter → 0.0625 s per pass.
    await stageWith(shortSegment());
    await renderMusicStage(roots, temp.out);
    const one = ((await storedManifest()).tracks as Record<string, Record<string, unknown>>).one;
    expect(one).toBeDefined();
    const { loopStartS, loopEndS } = one as { loopStartS: number; loopEndS: number };
    expect(loopStartS).toBeCloseTo(0.0625, 3);
    expect(loopEndS).toBeCloseTo(0.125, 3);
    expect(loopEndS).toBeGreaterThan(loopStartS);
  });

  it('re-renders when an input changes size, which is all the identity can see', async () => {
    await stageWith(shortSegment());
    await renderMusicStage(roots, temp.out);
    const before = await storedManifest();

    await stageWith(shortSegment(16));
    const after = await renderMusicStage(roots, temp.out);
    expect(after).toMatchObject({ rendered: 1, kept: 0 });
    expect((await storedManifest()).sources).not.toEqual(before.sources);
  });

  it('re-renders when the stored manifest carries another render version', async () => {
    await stageWith(shortSegment());
    await renderMusicStage(roots, temp.out);
    const stored = await storedManifest();

    const stale = { ...stored, renderVersion: (stored.renderVersion as number) - 1 };
    await writeFile(manifestPath, JSON.stringify(stale));
    expect(await renderMusicStage(roots, temp.out)).toMatchObject({ rendered: 1, kept: 0 });
  });

  it('does not adopt an ogg left behind by a segment that failed this run', async () => {
    await stageWith(shortSegment());
    await renderMusicStage(roots, temp.out);
    const ogg = join(temp.out, MUSIC_DIR, 'one.ogg');
    expect(await statIfExists(ogg)).toBeDefined();

    // A header claiming an implausible length is rejected before it can size the render.
    const broken = shortSegment();
    new DataView(broken.buffer, broken.byteOffset).setInt32(findSeghLength(broken), 0x7fffffff, true);
    await stageWith(broken);
    expect(await renderMusicStage(roots, temp.out)).toMatchObject({ rendered: 0, failed: 1 });
    expect(await statIfExists(ogg)).toBeUndefined();
  });
});

/** Offset of `mtLength` inside the fixture's `segh` body (`dwRepeats` precedes it). */
function findSeghLength(bytes: Uint8Array): number {
  const text = new TextDecoder('latin1').decode(bytes);
  const at = text.indexOf('segh');
  if (at < 0) throw new Error('no segh in the fixture');
  return at + 8 + 4;
}
