import { memoryVfs } from '@open-northland/vfs/memory';
import { describe, expect, it } from 'vitest';
import { MUSIC_DIR, MUSIC_MANIFEST_NAME, renderMusicStage } from '../src/stages/music/index.js';
import { bandTrack, segment, sequenceTrack, tempoTrack } from './segment-fixture.js';

/**
 * The stage's incremental identity: the manifest it writes has to be the thing that decides whether
 * the next run keeps or re-renders. The Vfs seam exposes no mtime, so that decision rides entirely on
 * a stored fingerprint, and nothing else exercises the write→read→keep round trip.
 */

const OUT = '/out';
const DM2 = '/game/DataX/DM2';
const ROOTS = { mod: '/game' } as const;

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

async function stageWith(bytes: Uint8Array): Promise<ReturnType<typeof memoryVfs>> {
  const fs = memoryVfs();
  await fs.writeFile(`${DM2}/one.sgt`, bytes);
  return fs;
}

async function storedManifest(fs: ReturnType<typeof memoryVfs>): Promise<Record<string, unknown>> {
  const raw = await fs.readFile(`${OUT}/${MUSIC_DIR}/${MUSIC_MANIFEST_NAME}`);
  return JSON.parse(new TextDecoder().decode(raw)) as Record<string, unknown>;
}

describe('music stage incremental identity', () => {
  it('keeps a track whose inputs and render version still match the stored manifest', async () => {
    const fs = await stageWith(shortSegment());
    const first = await renderMusicStage(fs, ROOTS, OUT);
    expect(first.rendered).toBe(1);
    expect(first.kept).toBe(0);
    const row = (await storedManifest(fs)).tracks as Record<string, Record<string, unknown>>;

    const second = await renderMusicStage(fs, ROOTS, OUT);
    expect(second).toMatchObject({ rendered: 0, kept: 1, failed: 0 });
    // The kept path re-uses the stored row, loop points included.
    expect(((await storedManifest(fs)).tracks as Record<string, unknown>).one).toEqual(row.one);
  });

  it('publishes the loop region from the interpreter’s own pass ends', async () => {
    // One 96-tick pass at 120 bpm: DMUS_PPQ 768 ticks/quarter → 0.0625 s per pass.
    const fs = await stageWith(shortSegment());
    await renderMusicStage(fs, ROOTS, OUT);
    const one = ((await storedManifest(fs)).tracks as Record<string, Record<string, unknown>>).one;
    expect(one).toBeDefined();
    const { loopStartS, loopEndS } = one as { loopStartS: number; loopEndS: number };
    expect(loopStartS).toBeCloseTo(0.0625, 3);
    expect(loopEndS).toBeCloseTo(0.125, 3);
    expect(loopEndS).toBeGreaterThan(loopStartS);
  });

  it('re-renders when an input changes size, which is all the identity can see', async () => {
    const fs = await stageWith(shortSegment());
    await renderMusicStage(fs, ROOTS, OUT);
    const before = await storedManifest(fs);

    await fs.writeFile(`${DM2}/one.sgt`, shortSegment(16));
    const after = await renderMusicStage(fs, ROOTS, OUT);
    expect(after).toMatchObject({ rendered: 1, kept: 0 });
    expect((await storedManifest(fs)).sources).not.toEqual(before.sources);
  });

  it('re-renders when the stored manifest carries another render version', async () => {
    const fs = await stageWith(shortSegment());
    await renderMusicStage(fs, ROOTS, OUT);
    const stored = await storedManifest(fs);

    const stale = { ...stored, renderVersion: (stored.renderVersion as number) - 1 };
    await fs.writeFile(
      `${OUT}/${MUSIC_DIR}/${MUSIC_MANIFEST_NAME}`,
      new TextEncoder().encode(JSON.stringify(stale)),
    );
    expect(await renderMusicStage(fs, ROOTS, OUT)).toMatchObject({ rendered: 1, kept: 0 });
  });

  it('does not adopt an ogg left behind by a segment that failed this run', async () => {
    const fs = await stageWith(shortSegment());
    await renderMusicStage(fs, ROOTS, OUT);
    expect(await fs.stat(`${OUT}/${MUSIC_DIR}/one.ogg`)).toBeDefined();

    // A header claiming an implausible length is rejected before it can size the render.
    const broken = shortSegment();
    new DataView(broken.buffer, broken.byteOffset).setInt32(findSeghLength(broken), 0x7fffffff, true);
    await fs.writeFile(`${DM2}/one.sgt`, broken);
    expect(await renderMusicStage(fs, ROOTS, OUT)).toMatchObject({ rendered: 0, failed: 1 });
    expect(await fs.stat(`${OUT}/${MUSIC_DIR}/one.ogg`)).toBeUndefined();
  });
});

/** Offset of `mtLength` inside the fixture's `segh` body (`dwRepeats` precedes it). */
function findSeghLength(bytes: Uint8Array): number {
  const text = new TextDecoder('latin1').decode(bytes);
  const at = text.indexOf('segh');
  if (at < 0) throw new Error('no segh in the fixture');
  return at + 8 + 4;
}
