import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { encodePcx } from '../src/decoders/pcx.js';
import { PLAYER_COLORS } from '../src/decoders/player-palette.js';
import { decodePng } from '../src/decoders/png.js';
import { indexOutTree } from '../src/stages/bmd/index.js';
import { convertPlayerColorLut } from '../src/stages/player-colors.js';
import { BOBS_DIR, makeTempDir } from './support/game-tree.js';

/**
 * Covers the player-colour LUT stage's contract shape: it composes one row per {@link PLAYER_COLORS}
 * slot (10 shipped `playerNN.pcx` + 6 hue-rotated synthetics) into a single `256 × 16` LUT PNG, and
 * requires the base + reference palettes to exist. The row ORDER is the player-slot order the renderer
 * mirrors, so the row count (= palette height) is the load-bearing invariant asserted here.
 */
const CREATURES_DIR = join('Data', 'engine2d', 'bin', 'palettes', 'creatures');

/** Temp-dir teardowns registered by the helpers below, drained after each test. */
const tempCleanups: Array<() => Promise<void>> = [];

/** A distinct 768-byte RGB palette so each source composes a different row (seed varies the ramp). */
function palette(seed: number): Uint8Array {
  const rgb = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    rgb[i * 3] = (i + seed) & 0xff;
    rgb[i * 3 + 1] = (i * 2 + seed) & 0xff;
    rgb[i * 3 + 2] = (i * 3 + seed) & 0xff;
  }
  return rgb;
}

/** Writes a 1×1 `.pcx` carrying `palette(seed)` as its trailer, under the out tree's creatures dir. */
async function writeCreaturePcx(outDir: string, file: string, seed: number): Promise<void> {
  const dir = join(outDir, CREATURES_DIR);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, file),
    encodePcx({ width: 1, height: 1, pixels: new Uint8Array(1), palette: palette(seed) }),
  );
}

/** Builds an out tree with the base + all `playerNN.pcx` sources the pcx-kind player colours need. */
async function outTreeWithSources(): Promise<string> {
  const { path: outDir, cleanup } = await makeTempDir('player-lut');
  tempCleanups.push(cleanup);
  await writeCreaturePcx(outDir, 'test_human_00.pcx', 0); // base
  for (const color of PLAYER_COLORS) {
    if (color.source.kind === 'pcx') await writeCreaturePcx(outDir, color.source.file, color.id + 1);
  }
  return outDir;
}

describe('convertPlayerColorLut', () => {
  afterEach(async () => {
    await Promise.all(tempCleanups.splice(0).map((c) => c()));
  });

  it('composes one LUT row per player colour into a 256×N PNG', async () => {
    const outDir = await outTreeWithSources();
    const result = await convertPlayerColorLut(outDir, await indexOutTree(outDir));

    expect(result.colors).toBe(PLAYER_COLORS.length);
    expect(result.png).toBe(join(BOBS_DIR, 'player-lut.png'));

    const png = decodePng(await readFile(join(outDir, result.png)));
    expect(png.width).toBe(256); // 256 palette entries per row
    expect(png.height).toBe(PLAYER_COLORS.length); // one row per player slot, in slot order
  });

  it('throws when the base creature palette is absent from the out tree', async () => {
    const { path: outDir, cleanup } = await makeTempDir('player-lut-empty');
    tempCleanups.push(cleanup);
    await expect(convertPlayerColorLut(outDir, await indexOutTree(outDir))).rejects.toThrow(
      /test_human_00\.pcx not found/,
    );
  });
});
